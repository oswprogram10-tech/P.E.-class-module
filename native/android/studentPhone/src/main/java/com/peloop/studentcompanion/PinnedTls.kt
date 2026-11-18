package com.peloop.studentcompanion

import java.security.MessageDigest
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import android.annotation.SuppressLint
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

/** Trusts only the self-signed tablet certificate whose SPKI pin was carried by the one-use QR. */
@SuppressLint("CustomX509TrustManager")
internal class PinnedTlsTrustManager(expectedFingerprint: String) : X509TrustManager {
    private val expected = expectedFingerprint.lowercase().also {
        require(Regex("^[0-9a-f]{64}$").matches(it)) { "Invalid QR key fingerprint" }
    }.toByteArray(Charsets.US_ASCII)

    override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {
        throw CertificateException("Client certificates are not accepted")
    }

    override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
        val leaf = chain?.firstOrNull() ?: throw CertificateException("Relay did not provide a certificate")
        try { leaf.checkValidity() } catch (_: Exception) { throw CertificateException("Relay certificate is not currently valid") }
        val actual = MessageDigest.getInstance("SHA-256").digest(leaf.publicKey.encoded)
            .joinToString("") { byte -> (byte.toInt() and 0xff).toString(16).padStart(2, '0') }
            .toByteArray(Charsets.US_ASCII)
        if (!MessageDigest.isEqual(expected, actual)) throw CertificateException("Relay key does not match the QR fingerprint")
    }

    override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()

    companion object {
        fun context(fingerprint: String): Pair<SSLContext, PinnedTlsTrustManager> {
            val manager = PinnedTlsTrustManager(fingerprint)
            return SSLContext.getInstance("TLS").apply { init(null, arrayOf<TrustManager>(manager), null) } to manager
        }

        fun fingerprint(certificate: X509Certificate): String = MessageDigest.getInstance("SHA-256")
            .digest(certificate.publicKey.encoded)
            .joinToString("") { byte -> (byte.toInt() and 0xff).toString(16).padStart(2, '0') }
    }
}

internal object ReconnectDelay {
    private val SECONDS = longArrayOf(1, 2, 4, 8, 16, 30)
    fun forAttempt(attempt: Int): Long = SECONDS[attempt.coerceAtLeast(0).coerceAtMost(SECONDS.lastIndex)] * 1_000L
}
