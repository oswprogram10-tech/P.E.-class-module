package com.peloop.wearablerelay

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class BridgeMessagesTest {
    @Test fun sampleIsWrappedForTheJavaScriptSubscriber() {
        val raw = """{"type":"sample","sessionId":"s1","metric":"heartRate","value":111,"timestamp":1000}"""
        val envelope = JSONObject(BridgeMessages.event("listener-1", raw))
        assertEquals("event", envelope.getString("type"))
        assertEquals("listener-1", envelope.getString("listenerId"))
        assertEquals("sample", envelope.getJSONObject("event").getString("type"))
        assertEquals(111, envelope.getJSONObject("event").getInt("value"))
        assertFalse(envelope.has("id"))
    }
}
