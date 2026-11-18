package com.peloop.studentcompanion

import com.peloop.wearable.GalaxyWatchProfile
import com.peloop.wearable.GalaxyWatchCatalog
import org.json.JSONObject

internal sealed interface WearableWireMessage {
    val sessionToken: String
    data class Ready(val profile: GalaxyWatchProfile, val heartRateAvailable: Boolean, val watchApi: Int, override val sessionToken: String) : WearableWireMessage
    data class OsUnsupported(val model: String, override val sessionToken: String) : WearableWireMessage
    data class Unsupported(val model: String, override val sessionToken: String) : WearableWireMessage
    data class Sample(val bpm: Double, val timestamp: Long, override val sessionToken: String) : WearableWireMessage
    data class PermissionUnavailable(override val sessionToken: String) : WearableWireMessage
    data class PermissionRevoked(override val sessionToken: String) : WearableWireMessage
    data class Disconnected(override val sessionToken: String) : WearableWireMessage

    companion object {
        private const val PATH = "/peloop/student-heart-rate/v1"

        fun path(): String = PATH

        fun parse(bytes: ByteArray): WearableWireMessage? {
            if (bytes.size !in 2..1_024) return null
            val value = try { JSONObject(String(bytes, Charsets.UTF_8)) } catch (_: Exception) { return null }
            val token = value.opt("sessionToken") as? String ?: return null
            if (!Regex("^[0-9a-f]{32}$").matches(token)) return null
            return when (value.optString("type")) {
                "ready" -> {
                    if (value.keys().asSequence().toSet() != setOf("type", "model", "watchApi", "heartRateAvailable", "sessionToken")) return null
                    val model = (value.opt("model") as? String)?.trim()?.take(64) ?: return null
                    val available = value.opt("heartRateAvailable") as? Boolean ?: return null
                    val profile = GalaxyWatchCatalog.lookup(model) ?: return Unsupported(model, token)
                    val watchApi = value.opt("watchApi") as? Int ?: return null
                    if (!GalaxyWatchCatalog.watchAllowed(profile, watchApi)) return OsUnsupported(model, token)
                    Ready(profile, heartRateAvailable = available, watchApi, token)
                }
                "sample" -> {
                    if (value.keys().asSequence().toSet() != setOf("type", "bpm", "timestamp", "sessionToken")) return null
                    val raw = value.opt("bpm") as? Number ?: return null
                    val bpm = raw.toDouble()
                    val rawTimestamp = value.opt("timestamp") as? Number ?: return null
                    val timestamp = rawTimestamp.toLong()
                    if (!bpm.isFinite() || bpm !in 20.0..250.0 || rawTimestamp.toDouble() != timestamp.toDouble() || timestamp <= 0) null
                    else Sample(bpm, timestamp, token)
                }
                "unsupported-model" -> if (value.keys().asSequence().toSet() == setOf("type", "sessionToken")) Unsupported("unknown", token) else null
                "unsupported-os" -> if (value.keys().asSequence().toSet() == setOf("type", "sessionToken")) OsUnsupported("unknown", token) else null
                "permission-unavailable" -> if (value.keys().asSequence().toSet() == setOf("type", "sessionToken")) PermissionUnavailable(token) else null
                "permission-revoked" -> if (value.keys().asSequence().toSet() == setOf("type", "sessionToken")) PermissionRevoked(token) else null
                "disconnected" -> if (value.keys().asSequence().toSet() == setOf("type", "sessionToken")) Disconnected(token) else null
                else -> null
            }
        }

        fun deviceReady(profile: GalaxyWatchProfile, heartRateAvailable: Boolean): String = JSONObject()
            .put("type", "device-ready")
            .put("device", JSONObject()
                .put("platform", "galaxy-watch")
                .put("model", "${profile.productName} (${profile.modelCode})")
                .put("releaseDate", profile.releaseDate)
                .put("heartRateAvailable", heartRateAvailable))
            .toString()

        fun watchSample(bpm: Double, timestamp: Long, sessionToken: String): String {
            require(bpm.isFinite() && bpm in 20.0..250.0)
            require(timestamp > 0)
            require(Regex("^[0-9a-f]{32}$").matches(sessionToken))
            return JSONObject()
                .put("type", "sample")
                .put("bpm", bpm)
                .put("timestamp", timestamp)
                .put("sessionToken", sessionToken)
                .toString()
        }

        fun relaySample(bpm: Double, hostTimestamp: Long): String = JSONObject()
            .put("type", "sample")
            .put("metric", "heartRate")
            .put("value", bpm)
            .put("timestamp", hostTimestamp)
            .toString()
    }
}
