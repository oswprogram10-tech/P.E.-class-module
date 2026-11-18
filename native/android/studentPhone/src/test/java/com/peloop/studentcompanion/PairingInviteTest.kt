package com.peloop.studentcompanion

import com.peloop.wearable.GalaxyWatchCatalog
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Assert.assertNotNull
import org.junit.Test
import java.util.Base64
import java.util.UUID

class PairingInviteTest {
    private val now = 1_800_000_000_000L

    @Test fun parsesValidPrivateLanInvitation() {
        val invite = PairingInvite.parse(payload(), now)
        assertEquals("192.168.1.25", invite.host.hostAddress)
        assertEquals(49152, invite.port)
        assertEquals("wss://192.168.1.25:49152/wearable/v1", invite.websocketUrl())
        assertEquals("a".repeat(64), invite.fingerprint)
    }

    @Test fun rejectsExpiredAndOverlongInvitations() {
        assertThrows(IllegalArgumentException::class.java) { PairingInvite.parse(payload(expiry = now), now) }
        assertThrows(IllegalArgumentException::class.java) { PairingInvite.parse(payload(expiry = now + PairingInvite.TTL_LIMIT_MS + 5_001), now) }
    }

    @Test fun rejectsPublicOrMalformedAddressesAndPorts() {
        assertThrows(IllegalArgumentException::class.java) { PairingInvite.parse(payload(host = "8.8.8.8"), now) }
        assertThrows(IllegalArgumentException::class.java) { PairingInvite.parse(payload(host = "192.168.001.2"), now) }
        assertThrows(IllegalArgumentException::class.java) { PairingInvite.parse(payload(port = 80), now) }
    }

    @Test fun rejectsUnexpectedFieldsAndMalformedCredentials() {
        assertThrows(IllegalArgumentException::class.java) { PairingInvite.parse(payload(extra = true), now) }
        assertThrows(IllegalArgumentException::class.java) { PairingInvite.parse(payload(ticket = "short"), now) }
        assertThrows(IllegalArgumentException::class.java) { PairingInvite.parse(payload(fingerprint = "b"), now) }
    }

    private fun payload(
        host: String = "192.168.1.25",
        port: Int = 49152,
        expiry: Long = now + 60_000,
        ticket: String = Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(32) { 3 }),
        fingerprint: String = "a".repeat(64),
        extra: Boolean = false,
    ): String {
        val json = JSONObject()
            .put("v", 1)
            .put("host", host)
            .put("port", port)
            .put("sessionId", UUID.fromString("bc2d433c-8762-4b5b-a6d4-0c229d147087").toString())
            .put("ticket", ticket)
            .put("fingerprint", fingerprint)
            .put("expiresAt", expiry)
        if (extra) json.put("studentId", "must-not-be-present")
        val encoded = Base64.getUrlEncoder().withoutPadding().encodeToString(json.toString().toByteArray())
        return PairingInvite.PREFIX + encoded
    }
}

class WearableWireMessageTest {
    private val sessionToken = "c".repeat(32)

    @Test fun acceptsOnlyCataloguedGalaxyModelsAndValidHeartRate() {
        val profile = GalaxyWatchCatalog.lookup("SM-R940")
        assertEquals("2023-08-11", profile?.releaseDate)
        val ready = WearableWireMessage.parse(JSONObject().put("type", "ready").put("model", "SM-R940").put("watchApi", 33).put("heartRateAvailable", true).put("sessionToken", sessionToken).toString().toByteArray())
        assertTrue(ready is WearableWireMessage.Ready)
        assertTrue(WearableWireMessage.parse(JSONObject().put("type", "sample").put("bpm", 86.5).put("timestamp", 1_800_000_000_000L).put("sessionToken", sessionToken).toString().toByteArray()) is WearableWireMessage.Sample)
        assertEquals(null, WearableWireMessage.parse(JSONObject().put("type", "sample").put("bpm", 0).put("timestamp", 1).put("sessionToken", sessionToken).toString().toByteArray()))
        assertTrue(WearableWireMessage.parse(JSONObject().put("type", "ready").put("model", "unknown").put("watchApi", 33).put("heartRateAvailable", true).put("sessionToken", sessionToken).toString().toByteArray()) is WearableWireMessage.Unsupported)
        assertEquals(null, WearableWireMessage.parse(JSONObject().put("type", "ready").put("model", "SM-R940").put("watchApi", 33).put("heartRateAvailable", "true").put("sessionToken", sessionToken).toString().toByteArray()))
        assertEquals(null, WearableWireMessage.parse(JSONObject().put("type", "permission-unavailable").toString().toByteArray()))
    }

