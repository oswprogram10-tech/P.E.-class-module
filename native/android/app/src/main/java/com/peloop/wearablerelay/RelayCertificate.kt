package com.peloop.wearablerelay

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.math.BigInteger
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Date
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext
import javax.security.auth.x500.X500Principal

internal data class RelayTlsIdentity(val sslContext: SSLContext, val publicKeyFingerprint: String)

internal object RelayCertificate {
    private const val KEY_ALIAS = "PELoopLocalWearableRelay"
    private const val VALIDITY_YEARS = 10L

    @Synchronized
    fun loadOrCreate(): RelayTlsIdentity {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        if (!store.containsAlias(KEY_ALIAS)) createKey()
        val certificate = store.getCertificate(KEY_ALIAS)
            ?: throw IllegalStateException("태블릿 인증서를 만들지 못했습니다.")
        val keyManagers = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm()).apply {
            init(store, null)
        }
        val context = SSLContext.getInstance("TLSv1.2").apply {
            init(keyManagers.keyManagers, null, SecureRandom())
        }
        val fingerprint = MessageDigest.getInstance("SHA-256")
            .digest(certificate.publicKey.encoded)
            .joinToString("") { byte -> "%02x".format(byte) }
        return RelayTlsIdentity(context, fingerprint)
    }

    private fun createKey() {
        val now = System.currentTimeMillis()
        val spec = KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_SIGN)
            .setKeySize(2048)
            .setDigests(KeyProperties.DIGEST_SHA256)
            .setSignaturePaddings(KeyProperties.SIGNATURE_PADDING_RSA_PKCS1)
            .setCertificateSubject(X500Principal("CN=PE Loop local relay"))
            .setCertificateSerialNumber(BigInteger.valueOf(now.coerceAtLeast(1L)))
            .setCertificateNotBefore(Date(now - 60_000L))
            .setCertificateNotAfter(Date(now + VALIDITY_YEARS * 365L * 24L * 60L * 60L * 1000L))
            .build()
        KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA, "AndroidKeyStore")
            .apply { initialize(spec) }
            .generateKeyPair()
    }
}
