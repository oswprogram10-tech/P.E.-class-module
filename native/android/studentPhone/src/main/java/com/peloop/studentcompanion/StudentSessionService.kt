package com.peloop.studentcompanion

import com.peloop.wearable.GalaxyWatchProfile
import com.peloop.wearable.GalaxyWatchCatalog
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.google.android.gms.wearable.Node
import com.google.android.gms.wearable.Wearable
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import java.security.SecureRandom

/** Owns one volatile classroom pairing; no invitation, resume token, or sample is persisted. */
internal class StudentSessionService : Service(), RelayConnectionListener {
    private val work: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor { task ->
        Thread(task, "PELoop-student-relay").apply { isDaemon = true }
    }
    private val connectivity by lazy { getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager }
    private var wifi: Network? = null
    private var invite: PairingInvite? = null
    private var credential: String? = null
    private var connection: StudentRelayConnection? = null
    private var resolver: NsdRelayResolver? = null
    private var reconnectAttempt = 0
    private var discoveryTried = false
    private var lastWatchTimestamp = Long.MIN_VALUE
    private var watchProfile: GalaxyWatchProfile? = null
    private var watchHeartRateAvailable = false
    private var watchSessionToken: String? = null

    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            if (connectivity.getNetworkCapabilities(network)?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) != true) return
            wifi = network
            work.execute { connectIfNeeded() }
        }
        override fun onLost(network: Network) {
            if (wifi == network) {
                wifi = null
                work.execute {
                    clearConnection()
                    watchSessionToken = null
                    sendWatchControl("stop")
                    updateStatus("같은 Wi-Fi 연결을 기다리는 중입니다. 측정값은 저장하지 않습니다.")
                }
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        StudentSessionRegistry.active = this
        createNotificationChannel()
        try {
            connectivity.registerNetworkCallback(
                android.net.NetworkRequest.Builder().addTransportType(NetworkCapabilities.TRANSPORT_WIFI).build(),
                networkCallback,
            )
        } catch (_: Exception) { }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopSession()
                stopSelf(startId)
                return START_NOT_STICKY
            }
            ACTION_START -> {
                startForeground(NOTIFICATION_ID, buildNotification("수업 연결을 준비합니다."))
                val payload = intent.getStringExtra(EXTRA_INVITE)
                if (payload == null) {
                    updateStatus("연결 QR을 다시 스캔해 주세요.")
                    return START_NOT_STICKY
                }
                try {
                    val nextInvite = PairingInvite.parse(payload)
                    val currentInvite = invite
                    if (currentInvite?.sessionId == nextInvite.sessionId) {
                        updateStatus("이미 이 수업 연결을 사용 중입니다.")
                        return START_NOT_STICKY
                    }
                    if (currentInvite != null) {
                        clearConnection()
                        sendWatchControl("stop")
                        invite = null
                        credential = null
                        watchProfile = null
                        lastWatchTimestamp = Long.MIN_VALUE
                        discoveryTried = false
                        reconnectAttempt = 0
                    }
                    invite = nextInvite
                    credential = nextInvite.ticket
                    updateStatus("교사 태블릿을 찾는 중입니다.")
                    wifi = activeWifi()
                    work.execute { connectIfNeeded() }
                } catch (error: IllegalArgumentException) {
                    updateStatus(error.message ?: "연결 QR을 확인해 주세요.")
                    stopSelf(startId)
                }
            }
        }
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        stopSession()
        if (StudentSessionRegistry.active === this) StudentSessionRegistry.active = null
        try { connectivity.unregisterNetworkCallback(networkCallback) } catch (_: Exception) { }
        work.shutdownNow()
        super.onDestroy()
    }

    override fun onReady(ack: RelayAck, phoneTimeAtAck: Long) {
        work.execute {
            if (ack.resumeToken != null) credential = ack.resumeToken
            reconnectAttempt = 0
            discoveryTried = false
            watchSessionToken = newWatchSessionToken()
            watchHeartRateAvailable = false
            lastWatchTimestamp = Long.MIN_VALUE
            updateStatus("교사 태블릿에 연결되었습니다. 워치 측정을 확인합니다.")
            connection?.setDevice(watchProfile, false)
            sendWatchControl("start", watchSessionToken)
        }
    }

    override fun onClosed(message: String?) {
        work.execute {
            val current = connection
            connection = null
            current?.close()
            watchSessionToken = null
            watchHeartRateAvailable = false
            sendWatchControl("stop")
            updateStatus("연결이 끊겼습니다. 같은 Wi-Fi에서 다시 연결합니다.")
            discoverOrRetry()
        }
    }

    private fun connectIfNeeded() {
        if (connection != null || invite == null || credential == null) return
        val network = wifi ?: activeWifi().also { wifi = it } ?: run {
            updateStatus("학생 휴대폰을 교사 태블릿과 같은 Wi-Fi에 연결해 주세요.")
            return
        }
        val currentInvite = invite ?: return
        if (discoveryTried) {
            findRelay(currentInvite)
            return
        }
        val currentCredential = credential ?: return
        val host = currentInvite.host
        val port = currentInvite.port
        val relay = StudentRelayConnection(currentInvite, host, port, network, currentCredential, this)
        connection = relay
        try { relay.connect() } catch (_: Exception) {
            connection = null
            relay.close()
            discoverOrRetry()
        }
    }

    private fun discoverOrRetry() {
        if (credential == invite?.ticket && invite?.expiresAt?.let { it <= System.currentTimeMillis() } == true) {
            updateStatus("초대 QR이 만료되었습니다. 교사에게 새 QR을 요청해 주세요.")
            return
        }
        discoveryTried = true
        updateStatus("태블릿 주소가 바뀌었는지 로컬 네트워크에서 찾습니다.")
        val currentInvite = invite ?: return
        findRelay(currentInvite)
    }

    private fun findRelay(currentInvite: PairingInvite) {
        val search = NsdRelayResolver(this, currentInvite)
        resolver?.close()
        resolver = search
        search.find { endpoint ->
            work.execute {
                resolver = null
                if (endpoint == null) {
                    updateStatus("태블릿을 찾지 못했습니다. 교사에게 새 연결 QR을 요청해 주세요.")
                    scheduleReconnect()
                } else {
                    connectAt(endpoint.address, endpoint.port)
                }
            }
        }
    }

    private fun connectAt(address: java.net.Inet4Address, port: Int) {
        if (connection != null) return
        val network = wifi ?: activeWifi().also { wifi = it } ?: return
        val currentInvite = invite ?: return
        val currentCredential = credential ?: return
        val relay = StudentRelayConnection(currentInvite, address, port, network, currentCredential, this)
        connection = relay
        try { relay.connect() } catch (_: Exception) {
            connection = null
            relay.close()
            scheduleReconnect()
        }
    }

    private fun scheduleReconnect() {
        if (invite == null || wifi == null) return
        val wait = ReconnectDelay.forAttempt(reconnectAttempt++)
        work.schedule({
            if (connection == null && wifi != null) {
                connectIfNeeded()
            }
        }, wait, TimeUnit.MILLISECONDS)
    }

    private fun activeWifi(): Network? {
        val active = connectivity.activeNetwork ?: return null
        return active.takeIf { connectivity.getNetworkCapabilities(it)?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true }
    }

    private fun clearConnection() {
        resolver?.close()
        resolver = null
        connection?.close()
        connection = null
        watchHeartRateAvailable = false
        watchSessionToken = null
    }

    private fun stopSession() {
        clearConnection()
        sendWatchControl("stop")
        invite = null
        credential = null
        watchProfile = null
        watchHeartRateAvailable = false
        lastWatchTimestamp = Long.MIN_VALUE
        updateStatus("수업 연결이 종료되었습니다. 측정 기록은 저장되지 않았습니다.")
        stopForeground(STOP_FOREGROUND_REMOVE)
    }

    fun receiveWatchMessage(bytes: ByteArray) {
        val message = WearableWireMessage.parse(bytes) ?: return
        work.execute {
            if (message.sessionToken != watchSessionToken) return@execute
            when (message) {
                is WearableWireMessage.Ready -> {
                    if (!GalaxyWatchCatalog.phoneAllowed(message.profile, android.os.Build.VERSION.SDK_INT)) {
                        watchProfile = null
                        watchHeartRateAvailable = false
                        connection?.sendStatus("disconnected")
                        sendWatchControl("stop")
                        updateStatus("이 워치에 필요한 휴대폰 Android 버전이 아닙니다.")
                        return@execute
                    }
                    watchProfile = message.profile
                    watchHeartRateAvailable = message.heartRateAvailable
                    connection?.setDevice(watchProfile, watchHeartRateAvailable)
                    updateStatus(if (message.heartRateAvailable) "워치 심박 측정을 사용할 수 있습니다." else "워치에서 심박 센서를 사용할 수 없습니다.")
                }
                is WearableWireMessage.OsUnsupported -> {
                    watchProfile = null
                    watchHeartRateAvailable = false
                    connection?.sendStatus("disconnected")
                    sendWatchControl("stop")
                    updateStatus("워치 또는 휴대폰 OS가 이 모델의 최소 버전 조건에 맞지 않습니다.")
                }
                is WearableWireMessage.Unsupported -> {
                    watchProfile = null
                    watchHeartRateAvailable = false
                    connection?.sendStatus("disconnected")
                    updateStatus("지원 확인이 되지 않은 워치 모델입니다: ${message.model}")
                }
                is WearableWireMessage.Sample -> {
                    if (!watchHeartRateAvailable || message.timestamp <= lastWatchTimestamp) return@execute
                    lastWatchTimestamp = message.timestamp
                    if (connection?.sendSample(message.bpm, message.timestamp) != true) {
                        updateStatus("연결이 끊겨 측정값은 비워 두었습니다.")
                    }
                }
                is WearableWireMessage.PermissionUnavailable -> {
                    watchHeartRateAvailable = false
                    connection?.let { it.setDevice(watchProfile, false); it.sendStatus("permission-unavailable") }
                    updateStatus("워치 심박 권한을 사용할 수 없습니다.")
                }
                is WearableWireMessage.PermissionRevoked -> {
                    watchHeartRateAvailable = false
                    connection?.setDevice(watchProfile, false)
                    connection?.sendStatus("permission-revoked")
                    updateStatus("워치 심박 권한이 해제되었습니다.")
                }
                is WearableWireMessage.Disconnected -> {
                    watchHeartRateAvailable = false
                    connection?.setDevice(watchProfile, false)
                    connection?.sendStatus("disconnected")
                    updateStatus("워치 연결이 끊겼습니다. 측정값은 비워 둡니다.")
                }
            }
        }
    }

    private fun sendWatchControl(type: String, sessionToken: String? = null) {
        val message = JSONObject().put("type", type)
        if (type == "start") message.put("sessionToken", requireNotNull(sessionToken)).put("phoneApi", android.os.Build.VERSION.SDK_INT)
        val payload = message.toString().toByteArray(Charsets.UTF_8)
        Wearable.getNodeClient(this).connectedNodes.addOnSuccessListener { nodes: List<Node> ->
            nodes.forEach { node -> Wearable.getMessageClient(this).sendMessage(node.id, CONTROL_PATH, payload) }
        }
    }

    private fun updateStatus(text: String) {
        statusText = text
        sendBroadcast(Intent(ACTION_STATUS).setPackage(packageName).putExtra(EXTRA_STATUS, text))
        val manager = getSystemService(NotificationManager::class.java)
        try { manager.notify(NOTIFICATION_ID, buildNotification(text)) } catch (_: Exception) { }
    }

    private fun buildNotification(text: String): Notification {
        val open = PendingIntent.getActivity(this, 0, Intent(this, StudentActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val stop = PendingIntent.getService(this, 1, Intent(this, StudentSessionService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_info_details)
            .setContentTitle("PELoop 수업 심박 연결")
            .setContentText(text.take(120))
            .setContentIntent(open)
            .setOngoing(invite != null)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "연결 종료", stop)
            .build()
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(CHANNEL_ID, getString(R.string.notification_channel), NotificationManager.IMPORTANCE_LOW)
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    companion object {
        const val ACTION_START = "com.peloop.studentcompanion.START"
        const val ACTION_STOP = "com.peloop.studentcompanion.STOP"
        const val ACTION_STATUS = "com.peloop.studentcompanion.STATUS"
        const val EXTRA_INVITE = "pairing-invite"
        const val EXTRA_STATUS = "status"
        private const val CONTROL_PATH = "/peloop/student-control/v1"
        private const val CHANNEL_ID = "peloop-class-heart-rate"
        private const val NOTIFICATION_ID = 42
        private val RANDOM = SecureRandom()
        @Volatile var statusText: String = "학생·보호자 동의 후 교사 QR로 연결해 주세요."
            private set

        fun start(context: Context, pairingPayload: String) {
            val intent = Intent(context, StudentSessionService::class.java)
                .setAction(ACTION_START)
                .putExtra(EXTRA_INVITE, pairingPayload)
            context.startForegroundService(intent)
        }

        fun stop(context: Context) {
            context.startService(Intent(context, StudentSessionService::class.java).setAction(ACTION_STOP))
        }

        private fun newWatchSessionToken(): String = ByteArray(16).also(RANDOM::nextBytes)
            .joinToString("") { (it.toInt() and 0xff).toString(16).padStart(2, '0') }
    }
}
