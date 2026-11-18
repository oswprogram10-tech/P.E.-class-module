package com.peloop.studentcompanion

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Handler
import android.os.Looper
import java.net.Inet4Address

internal data class RelayEndpoint(val address: Inet4Address, val port: Int)

/** Finds the tablet again after its DHCP address changes; TLS pinning remains the trust check. */
internal class NsdRelayResolver(context: Context, private val invite: PairingInvite) : AutoCloseable {
    private val manager = context.applicationContext.getSystemService(Context.NSD_SERVICE) as NsdManager
    private val handler = Handler(Looper.getMainLooper())
    private val lock = Any()
    private var listener: NsdManager.DiscoveryListener? = null
    private var completed = false
    private var resolving = false
    private var timeout: Runnable? = null

    fun find(callback: (RelayEndpoint?) -> Unit) {
        val discovery = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(serviceType: String) = Unit

            override fun onServiceFound(serviceInfo: NsdServiceInfo) {
                if (serviceInfo.serviceType != SERVICE_TYPE || !matches(serviceInfo)) return
                val shouldResolve = synchronized(lock) {
                    if (completed || resolving) false else { resolving = true; true }
                }
                if (!shouldResolve) return
                stopDiscovery(this)
                try {
                    @Suppress("DEPRECATION")
                    manager.resolveService(serviceInfo, object : NsdManager.ResolveListener {
                        override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) = finish(callback, null)
                        override fun onServiceResolved(resolved: NsdServiceInfo) {
                            val address = resolved.host as? Inet4Address
                            val endpoint = address?.takeIf { isPrivate(it.hostAddress ?: "") }
                                ?.let { RelayEndpoint(it, resolved.port) }
                                ?.takeIf { it.port in 1024..65_535 }
                            finish(callback, endpoint)
                        }
                    })
                } catch (_: Exception) { finish(callback, null) }
            }

            override fun onServiceLost(serviceInfo: NsdServiceInfo) = Unit
            override fun onDiscoveryStopped(serviceType: String) = Unit
            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) = finish(callback, null)
            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) { try { manager.stopServiceDiscovery(this) } catch (_: Exception) { } }
        }
        synchronized(lock) {
            if (completed) return
            listener = discovery
            timeout = Runnable { finish(callback, null) }.also { handler.postDelayed(it, TIMEOUT_MS) }
        }
        try { manager.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, discovery) }
        catch (_: Exception) { finish(callback, null) }
    }

    override fun close() {
        val current = synchronized(lock) {
            if (completed) return
            completed = true
            val scheduled = timeout.also { timeout = null }
            val active = listener.also { listener = null }
            scheduled to active
        }
        current.first?.let(handler::removeCallbacks)
        current.second?.let { try { manager.stopServiceDiscovery(it) } catch (_: Exception) { } }
    }

    private fun matches(info: NsdServiceInfo): Boolean {
        val session = info.attributes["sid"]?.toString(Charsets.UTF_8)
        val fingerprint = info.attributes["fp"]?.toString(Charsets.UTF_8)
        return session.equals(invite.sessionId, ignoreCase = true) && fingerprint == invite.fingerprint
    }

    private fun stopDiscovery(expected: NsdManager.DiscoveryListener) {
        synchronized(lock) { if (listener !== expected || completed) return }
        try { manager.stopServiceDiscovery(expected) } catch (_: Exception) { }
    }

    private fun finish(callback: (RelayEndpoint?) -> Unit, endpoint: RelayEndpoint?) {
        val current = synchronized(lock) {
            if (completed) return
            completed = true
            val scheduled = timeout.also { timeout = null }
            val active = listener.also { listener = null }
            scheduled to active
        }
        current.first?.let(handler::removeCallbacks)
        current.second?.let { try { manager.stopServiceDiscovery(it) } catch (_: Exception) { } }
        callback(endpoint)
    }

    private fun isPrivate(value: String): Boolean {
        if (!Regex("^(?:[0-9]{1,3}\\.){3}[0-9]{1,3}$").matches(value)) return false
        val octets = value.split('.').map { it.toIntOrNull() ?: return false }
        if (octets.any { it !in 0..255 }) return false
        return octets[0] == 10 || (octets[0] == 172 && octets[1] in 16..31) || (octets[0] == 192 && octets[1] == 168)
    }

    companion object {
        private const val SERVICE_TYPE = "_peloop-wearable._tcp."
        private const val TIMEOUT_MS = 8_000L
    }
}
