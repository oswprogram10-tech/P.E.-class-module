package com.peloop.wearablerelay

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

internal class NativeWearableBridge(context: Context) : AutoCloseable {
    private val mainHandler = Handler(Looper.getMainLooper())
    @Volatile private var closed = false
    private val eventReplies = ConcurrentHashMap<String, JavaScriptReplyProxy>()
    private val worker = Executors.newSingleThreadExecutor { task ->
        Thread(task, "PELoop-native-bridge").apply { isDaemon = true }
    }
    private val relay = WearableRelayManager(context) { listenerId, eventJson ->
        eventReplies[listenerId]?.let { reply ->
            val message = BridgeMessages.event(listenerId, eventJson)
            mainHandler.post {
                if (!closed && eventReplies[listenerId] === reply) {
                    try { postMessageIfSupported(reply, message) } catch (_: Exception) { eventReplies.remove(listenerId, reply) }
                }
            }
        }
    }

    fun onPostMessage(raw: String?, sourceOrigin: Uri, isMainFrame: Boolean, replyProxy: JavaScriptReplyProxy) {
        if (closed || !isMainFrame || sourceOrigin.toString() != APP_ORIGIN || raw == null || raw.toByteArray(StandardCharsets.UTF_8).size > MAX_REQUEST_BYTES) return
        val envelope = try { JSONObject(raw) } catch (_: Exception) { return }
        if (!hasOnlyKeys(envelope, setOf("id", "method", "payload"))) return
        val requestId = envelope.optString("id")
        val method = envelope.optString("method")
        val payload = envelope.optJSONObject("payload") ?: return reply(replyProxy, requestId, false, null, INVALID_REQUEST)
        if (!isUuid(requestId) || method.length > 40) return

        try {
            worker.execute {
                try {
                    val result = when (method) {
                        "createPairingSession" -> relay.createPairingSession(payload)
                        "reconnectSession" -> relay.reconnectSession(payload)
                        "stopSession" -> stopSession(payload)
                        "subscribe" -> subscribe(payload, replyProxy)
                        "unsubscribe" -> unsubscribe(payload)
                        else -> throw IllegalArgumentException(INVALID_REQUEST)
                    }
                    reply(replyProxy, requestId, true, result, null)
                } catch (error: Exception) {
                    val message = when (error) {
                        is IllegalArgumentException, is IllegalStateException -> error.message?.takeIf { it.length <= 120 } ?: REQUEST_FAILED
                        else -> REQUEST_FAILED
                    }
                    reply(replyProxy, requestId, false, null, message)
                }
            }
        } catch (_: Exception) {
            reply(replyProxy, requestId, false, null, REQUEST_FAILED)
        }
    }

    override fun close() {
        closed = true
        mainHandler.removeCallbacksAndMessages(null)
        eventReplies.clear()
        relay.close()
        worker.shutdownNow()
    }

    private fun stopSession(payload: JSONObject): Any? {
        require(hasOnlyKeys(payload, setOf("sessionId"))) { INVALID_REQUEST }
        val sessionId = payload.optString("sessionId")
        require(isUuid(sessionId)) { INVALID_REQUEST }
        relay.stopSession(sessionId)
        return null
    }

    private fun subscribe(payload: JSONObject, replyProxy: JavaScriptReplyProxy): Any? {
        require(hasOnlyKeys(payload, setOf("listenerId"))) { INVALID_REQUEST }
        val listenerId = payload.optString("listenerId")
        require(isUuid(listenerId)) { INVALID_REQUEST }
        eventReplies[listenerId] = replyProxy
        try {
            relay.subscribe(listenerId)
        } catch (error: Exception) {
            eventReplies.remove(listenerId, replyProxy)
            throw error
        }
        return null
    }

    private fun unsubscribe(payload: JSONObject): Any? {
        require(hasOnlyKeys(payload, setOf("listenerId"))) { INVALID_REQUEST }
        val listenerId = payload.optString("listenerId")
        require(isUuid(listenerId)) { INVALID_REQUEST }
        eventReplies.remove(listenerId)
        relay.unsubscribe(listenerId)
        return null
    }

    private fun reply(proxy: JavaScriptReplyProxy, requestId: String, ok: Boolean, data: Any?, error: String?) {
        val response = JSONObject().put("id", requestId).put("ok", ok).put("data", data ?: JSONObject.NULL)
        if (error != null) response.put("error", error)
        val message = response.toString()
        mainHandler.post {
            if (!closed) try { postMessageIfSupported(proxy, message) } catch (_: Exception) { }
        }
    }

    private fun postMessageIfSupported(proxy: JavaScriptReplyProxy, message: String) {
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) proxy.postMessage(message)
    }

    private fun hasOnlyKeys(value: JSONObject, expected: Set<String>): Boolean = value.keys().asSequence().toSet() == expected

    private fun isUuid(value: String): Boolean = UUID_REGEX.matches(value)

    companion object {
        const val APP_ORIGIN = "https://appassets.androidplatform.net"
        private const val MAX_REQUEST_BYTES = 8192
        private const val INVALID_REQUEST = "태블릿 연결 요청 형식이 올바르지 않습니다."
        private const val REQUEST_FAILED = "태블릿 연결 작업을 완료하지 못했습니다. Wi-Fi 상태를 확인해 주세요."
        private val UUID_REGEX = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$")
    }
}
