package com.peloop.wearablerelay

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo

internal class RelayDiscovery(context: Context) : AutoCloseable {
    private val appContext = context.applicationContext
    private val connectivity = appContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    private val nsdManager = appContext.getSystemService(Context.NSD_SERVICE) as NsdManager
    private val lock = Any()
    private val desired = mutableMapOf<String, ServiceRecord>()
    private val registrations = mutableMapOf<String, NsdManager.RegistrationListener>()
    private var closed = false

    private data class ServiceRecord(val sessionId: String, val port: Int, val fingerprint: String)

    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) { refreshServices() }
        override fun onLinkPropertiesChanged(network: Network, properties: android.net.LinkProperties) { refreshServices() }
        override fun onLost(network: Network) { refreshServices() }
    }

    init {
        connectivity.registerNetworkCallback(
            NetworkRequest.Builder().addTransportType(NetworkCapabilities.TRANSPORT_WIFI).build(),
            networkCallback,
        )
    }

    fun publish(sessionId: String, port: Int, fingerprint: String) {
        val record = ServiceRecord(sessionId, port, fingerprint)
        synchronized(lock) {
            if (closed) return
            desired[sessionId] = record
        }
        register(record)
    }

    fun unpublish(sessionId: String) {
        val listener = synchronized(lock) {
            desired.remove(sessionId)
            registrations.remove(sessionId)
        } ?: return
        try { nsdManager.unregisterService(listener) } catch (_: Exception) { }
    }

    override fun close() {
        val listeners = synchronized(lock) {
            if (closed) return
            closed = true
            desired.clear()
            registrations.values.toList().also { registrations.clear() }
        }
        try { connectivity.unregisterNetworkCallback(networkCallback) } catch (_: Exception) { }
        listeners.forEach { listener -> try { nsdManager.unregisterService(listener) } catch (_: Exception) { } }
    }

    private fun refreshServices() {
        val records = synchronized(lock) {
            if (closed) return
            registrations.values.toList().also { registrations.clear() } to desired.values.toList()
        }
        records.first.forEach { listener -> try { nsdManager.unregisterService(listener) } catch (_: Exception) { } }
        records.second.forEach(::register)
    }

    private fun register(record: ServiceRecord) {
        val service = NsdServiceInfo().apply {
            serviceName = "PELoop-${record.sessionId.take(8)}"
            serviceType = SERVICE_TYPE
            setPort(record.port)
            setAttribute("sid", record.sessionId)
            setAttribute("fp", record.fingerprint)
        }
        val listener = object : NsdManager.RegistrationListener {
            override fun onServiceRegistered(serviceInfo: NsdServiceInfo) = Unit
            override fun onRegistrationFailed(serviceInfo: NsdServiceInfo, errorCode: Int) { remove(record.sessionId, this) }
            override fun onServiceUnregistered(serviceInfo: NsdServiceInfo) = Unit
            override fun onUnregistrationFailed(serviceInfo: NsdServiceInfo, errorCode: Int) = Unit
        }
        synchronized(lock) {
            if (closed || desired[record.sessionId] != record || registrations.containsKey(record.sessionId)) return
            registrations[record.sessionId] = listener
        }
        try {
            nsdManager.registerService(service, NsdManager.PROTOCOL_DNS_SD, listener)
        } catch (_: Exception) {
            remove(record.sessionId, listener)
        }
    }

    private fun remove(sessionId: String, listener: NsdManager.RegistrationListener) {
        synchronized(lock) { if (registrations[sessionId] === listener) registrations.remove(sessionId) }
    }

    companion object {
        const val SERVICE_TYPE = "_peloop-wearable._tcp."
    }
}
