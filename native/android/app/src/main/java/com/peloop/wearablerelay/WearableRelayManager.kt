package com.peloop.wearablerelay

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Network
import org.java_websocket.WebSocket
import org.java_websocket.framing.CloseFrame
import org.json.JSONObject
import java.net.Inet4Address
import java.net.InetSocketAddress
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.Base64
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

internal class WearableRelayManager(
    context: Context,
    private val eventSink: (listenerId: String, eventJson: String) -> Unit,
) : AutoCloseable, RelaySocketCallbacks {
    private val appContext = context.applicationContext
    private val discovery = RelayDiscovery(appContext)
    private val connectivity = appContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    private val lock = Any()
    private val networkExecutor = Executors.newSingleThreadExecutor { task ->
        Thread(task, "PELoop-relay-network").apply { isDaemon = true }
    }
    private val scheduler: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor { task ->
        Thread(task, "PELoop-relay-expiry").apply { isDaemon = true }
    }
    private val listenerIds = linkedSetOf<String>()
    private var activeSession: RelaySession? = null
    private var closed = false
    @Volatile private var wifiNetwork: Network? = null

    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            wifiNetwork = network
            enqueueNetworkRefresh()
        }
        override fun onLinkPropertiesChanged(network: Network, properties: android.net.LinkProperties) {
            wifiNetwork = network
            enqueueNetworkRefresh()
        }
        override fun onLost(network: Network) {
            if (wifiNetwork == network) wifiNetwork = null
            enqueueNetworkRefresh()
        }
    }

    private class RelaySession(
        var sessionId: String,
        var participantToken: String,
        var address: Inet4Address,
        val tls: RelayTlsIdentity,
        var ticket: String,
        var expiresAt: Long,
    ) {
        lateinit var server: SecureWearableWebSocketServer
        var port: Int = 0
        var needsRebind = false
        var minSampleTimestamp = Long.MIN_VALUE
        var ticketConsumed = false
        var resumeToken: String? = null
        var socket: WebSocket? = null
        var deviceReady = false
        var lastSampleTimestamp = Long.MIN_VALUE
        var expiryTask: ScheduledFuture<*>? = null
    }

    init {
        connectivity.registerNetworkCallback(
            android.net.NetworkRequest.Builder().addTransportType(NetworkCapabilities.TRANSPORT_WIFI).build(),
            networkCallback,
        )
    }

    @Throws(Exception::class)
    fun createPairingSession(request: JSONObject): JSONObject {
        val participantToken = validateRequest(request)
        val address = connectedPrivateWifiAddress()
        val tls = RelayCertificate.loadOrCreate()
        val now = System.currentTimeMillis()
        val session = RelaySession(
            sessionId = UUID.randomUUID().toString(),
            participantToken = participantToken,
            address = address,
            tls = tls,
            ticket = newTicket(),
            expiresAt = now + PAIRING_TTL_MS,
        )
        session.server = SecureWearableWebSocketServer(InetSocketAddress(address, 0), tls.sslContext, this)

        synchronized(lock) {
            check(!closed) { "태블릿 릴레이가 종료되었습니다." }
            check(activeSession == null) { "이미 진행 중인 웨어러블 연결이 있습니다." }
            activeSession = session
        }
        try {
            session.server.startAndWait()
            session.port = session.server.port
            check(session.port in 1024..65535) { "태블릿 수신 포트를 확인하지 못했습니다." }
            discovery.publish(session.sessionId, session.port, tls.publicKeyFingerprint)
            scheduleExpiry(session)
            return pairingResult(session)
        } catch (error: Exception) {
            clearSession(session)
            try { session.server.stop(200, "Stopped") } catch (_: Exception) { }
            if (error is IllegalStateException && error.message?.startsWith("태블릿") == true) throw error
            throw IllegalStateException("태블릿 로컬 수신기를 열지 못했습니다.")
        }
    }

    fun reconnectSession(request: JSONObject): JSONObject {
        val participantToken = validateRequest(request)
        val session: RelaySession
        val previousSocket: WebSocket?
        var previousSessionId = ""
        synchronized(lock) {
            check(!closed) { "태블릿 릴레이가 종료되었습니다." }
            session = activeSession ?: throw IllegalStateException("다시 연결할 측정 세션이 없습니다.")
            check(MessageDigest.isEqual(session.participantToken.toByteArray(StandardCharsets.UTF_8), participantToken.toByteArray(StandardCharsets.UTF_8))) {
                "다시 연결할 측정 세션이 없습니다."
            }
            check(connectedPrivateWifiAddress() == session.address) {
                "태블릿의 Wi-Fi 주소가 바뀌어 새 세션이 필요합니다."
            }
            session.expiryTask?.cancel(false)
            session.expiryTask = null
            previousSessionId = session.sessionId
            previousSocket = session.socket
            session.socket = null
            session.deviceReady = false
            session.lastSampleTimestamp = Long.MIN_VALUE
            session.ticketConsumed = false
            session.sessionId = UUID.randomUUID().toString()
            session.expiresAt = System.currentTimeMillis() + PAIRING_TTL_MS
            replaceTicket(session, newTicket())
            session.resumeToken = null
        }
        discovery.unpublish(previousSessionId)
        discovery.publish(session.sessionId, session.port, session.tls.publicKeyFingerprint)
        previousSocket?.close(CloseFrame.NORMAL, "Pairing renewed")
        scheduleExpiry(session)
        return pairingResult(session)
    }

    fun stopSession(sessionId: String?) {
        val session = synchronized(lock) {
            val current = activeSession ?: return
            if (sessionId != current.sessionId) return
            activeSession = null
            current.expiryTask?.cancel(false)
            current.expiryTask = null
            current
        }
        discovery.unpublish(session.sessionId)
        session.socket?.close(CloseFrame.NORMAL, "Session ended")
        session.socket = null
        session.deviceReady = false
        session.participantToken = ""
        session.ticket = ""
        session.resumeToken = null
        try { session.server.stop(250, "Session ended") } catch (_: InterruptedException) { Thread.currentThread().interrupt() } catch (_: Exception) { }
    }

    fun subscribe(listenerId: String) {
        require(isUuid(listenerId)) { "유효하지 않은 화면 구독입니다." }
        synchronized(lock) {
            check(!closed) { "태블릿 릴레이가 종료되었습니다." }
            listenerIds += listenerId
        }
    }

    fun unsubscribe(listenerId: String) {
        synchronized(lock) { listenerIds -= listenerId }
    }

    override fun authorize(socket: WebSocket, credential: String): String? {
        val outcome = synchronized(lock) {
            val current = activeSession ?: return null
            if (current.socket != null || current.port == 0) return null
            val now = System.currentTimeMillis()
            val ticketMatches = !current.ticketConsumed && current.expiresAt > now && constantTimeMatches(current.ticket, credential)
            val resumeMatches = current.ticketConsumed && current.resumeToken != null && constantTimeMatches(current.resumeToken!!, credential)
            if (!ticketMatches && !resumeMatches) return null
            val eventType: String
            if (ticketMatches) {
                current.ticketConsumed = true
                current.resumeToken = newTicket()
                current.expiryTask?.cancel(false)
                current.expiryTask = null
                eventType = "participant-connected"
            } else {
                eventType = "network-reconnected"
            }
            current.socket = socket
            current.deviceReady = false
            current.minSampleTimestamp = now
            val acknowledgement = JSONObject()
                .put("type", if (ticketMatches) "session-ready" else "session-resumed")
                .put("sessionId", current.sessionId)
            if (ticketMatches) acknowledgement.put("resumeToken", current.resumeToken)
            Triple(current, eventType, acknowledgement.toString())
        }
        emit(outcome.first, JSONObject().put("type", outcome.second))
        return outcome.third
    }

    override fun onText(socket: WebSocket, message: String) {
        val session = synchronized(lock) { activeSession?.takeIf { it.socket === socket } } ?: run {
            socket.close(CloseFrame.POLICY_VALIDATION, "Rejected")
            return
        }
        val payload = try { JSONObject(message) } catch (_: Exception) {
            socket.close(CloseFrame.POLICY_VALIDATION, "Rejected")
            return
        }
        when (payload.optString("type")) {
            "device-ready" -> handleDeviceReady(session, socket, payload)
            "sample" -> handleSample(session, socket, payload)
            "permission-unavailable" -> if (hasOnlyKeys(payload, setOf("type"))) emit(session, JSONObject().put("type", "permission-unavailable")) else reject(socket)
            "permission-revoked" -> if (hasOnlyKeys(payload, setOf("type"))) emit(session, JSONObject().put("type", "permission-revoked")) else reject(socket)
            "disconnected" -> if (hasOnlyKeys(payload, setOf("type"))) emit(session, JSONObject().put("type", "disconnected").put("source", "watch")) else reject(socket)
            else -> reject(socket)
        }
    }

    override fun onClosed(socket: WebSocket) {
        val session = synchronized(lock) {
            val current = activeSession ?: return
            if (current.socket !== socket) return
            current.socket = null
            current.deviceReady = false
            current
        }
        emit(session, JSONObject().put("type", "disconnected").put("source", "network"))
    }

    override fun close() {
        synchronized(lock) {
            if (closed) return
            closed = true
            listenerIds.clear()
        }
        val currentId = synchronized(lock) { activeSession?.sessionId }
        stopSession(currentId)
        discovery.close()
        try { connectivity.unregisterNetworkCallback(networkCallback) } catch (_: Exception) { }
        networkExecutor.shutdownNow()
        scheduler.shutdownNow()
    }

    private fun handleDeviceReady(session: RelaySession, socket: WebSocket, payload: JSONObject) {
        if (!hasOnlyKeys(payload, setOf("type", "device"))) return reject(socket)
        val device = payload.optJSONObject("device") ?: return reject(socket)
        if (!hasOnlyKeys(device, setOf("platform", "model", "releaseDate", "heartRateAvailable"))) return reject(socket)
        val platform = device.optString("platform")
        val model = device.optString("model")
        val releaseDate = device.optString("releaseDate")
        val heartRateAvailable = device.opt("heartRateAvailable") as? Boolean ?: return reject(socket)
        if (platform.length > 40 || model.isBlank() || model.length > 100 || !validDate(releaseDate)) return reject(socket)
        val supported = platform in SUPPORTED_PLATFORMS && releaseDate >= MIN_RELEASE_DATE && releaseDate <= LocalDate.now(ZoneOffset.UTC).toString() && heartRateAvailable
        synchronized(lock) {
            if (activeSession !== session || session.socket !== socket) return
            session.deviceReady = supported
        }
        emit(session, JSONObject().put("type", "device-ready").put("device", device))
    }

    private fun handleSample(session: RelaySession, socket: WebSocket, payload: JSONObject) {
        if (!hasOnlyKeys(payload, setOf("type", "metric", "value", "timestamp"))) return reject(socket)
        if (payload.optString("metric") != "heartRate") return reject(socket)
        val rawValue = payload.opt("value") as? Number ?: return reject(socket)
        val bpm = rawValue.toDouble()
        val rawTimestamp = payload.opt("timestamp") as? Number ?: return reject(socket)
        val timestamp = rawTimestamp.toLong()
        val now = System.currentTimeMillis()
        if (!bpm.isFinite() || bpm !in 20.0..250.0 || rawTimestamp.toDouble() != timestamp.toDouble() || timestamp > MAX_SAFE_JS_INTEGER || timestamp < now - SAMPLE_STALE_MS || timestamp > now + FUTURE_SKEW_MS) return
        synchronized(lock) {
            if (activeSession !== session || session.socket !== socket || !session.deviceReady || timestamp < session.minSampleTimestamp || timestamp <= session.lastSampleTimestamp) return
            session.lastSampleTimestamp = timestamp
        }
        emit(session, JSONObject().put("type", "sample").put("metric", "heartRate").put("value", bpm).put("timestamp", timestamp))
    }

    private fun validateRequest(request: JSONObject): String {
        require(hasOnlyKeys(request, setOf("participantToken", "dataTypes"))) { "태블릿 연결 요청 형식이 올바르지 않습니다." }
        val token = request.optString("participantToken")
        require(isUuid(token)) { "태블릿 연결 요청 형식이 올바르지 않습니다." }
        val dataTypes = request.optJSONArray("dataTypes") ?: throw IllegalArgumentException("지원하지 않는 데이터 범위입니다.")
        require(dataTypes.length() == 1 && dataTypes.optString(0) == "heartRate") { "지원하지 않는 데이터 범위입니다." }
        return token
    }

    private fun connectedPrivateWifiAddress(): Inet4Address {
        val activeNetwork = connectivity.activeNetwork
        val wifi = activeNetwork?.takeIf { connectivity.getNetworkCapabilities(it)?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true }
            ?: wifiNetwork?.takeIf { connectivity.getNetworkCapabilities(it)?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true }
            ?: throw IllegalStateException("교사 태블릿을 로컬 Wi-Fi에 연결해 주세요.")
        val address = connectivity.getLinkProperties(wifi)?.linkAddresses?.mapNotNull { it.address as? Inet4Address }
            ?.firstOrNull { isPrivateIpv4(it.hostAddress ?: "") }
            ?: throw IllegalStateException("같은 로컬 Wi-Fi의 태블릿 주소를 찾지 못했습니다.")
        return address
    }

    private fun enqueueNetworkRefresh() {
        try { networkExecutor.execute { rebindIfWifiAddressChanged() } } catch (_: Exception) { }
    }

    private fun rebindIfWifiAddressChanged() {
        val newAddress = try { connectedPrivateWifiAddress() } catch (_: Exception) { return }
        val session = synchronized(lock) { activeSession?.takeIf { it.address != newAddress || it.needsRebind } } ?: return
        val oldServer: SecureWearableWebSocketServer
        val oldSocket: WebSocket?
        val newServer = SecureWearableWebSocketServer(InetSocketAddress(newAddress, 0), session.tls.sslContext, this)
        synchronized(lock) {
            if (closed || activeSession !== session || (session.address == newAddress && !session.needsRebind)) return
            oldServer = session.server
            oldSocket = session.socket
            session.socket = null
            session.deviceReady = false
            session.needsRebind = true
            session.port = 0
            session.server = newServer
        }
        discovery.unpublish(session.sessionId)
        oldSocket?.close(CloseFrame.GOING_AWAY, "Wi-Fi address changed")
        try { oldServer.stop(200, "Wi-Fi address changed") } catch (_: InterruptedException) { Thread.currentThread().interrupt() } catch (_: Exception) { }
        try {
            newServer.startAndWait()
            val port = newServer.port
            check(port in 1024..65535)
            val stillActive = synchronized(lock) { activeSession === session && session.server === newServer }
            if (!stillActive) {
                try { newServer.stop(200, "Session ended") } catch (_: Exception) { }
                return
            }
            synchronized(lock) {
                if (closed || activeSession !== session || session.server !== newServer) {
                    try { newServer.stop(200, "Session ended") } catch (_: Exception) { }
                    return
                }
                session.address = newAddress
                session.port = port
                session.needsRebind = false
                discovery.publish(session.sessionId, port, session.tls.publicKeyFingerprint)
            }
            emit(session, JSONObject().put("type", "disconnected").put("source", "network"))
        } catch (_: Exception) {
            try { newServer.stop(200, "Rebind failed") } catch (_: Exception) { }
            emit(session, JSONObject().put("type", "disconnected").put("source", "network"))
            synchronized(lock) {
                if (!closed && activeSession === session && session.server === newServer) {
                    session.needsRebind = true
                    session.port = 0
                    scheduler.schedule({ enqueueNetworkRefresh() }, 2, TimeUnit.SECONDS)
                }
            }
        }
    }

    private fun scheduleExpiry(session: RelaySession) {
        synchronized(lock) {
            if (activeSession !== session || session.ticketConsumed) return
            session.expiryTask?.cancel(false)
            val delay = (session.expiresAt - System.currentTimeMillis()).coerceAtLeast(1L)
            session.expiryTask = scheduler.schedule({
                val expired = synchronized(lock) { activeSession === session && !session.ticketConsumed && session.expiresAt <= System.currentTimeMillis() }
                if (expired) {
                    emit(session, JSONObject().put("type", "invitation-expired"))
                    stopSession(session.sessionId)
                }
            }, delay, TimeUnit.MILLISECONDS)
        }
    }

    private fun pairingResult(session: RelaySession): JSONObject {
        val invitation = JSONObject()
            .put("v", 1)
            .put("host", session.address.hostAddress)
            .put("port", session.port)
            .put("sessionId", session.sessionId)
            .put("ticket", session.ticket)
            .put("fingerprint", session.tls.publicKeyFingerprint)
            .put("expiresAt", session.expiresAt)
        val encoded = Base64.getUrlEncoder().withoutPadding().encodeToString(invitation.toString().toByteArray(StandardCharsets.UTF_8))
        return JSONObject().put("sessionId", session.sessionId).put("pairingPayload", PAIRING_PREFIX + encoded)
    }

    private fun emit(session: RelaySession, body: JSONObject) {
        val message = JSONObject(body.toString()).put("sessionId", session.sessionId).toString()
        val targets = synchronized(lock) { if (activeSession === session) listenerIds.toList() else emptyList() }
        targets.forEach { listenerId -> try { eventSink(listenerId, message) } catch (_: Exception) { } }
    }

    private fun replaceTicket(session: RelaySession, ticket: String) {
        session.ticket = ticket
    }

    private fun clearSession(session: RelaySession) {
        synchronized(lock) {
            if (activeSession === session) activeSession = null
            session.expiryTask?.cancel(false)
            session.expiryTask = null
        }
    }

    private fun reject(socket: WebSocket) {
        socket.close(CloseFrame.POLICY_VALIDATION, "Rejected")
    }

    private fun constantTimeMatches(expected: String, actual: String): Boolean =
        MessageDigest.isEqual(expected.toByteArray(StandardCharsets.UTF_8), actual.toByteArray(StandardCharsets.UTF_8))

    private fun hasOnlyKeys(value: JSONObject, expected: Set<String>): Boolean = value.keys().asSequence().toSet() == expected

    private fun validDate(value: String): Boolean {
        if (!Regex("^\\d{4}-\\d{2}-\\d{2}$").matches(value)) return false
        return try { LocalDate.parse(value).toString() == value } catch (_: Exception) { false }
    }

    private fun isUuid(value: String): Boolean = UUID_REGEX.matches(value)

    private fun isPrivateIpv4(value: String): Boolean {
        val pieces = value.split('.')
        if (pieces.size != 4 || pieces.any { piece ->
                val octet = piece.toIntOrNull()
                piece.isEmpty() || (piece.length > 1 && piece[0] == '0') || octet == null || octet !in 0..255
            }) return false
        val a = pieces[0].toInt(); val b = pieces[1].toInt()
        return a == 10 || (a == 172 && b in 16..31) || (a == 192 && b == 168)
    }

    companion object {
        private const val PAIRING_PREFIX = "PELOOP_PAIR_V1."
        private const val PAIRING_TTL_MS = 120_000L
        private const val SAMPLE_STALE_MS = 5_000L
        private const val FUTURE_SKEW_MS = 30_000L
        private const val MAX_SAFE_JS_INTEGER = 9_007_199_254_740_991L
        private const val MIN_RELEASE_DATE = "2022-11-07"
        private val SUPPORTED_PLATFORMS = setOf("galaxy-watch", "apple-watch")
        private val UUID_REGEX = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$")

        private fun newTicket(): String = Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(32).also { SecureRandom().nextBytes(it) })
    }
}
