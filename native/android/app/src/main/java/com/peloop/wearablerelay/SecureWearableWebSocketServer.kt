package com.peloop.wearablerelay

import org.java_websocket.WebSocket
import org.java_websocket.drafts.Draft_6455
import org.java_websocket.framing.CloseFrame
import org.java_websocket.handshake.ClientHandshake
import org.java_websocket.server.DefaultSSLWebSocketServerFactory
import org.java_websocket.server.WebSocketServer
import java.net.InetSocketAddress
import java.nio.charset.StandardCharsets
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext

internal interface RelaySocketCallbacks {
    fun authorize(socket: WebSocket, credential: String): String?
    fun onText(socket: WebSocket, message: String)
    fun onClosed(socket: WebSocket)
}

internal class SecureWearableWebSocketServer(
    address: InetSocketAddress,
    tlsContext: SSLContext,
    private val callbacks: RelaySocketCallbacks,
) : WebSocketServer(address, 1, listOf(Draft_6455(emptyList(), MAX_FRAME_BYTES))) {
    private val started = CountDownLatch(1)
    @Volatile private var startupFailed = false

    init {
        setWebSocketFactory(DefaultSSLWebSocketServerFactory(tlsContext))
        setMaxPendingConnections(1)
        setConnectionLostTimeout(8)
        setTcpNoDelay(true)
    }

    fun startAndWait() {
        start()
        if (!started.await(6, TimeUnit.SECONDS) || startupFailed) {
            try { stop(200) } catch (_: Exception) { }
            throw IllegalStateException("태블릿 로컬 수신기를 열지 못했습니다.")
        }
    }

    override fun onOpen(socket: WebSocket, handshake: ClientHandshake) {
        if (handshake.resourceDescriptor != ENDPOINT) {
            socket.close(CloseFrame.POLICY_VALIDATION, "Rejected")
            return
        }
        val authorization = handshake.getFieldValue("Authorization")
        val ticket = authorization.removePrefix("Bearer ")
        if (ticket == authorization || ticket.isBlank()) {
            socket.close(CloseFrame.POLICY_VALIDATION, "Rejected")
            return
        }
        val acknowledgement = callbacks.authorize(socket, ticket)
        if (acknowledgement == null) socket.close(CloseFrame.POLICY_VALIDATION, "Rejected") else socket.send(acknowledgement)
    }

    override fun onMessage(socket: WebSocket, message: String) {
        if (message.toByteArray(StandardCharsets.UTF_8).size > MAX_FRAME_BYTES) {
            socket.close(CloseFrame.TOOBIG, "Rejected")
            return
        }
        callbacks.onText(socket, message)
    }

    override fun onClose(socket: WebSocket, code: Int, reason: String, remote: Boolean) {
        callbacks.onClosed(socket)
    }

    override fun onError(socket: WebSocket?, error: Exception) {
        if (socket == null) {
            startupFailed = true
            started.countDown()
        }
        // No payload or exception text is written to logs.
    }

    override fun onStart() {
        started.countDown()
    }

    companion object {
        const val ENDPOINT = "/wearable/v1"
        private const val MAX_FRAME_BYTES = 2048
    }
}
