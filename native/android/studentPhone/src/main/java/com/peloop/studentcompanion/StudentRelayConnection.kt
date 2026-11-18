package com.peloop.studentcompanion

import com.peloop.wearable.GalaxyWatchProfile
import com.peloop.wearable.GalaxyWatchCatalog
import android.net.Network
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.json.JSONObject
import java.net.Inet4Address
import java.security.cert.X509Certificate
import java.util.Base64
import java.util.concurrent.TimeUnit

internal data class RelayAck(val sessionId: String, val resumeToken: String?, val serverTime: Long) {
    val isResume: Boolean get() = resumeToken == null

    companion object {
        fun parse(text: String, expectedSessionId: String): RelayAck {
            val value = try { JSONObject(text) } catch (_: Exception) { throw IllegalArgumentException("태블릿 연결 응답을 읽을 수 없습니다.") }
            val type = value.optString("type")
            val resumed = type == "session-resumed"
            val keys = if (resumed) setOf("type", "sessionId", "serverTime") else setOf("type", "sessionId", "resumeToken", "serverTime")
            require(type == "session-ready" || resumed) { "태블릿이 연결을 승인하지 않았습니다." }
            require(value.keys().asSequence().toSet() == keys) { "태블릿 연결 응답 형식이 올바르지 않습니다." }
            val sessionId = value.optString("sessionId").lowercase()
            require(sessionId == expectedSessionId.lowercase()) { "태블릿 연결 세션이 QR과 다릅니다." }
            val serverTimestampValue = value.opt("serverTime") as? Number ?: throw IllegalArgumentException("태블릿 시각을 확인할 수 없습니다.")
            val serverTime = serverTimestampValue.toLong()
            require(serverTimestampValue.toDouble() == serverTime.toDouble() && serverTime in 1..MAX_SAFE_JSON_INTEGER) { "태블릿 시각을 확인할 수 없습니다." }
            val token = if (resumed) null else value.optString("resumeToken")
            if (token != null) require(validResumeToken(token)) { "재연결 자격 형식이 올바르지 않습니다." }
            return RelayAck(sessionId, token, serverTime)
        }

        private fun validResumeToken(token: String): Boolean = Regex("^[A-Za-z0-9_-]{43}$").matches(token) &&
            runCatching { Base64.getUrlDecoder().decode(token).size == 32 }.getOrDefault(false)

        private const val MAX_SAFE_JSON_INTEGER = 9_007_199_254_740_991L
    }
}

internal interface RelayConnectionListener {
    fun onReady(ack: RelayAck, phoneTimeAtAck: Long)
    fun onClosed(message: String?)
}

/** Direct local-Wi-Fi WebSocket. The only trust anchor is the public-key pin carried by the one-use QR. */
internal class StudentRelayConnection(
    private val invite: PairingInvite,
    private val address: Inet4Address,
    private val port: Int,
    network: Network,
    private val credential: String,
    private val listener: RelayConnectionListener,
) {
    private val ssl = PinnedTlsTrustManager.context(invite.fingerprint)
    private val okHttp = OkHttpClient.Builder()
        .socketFactory(network.socketFactory)
        .sslSocketFactory(ssl.first.socketFactory, ssl.second)
        .hostnameVerifier { _, session ->
            val cert = session.peerCertificates.firstOrNull() as? X509Certificate ?: return@hostnameVerifier false
            PinnedTlsTrustManager.fingerprint(cert) == invite.fingerprint
        }
        .connectTimeout(6, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .retryOnConnectionFailure(false)
        .build()
    private val lock = Any()
    private var socket: WebSocket? = null
    private var ack: RelayAck? = null
    private var closedByOwner = false
    private var notifiedClose = false
    private var deviceProfile: GalaxyWatchProfile? = null
    private var heartRateAvailable = false
    private var phoneTimeAtAck = 0L

    fun connect() {
        val request = Request.Builder()
            .url("wss://${address.hostAddress}:$port/wearable/v1")
            .header("Authorization", "Bearer $credential")
            .build()
        synchronized(lock) {
            check(socket == null)
            socket = okHttp.newWebSocket(request, object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) = Unit

                override fun onMessage(webSocket: WebSocket, text: String) {
                    val current = synchronized(lock) { ack }
                    if (current != null) {
                        webSocket.close(1008, "Unexpected relay message")
                        return
                    }
                    try {
                        val parsed = RelayAck.parse(text, invite.sessionId)
                        val phoneNow = System.currentTimeMillis()
                        synchronized(lock) {
                            if (closedByOwner) return
                            ack = parsed
                            phoneTimeAtAck = phoneNow
                            notifiedClose = false
                        }
                        listener.onReady(parsed, phoneNow)
                        sendDeviceReadyIfAvailable()
                    } catch (error: Exception) {
                        webSocket.close(1008, "Invalid relay response")
                        notifyClosed(error.message)
                    }
                }

                override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                    webSocket.close(1008, "Unexpected relay message")
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    notifyClosed("로컬 연결이 끊겼습니다.")
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    notifyClosed(reason.takeIf { it.isNotBlank() })
                }
            })
        }
    }

    fun setDevice(profile: GalaxyWatchProfile?, available: Boolean) {
        synchronized(lock) {
            deviceProfile = profile
            heartRateAvailable = available && profile != null
        }
        sendDeviceReadyIfAvailable()
    }

    fun sendSample(bpm: Double, watchTimestamp: Long): Boolean {
        val state = synchronized(lock) { Triple(socket, ack, deviceProfile to heartRateAvailable) }
        val ws = state.first ?: return false
        val handshake = state.second ?: return false
        state.third.first ?: return false
        if (!state.third.second || !bpm.isFinite() || bpm !in 20.0..250.0) return false
        if (watchTimestamp <= 0) return false
        val phoneNow = System.currentTimeMillis()
        val translatedHostTimestamp = phoneNow + (handshake.serverTime - stateTimeAtAck())
        return try { ws.send(WearableWireMessage.relaySample(bpm, translatedHostTimestamp)) } catch (_: Exception) { false }
    }

    fun sendStatus(type: String): Boolean {
        require(type in setOf("permission-unavailable", "permission-revoked", "disconnected"))
        val ws = synchronized(lock) { socket?.takeIf { ack != null } } ?: return false
        return try { ws.send(org.json.JSONObject().put("type", type).toString()) } catch (_: Exception) { false }
    }

    fun close() {
        val ws = synchronized(lock) {
            closedByOwner = true
            socket.also { socket = null; ack = null; deviceProfile = null; heartRateAvailable = false }
        }
        try { ws?.close(1000, "Student session stopped") } catch (_: Exception) { }
        okHttp.dispatcher.cancelAll()
        okHttp.connectionPool.evictAll()
    }

    private fun sendDeviceReadyIfAvailable() {
        val state = synchronized(lock) { Triple(socket, ack, deviceProfile to heartRateAvailable) }
        val ws = state.first ?: return
        if (state.second == null) return
        val profile = state.third.first ?: return
        try { ws.send(WearableWireMessage.deviceReady(profile, state.third.second)) } catch (_: Exception) { }
    }

    private fun stateTimeAtAck(): Long = synchronized(lock) { phoneTimeAtAck }

    private fun notifyClosed(message: String?) {
        val shouldNotify = synchronized(lock) {
            if (closedByOwner || notifiedClose) false
            else {
                notifiedClose = true
                ack = null
                true
            }
        }
        if (shouldNotify) listener.onClosed(message)
    }

}
