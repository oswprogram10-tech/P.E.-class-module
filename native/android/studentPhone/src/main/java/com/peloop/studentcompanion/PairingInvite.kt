package com.peloop.studentcompanion

import org.json.JSONObject
import java.net.Inet4Address
import java.net.InetAddress
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets
import java.util.Base64
import java.util.UUID

internal data class PairingInvite(
    val host: Inet4Address,
    val port: Int,
    val sessionId: String,
    val ticket: String,
    val fingerprint: String,
    val expiresAt: Long,
) {
    fun websocketUrl(): String = "wss://${host.hostAddress}:$port/wearable/v1"

    companion object {
        const val PREFIX = "PELOOP_PAIR_V1."
        const val TTL_LIMIT_MS = 120_000L
        private val REQUIRED_KEYS = setOf("v", "host", "port", "sessionId", "ticket", "fingerprint", "expiresAt")
        private val UUID_PATTERN = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$")
        private val TOKEN_PATTERN = Regex("^[A-Za-z0-9_-]{43}$")
        private val FINGERPRINT_PATTERN = Regex("^[0-9a-f]{64}$")

        fun parse(payload: String, now: Long = System.currentTimeMillis()): PairingInvite {
            require(payload.length in (PREFIX.length + 16)..4_096 && payload.startsWith(PREFIX)) { "교사 화면의 연결 QR을 다시 스캔해 주세요." }
            val encoded = payload.removePrefix(PREFIX)
            require(encoded.matches(Regex("^[A-Za-z0-9_-]+$"))) { "연결 QR 형식이 올바르지 않습니다." }
            val bytes = try { Base64.getUrlDecoder().decode(encoded) } catch (_: IllegalArgumentException) {
                throw IllegalArgumentException("연결 QR 형식이 올바르지 않습니다.")
            }
            require(bytes.size in 2..2_048) { "연결 QR 크기가 올바르지 않습니다." }
            val jsonText = try {
                StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(bytes)).toString()
            } catch (_: Exception) {
                throw IllegalArgumentException("연결 QR 문자를 읽을 수 없습니다.")
            }
            val json = try { JSONObject(jsonText) } catch (_: Exception) {
                throw IllegalArgumentException("연결 QR 내용을 읽을 수 없습니다.")
            }
            require(json.keys().asSequence().toSet() == REQUIRED_KEYS) { "지원하지 않는 연결 QR 형식입니다." }
            require(json.optInt("v", -1) == 1) { "지원하지 않는 연결 QR 버전입니다." }

            val hostText = json.optString("host")
            val host = parsePrivateIpv4(hostText) ?: throw IllegalArgumentException("교사 태블릿의 로컬 주소가 올바르지 않습니다.")
            val portValue = json.opt("port") as? Number ?: throw IllegalArgumentException("교사 태블릿의 포트가 올바르지 않습니다.")
            val port = portValue.toInt()
            require(portValue.toDouble() == port.toDouble() && port in 1_024..65_535) { "교사 태블릿의 포트가 올바르지 않습니다." }

            val sessionId = json.optString("sessionId")
            require(UUID_PATTERN.matches(sessionId) && UUID.fromString(sessionId).toString().equals(sessionId, ignoreCase = true)) { "연결 세션 ID가 올바르지 않습니다." }
            val ticket = json.optString("ticket")
            require(TOKEN_PATTERN.matches(ticket) && runCatching { Base64.getUrlDecoder().decode(ticket).size == 32 }.getOrDefault(false)) { "연결 티켓이 올바르지 않습니다." }
            val fingerprint = json.optString("fingerprint")
            require(FINGERPRINT_PATTERN.matches(fingerprint)) { "태블릿 보안 지문이 올바르지 않습니다." }
            val expiryValue = json.opt("expiresAt") as? Number ?: throw IllegalArgumentException("연결 초대 만료 시각이 올바르지 않습니다.")
            val expiresAt = expiryValue.toLong()
            require(expiryValue.toDouble() == expiresAt.toDouble() && expiresAt > now && expiresAt <= now + TTL_LIMIT_MS + 5_000L) { "연결 QR이 만료되었거나 만료 시각이 올바르지 않습니다." }

            return PairingInvite(host, port, sessionId.lowercase(), ticket, fingerprint, expiresAt)
        }

        private fun parsePrivateIpv4(value: String): Inet4Address? {
            if (!Regex("^(?:0|[1-9][0-9]{0,2})(?:\\.(?:0|[1-9][0-9]{0,2})){3}$").matches(value)) return null
            val pieces = value.split('.').map { it.toIntOrNull() ?: return null }
            if (pieces.any { it !in 0..255 }) return null
            val address = InetAddress.getByAddress(pieces.map(Int::toByte).toByteArray()) as? Inet4Address ?: return null
            val first = pieces[0]
            val second = pieces[1]
            return address.takeIf { first == 10 || (first == 172 && second in 16..31) || (first == 192 && second == 168) }
        }
    }
}
