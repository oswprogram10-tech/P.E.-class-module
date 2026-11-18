package com.peloop.studentwear

import com.peloop.wearable.GalaxyWatchCatalog
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.health.services.client.ExerciseUpdateCallback
import androidx.health.services.client.HealthServices
import androidx.health.services.client.data.Availability
import androidx.health.services.client.data.DataType
import androidx.health.services.client.data.DataTypeAvailability
import androidx.health.services.client.data.ExerciseConfig
import androidx.health.services.client.data.ExerciseLapSummary
import androidx.health.services.client.data.ExerciseType
import androidx.health.services.client.data.ExerciseUpdate
import com.google.android.gms.wearable.Node
import com.google.android.gms.wearable.Wearable
import java.util.concurrent.Executor

/** Reads one live heart-rate stream for the active class session; app code stores no workout history. */
class HeartRateExerciseService : Service() {
    private val exerciseClient by lazy { HealthServices.getClient(this).exerciseClient }
    private val callbackExecutor: Executor by lazy { ContextCompat.getMainExecutor(this) }
    private var running = false
    private var stopped = false
    private var sessionToken: String? = null

    private val callback = object : ExerciseUpdateCallback {
        override fun onExerciseUpdateReceived(update: ExerciseUpdate) {
            if (!running || stopped) return
            val bpm = update.latestMetrics.getData(DataType.HEART_RATE_BPM).lastOrNull()?.value ?: return
            if (bpm !in 20.0..250.0 || !bpm.isFinite()) return
            sessionToken?.let { sendPhoneMessage(this@HeartRateExerciseService, "sample", it, bpm, System.currentTimeMillis()) }
        }

        override fun onLapSummaryReceived(lapSummary: ExerciseLapSummary) = Unit

        override fun onAvailabilityChanged(dataType: DataType<*, *>, availability: Availability) {
            if (!stopped && running && dataType == DataType.HEART_RATE_BPM) {
                val available = availability == DataTypeAvailability.AVAILABLE
                sessionToken?.let { sendPhoneMessage(this@HeartRateExerciseService, "ready", it, heartRateAvailable = available) }
            }
        }

        override fun onRegistered() = Unit

        override fun onRegistrationFailed(throwable: Throwable) {
            if (stopped) return
            failStart()
        }
    }

    override fun onCreate() {
        super.onCreate()
        createChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val token = intent?.getStringExtra(EXTRA_SESSION_TOKEN)
        if (intent?.action != ACTION_START || token == null || !Regex("^[0-9a-f]{32}$").matches(token)) {
            stopSelf(startId)
            return START_NOT_STICKY
        }
        if (running && sessionToken == token) return START_NOT_STICKY
        if (running) stopExercise()
        sessionToken = token
        stopped = false
        startForeground(NOTIFICATION_ID, notification("수업 중 실시간 심박 측정"))
        startSupportedExercise()
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        stopExercise()
        super.onDestroy()
    }

    private fun startSupportedExercise() {
        if (stopped || running) return
        if (!(GalaxyWatchCatalog.lookup(Build.MODEL)?.let { GalaxyWatchCatalog.watchAllowed(it, Build.VERSION.SDK_INT) } == true) || !sensorPermissionGranted()) {
            sessionToken?.let { sendPhoneMessage(this, "permission-unavailable", it) }
            stopSelf()
            return
        }
        val token = sessionToken ?: return
        exerciseClient.getCapabilitiesAsync().addListener({
            if (stopped || sessionToken != token) return@addListener
            val supported = try {
                val capabilities = exerciseClient.getCapabilitiesAsync().get()
                capabilities.getExerciseTypeCapabilities(ExerciseType.WORKOUT)
                    ?.supportedDataTypes?.contains(DataType.HEART_RATE_BPM) == true
            } catch (_: Exception) { false }
            if (!supported) {
                failStart()
                return@addListener
            }
            val config = ExerciseConfig.builder(ExerciseType.WORKOUT)
                .setDataTypes(setOf(DataType.HEART_RATE_BPM))
                .setIsAutoPauseAndResumeEnabled(false)
                .setIsGpsEnabled(false)
                .build()
            exerciseClient.setUpdateCallback(callbackExecutor, callback)
            val start = exerciseClient.startExerciseAsync(config)
            start.addListener({
                if (stopped || sessionToken != token) return@addListener
                try {
                    start.get()
                    running = true
                    sendPhoneMessage(this, "ready", token, heartRateAvailable = true)
                } catch (_: Exception) {
                    sessionToken?.let { sendPhoneMessage(this, "permission-unavailable", it) }
                    failStart()
                }
            }, callbackExecutor)
        }, callbackExecutor)
    }

    private fun failStart() {
        sessionToken?.let { sendPhoneMessage(this, "permission-unavailable", it) }
        stopExercise()
        stopSelf()
    }

    private fun stopExercise() {
        stopped = true
        running = false
        try { exerciseClient.endExerciseAsync() } catch (_: Exception) { }
        try { exerciseClient.clearUpdateCallbackAsync(callback) } catch (_: Exception) { }
        stopForeground(STOP_FOREGROUND_REMOVE)
    }

    private fun sensorPermissionGranted(): Boolean {
        val permission = if (applicationInfo.targetSdkVersion >= 36) "android.permission.health.READ_HEART_RATE" else android.Manifest.permission.BODY_SENSORS
        return checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
    }

    private fun createChannel() {
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "수업 중 심박 측정", NotificationManager.IMPORTANCE_LOW),
        )
    }

    private fun notification(text: String): Notification = NotificationCompat.Builder(this, CHANNEL_ID)
        .setSmallIcon(android.R.drawable.ic_menu_info_details)
        .setContentTitle("PELoop 수업 측정")
        .setContentText(text)
        .setOngoing(true)
        .build()

    companion object {
        const val ACTION_START = "com.peloop.studentwear.START"
        const val EXTRA_SESSION_TOKEN = "session-token"
        private const val CHANNEL_ID = "peloop-watch-heart-rate"
        private const val NOTIFICATION_ID = 81
        private const val PHONE_PATH = "/peloop/student-heart-rate/v1"

        fun sendPhoneMessage(context: Context, type: String, sessionToken: String, bpm: Double? = null, timestamp: Long? = null, heartRateAvailable: Boolean? = null) {
            val message = org.json.JSONObject().put("type", type).put("sessionToken", sessionToken)
            if (type == "sample") {
                if (bpm == null || timestamp == null) return
                message.put("bpm", bpm).put("timestamp", timestamp)
            } else if (type == "ready") {
                message.put("model", Build.MODEL.trim().uppercase()).put("watchApi", Build.VERSION.SDK_INT)
                message.put("heartRateAvailable", heartRateAvailable == true)
            }
            Wearable.getNodeClient(context).connectedNodes.addOnSuccessListener { nodes: List<Node> ->
                val bytes = message.toString().toByteArray(Charsets.UTF_8)
                nodes.forEach { node -> Wearable.getMessageClient(context).sendMessage(node.id, PHONE_PATH, bytes) }
            }
        }
    }
}
