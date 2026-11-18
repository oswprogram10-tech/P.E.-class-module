package com.peloop.studentwear

import com.peloop.wearable.GalaxyWatchCatalog
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService

class WearPhoneMessageService : WearableListenerService() {
    override fun onMessageReceived(event: MessageEvent) {
        if (event.path != CONTROL_PATH) return
        val message = try { org.json.JSONObject(String(event.data, Charsets.UTF_8)) } catch (_: Exception) { return }
        when (message.optString("type")) {
            "start" -> {
                if (message.keys().asSequence().toSet() != setOf("type", "sessionToken", "phoneApi")) return
                val phoneApi = message.opt("phoneApi") as? Int ?: return
                val token = message.opt("sessionToken") as? String ?: return
                if (!Regex("^[0-9a-f]{32}$").matches(token)) return
                val profile = GalaxyWatchCatalog.lookup(Build.MODEL)
                if (profile == null) {
                    HeartRateExerciseService.sendPhoneMessage(this, "unsupported-model", token)
                    return
                }
                if (!GalaxyWatchCatalog.watchAllowed(profile, Build.VERSION.SDK_INT) || !GalaxyWatchCatalog.phoneAllowed(profile, phoneApi)) {
                    HeartRateExerciseService.sendPhoneMessage(this, "unsupported-os", token)
                    return
                }
                if (!sensorPermissionGranted()) {
                    HeartRateExerciseService.sendPhoneMessage(this, "permission-unavailable", token)
                    return
                }
                val service = Intent(this, HeartRateExerciseService::class.java)
                    .setAction(HeartRateExerciseService.ACTION_START)
                    .putExtra(HeartRateExerciseService.EXTRA_SESSION_TOKEN, token)
                try { startForegroundService(service) }
                catch (_: Exception) { HeartRateExerciseService.sendPhoneMessage(this, "permission-unavailable", token) }
            }
            "stop" -> if (message.keys().asSequence().toSet() == setOf("type")) stopService(Intent(this, HeartRateExerciseService::class.java))
        }
    }

    private fun sensorPermissionGranted(): Boolean {
        val permission = if (applicationInfo.targetSdkVersion >= 36) "android.permission.health.READ_HEART_RATE" else android.Manifest.permission.BODY_SENSORS
        return checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
    }

    companion object { private const val CONTROL_PATH = "/peloop/student-control/v1" }
}