    @Test fun catalogAndOsConditionsAreConservative() {
        for (id in listOf("SM-R935N", "SM-R861N", "SM-L705U", "SM-L325F", "SM-L505U", "SM-L715N")) assertNotNull(GalaxyWatchCatalog.lookup(id))
        for (id in listOf("SM-R866", "SM-R866U", "SM-L715", "SM-L325XYZ", "unknown")) assertEquals(null, GalaxyWatchCatalog.lookup(id))
        val profile = GalaxyWatchCatalog.lookup("SM-L325F")!!
        assertEquals("2025-07-25", profile.releaseDate)
        assertTrue(GalaxyWatchCatalog.watchAllowed(profile, 36))
        assertTrue(!GalaxyWatchCatalog.watchAllowed(profile, 35))
        assertTrue(GalaxyWatchCatalog.phoneAllowed(profile, 31))
        assertTrue(!GalaxyWatchCatalog.phoneAllowed(profile, 30))
        val watch9 = GalaxyWatchCatalog.lookup("SM-L355U")!!
        assertEquals("2026-08-07", watch9.releaseDate)
        assertTrue(!GalaxyWatchCatalog.watchAllowed(watch9, 36))
        assertTrue(GalaxyWatchCatalog.watchAllowed(watch9, 37))
        assertTrue(!GalaxyWatchCatalog.phoneAllowed(watch9, 32))
        assertTrue(GalaxyWatchCatalog.phoneAllowed(watch9, 33))
        val low = JSONObject().put("type", "ready").put("model", "SM-L325F").put("watchApi", 35).put("heartRateAvailable", true).put("sessionToken", sessionToken)
        assertTrue(WearableWireMessage.parse(low.toString().toByteArray()) is WearableWireMessage.OsUnsupported)
        low.remove("watchApi")
        assertEquals(null, WearableWireMessage.parse(low.toString().toByteArray()))
    }

    @Test fun encodesHostProtocolFramesWithoutStudentIdentifiers() {
        val profile = GalaxyWatchCatalog.lookup("SM-R940")!!
        val device = JSONObject(WearableWireMessage.deviceReady(profile, true))
        assertEquals(setOf("type", "device"), device.keys().asSequence().toSet())
        assertEquals(setOf("platform", "model", "releaseDate", "heartRateAvailable"), device.getJSONObject("device").keys().asSequence().toSet())
        val sample = JSONObject(WearableWireMessage.relaySample(86.5, 1_800_000_000_000L))
        assertEquals(setOf("type", "metric", "value", "timestamp"), sample.keys().asSequence().toSet())
    }

    @Test fun watchSamplesAreBoundToTheCurrentVolatileSession() {
        val accepted = JSONObject(WearableWireMessage.watchSample(86.5, 1_800_000_000_000L, sessionToken))
        assertEquals(setOf("type", "bpm", "timestamp", "sessionToken"), accepted.keys().asSequence().toSet())
        assertNotNull(WearableWireMessage.parse(accepted.toString().toByteArray()))
        assertEquals(null, WearableWireMessage.parse(accepted.put("sessionToken", "old").toString().toByteArray()))
    }
}

class RelayAckTest {
    private val sessionId = "bc2d433c-8762-4b5b-a6d4-0c229d147087"
    private val resumeToken = Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(32) { 7 })

    @Test fun acceptsOnlyTheExpectedSessionAndResumeCredential() {
        val ready = RelayAck.parse(
            JSONObject().put("type", "session-ready").put("sessionId", sessionId).put("resumeToken", resumeToken).put("serverTime", 1_800_000_000_000L).toString(),
            sessionId,
        )
        assertEquals(resumeToken, ready.resumeToken)
        assertEquals(1_800_000_000_000L, ready.serverTime)
        assertTrue(!ready.isResume)
        val resumed = RelayAck.parse(
            JSONObject().put("type", "session-resumed").put("sessionId", sessionId).put("serverTime", 1_800_000_000_001L).toString(),
            sessionId,
        )
        assertEquals(null, resumed.resumeToken)
        assertTrue(resumed.isResume)
    }

    @Test fun rejectsMismatchedSessionMalformedResumeAndUnexpectedFields() {
        assertThrows(IllegalArgumentException::class.java) {
            RelayAck.parse(JSONObject().put("type", "session-ready").put("sessionId", UUID.randomUUID()).put("resumeToken", resumeToken).put("serverTime", 1).toString(), sessionId)
        }
        assertThrows(IllegalArgumentException::class.java) {
            RelayAck.parse(JSONObject().put("type", "session-ready").put("sessionId", sessionId).put("resumeToken", "short").put("serverTime", 1).toString(), sessionId)
        }
        assertThrows(IllegalArgumentException::class.java) {
            RelayAck.parse(JSONObject().put("type", "session-resumed").put("sessionId", sessionId).put("serverTime", 1).put("extra", true).toString(), sessionId)
        }
    }

    @Test fun reconnectDelayIsBounded() {
        assertEquals(1_000L, ReconnectDelay.forAttempt(0))
        assertEquals(30_000L, ReconnectDelay.forAttempt(5))
        assertEquals(30_000L, ReconnectDelay.forAttempt(99))
    }
}
