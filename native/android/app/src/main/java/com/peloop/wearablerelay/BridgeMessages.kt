package com.peloop.wearablerelay

import org.json.JSONObject

internal object BridgeMessages {
    fun event(listenerId: String, eventJson: String): String = JSONObject()
        .put("type", "event")
        .put("listenerId", listenerId)
        .put("event", JSONObject(eventJson))
        .toString()
}
