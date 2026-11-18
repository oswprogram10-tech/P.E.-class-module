package com.peloop.wearablerelay

import android.annotation.SuppressLint
import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.webkit.PermissionRequest
import android.webkit.GeolocationPermissions
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.TextView
import androidx.webkit.ServiceWorkerClientCompat
import androidx.webkit.ServiceWorkerControllerCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

internal class MainActivity : android.app.Activity() {
    private lateinit var webView: WebView
    private lateinit var nativeBridge: NativeWearableBridge
    private var pendingCameraPermission: PermissionRequest? = null
    private var pendingLocationPermission: Pair<String, GeolocationPermissions.Callback>? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        webView = WebView(this)
        setContentView(webView)
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            showMessage("이 기기의 Android System WebView를 업데이트해야 웨어러블 릴레이를 사용할 수 있습니다.")
            return
        }

        nativeBridge = NativeWearableBridge(this)
        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        if (WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_BASIC_USAGE) &&
            WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_SHOULD_INTERCEPT_REQUEST)) {
            ServiceWorkerControllerCompat.getInstance().setServiceWorkerClient(object : ServiceWorkerClientCompat() {
                override fun shouldInterceptRequest(request: WebResourceRequest): WebResourceResponse? =
                    if (isTrustedAppUrl(request.url)) isolatedAsset(assetLoader.shouldInterceptRequest(request.url)) else null
            })
        }

        // JavaScript is required by the packaged PWA; this WebView only loads its trusted app-assets origin.
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            setGeolocationEnabled(true)
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
        }
        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest): WebResourceResponse? =
                if (isTrustedAppUrl(request.url)) isolatedAsset(assetLoader.shouldInterceptRequest(request.url)) else null

            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest): Boolean = !isTrustedAppUrl(request.url)

            override fun onReceivedSslError(view: WebView?, handler: android.webkit.SslErrorHandler?, error: android.net.http.SslError?) {
                handler?.cancel()
            }
        }
        webView.webChromeClient = appWebChromeClient()
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(webView, "PELoopNativeHost", setOf(NativeWearableBridge.APP_ORIGIN)) { _, message, sourceOrigin, isMainFrame, replyProxy ->
                nativeBridge.onPostMessage(message.data, sourceOrigin, isMainFrame, replyProxy)
            }
        }
        webView.loadUrl("${NativeWearableBridge.APP_ORIGIN}/assets/index.html")
    }

    override fun onDestroy() {
        val locationRequest = pendingLocationPermission
        pendingLocationPermission = null
        locationRequest?.let { (origin, callback) -> callback.invoke(origin, false, false) }
        pendingCameraPermission?.deny()
        pendingCameraPermission = null
        if (::nativeBridge.isInitialized) nativeBridge.close()
        if (::webView.isInitialized) {
            webView.stopLoading()
            webView.destroy()
        }
        super.onDestroy()
    }

    @Deprecated("Use runtime permission callbacks")
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == LOCATION_PERMISSION_REQUEST) {
            val pending = pendingLocationPermission ?: return
            pendingLocationPermission = null
            val allowed = !isFinishing && !isDestroyed && grantResults.any { it == PackageManager.PERMISSION_GRANTED }
            pending.second.invoke(pending.first, allowed, false)
            return
        }
        if (requestCode != CAMERA_PERMISSION_REQUEST) return
        val request = pendingCameraPermission ?: return
        pendingCameraPermission = null
        if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) else request.deny()
    }

    private fun appWebChromeClient() = object : WebChromeClient() {
        override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
            if (!isTrustedAppUrl(Uri.parse(origin)) || pendingLocationPermission != null || isFinishing || isDestroyed) {
                callback.invoke(origin, false, false)
                return
            }
            if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
                checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                callback.invoke(origin, true, false)
            } else {
                pendingLocationPermission = origin to callback
                requestPermissions(arrayOf(Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION), LOCATION_PERMISSION_REQUEST)
            }
        }

        override fun onGeolocationPermissionsHidePrompt() {
            val locationRequest = pendingLocationPermission
            pendingLocationPermission = null
            locationRequest?.let { (origin, callback) -> callback.invoke(origin, false, false) }
        }

        override fun onPermissionRequest(request: PermissionRequest) {
            val cameraOnly = request.resources.size == 1 && request.resources[0] == PermissionRequest.RESOURCE_VIDEO_CAPTURE
            if (!isTrustedAppUrl(request.origin) || !cameraOnly || pendingCameraPermission != null) {
                request.deny()
                return
            }
            if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
            } else {
                pendingCameraPermission = request
                requestPermissions(arrayOf(Manifest.permission.CAMERA), CAMERA_PERMISSION_REQUEST)
            }
        }
    }

    // Only wrap responses produced by the app asset loader. External requests retain
    // their own response headers and the existing CORS and permission checks.
    private fun isolatedAsset(response: WebResourceResponse?): WebResourceResponse? {
        if (response != null) response.responseHeaders = isolationHeaders(response.responseHeaders)
        return response
    }

    private fun isTrustedAppUrl(uri: Uri): Boolean =
        uri.scheme == "https" && uri.host == "appassets.androidplatform.net" && uri.port == -1 && uri.userInfo == null

    private fun showMessage(message: String) {
        setContentView(TextView(this).apply {
            text = message
            textSize = 18f
            setPadding(32, 48, 32, 48)
        })
    }

    companion object {
        private const val CAMERA_PERMISSION_REQUEST = 7102
        private const val LOCATION_PERMISSION_REQUEST = 7103
    }
}
