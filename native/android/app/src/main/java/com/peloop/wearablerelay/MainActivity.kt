package com.peloop.wearablerelay

import android.annotation.SuppressLint
import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.webkit.PermissionRequest
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
                    if (isTrustedAppUrl(request.url)) assetLoader.shouldInterceptRequest(request.url) else null
            })
        }

        // JavaScript is required by the packaged PWA; this WebView only loads its trusted app-assets origin.
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
        }
        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest): WebResourceResponse? =
                assetLoader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest): Boolean = !isTrustedAppUrl(request.url)

            override fun onReceivedSslError(view: WebView?, handler: android.webkit.SslErrorHandler?, error: android.net.http.SslError?) {
                handler?.cancel()
            }
        }
        webView.webChromeClient = cameraOnlyWebChromeClient()
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(webView, "PELoopNativeHost", setOf(NativeWearableBridge.APP_ORIGIN)) { _, message, sourceOrigin, isMainFrame, replyProxy ->
                nativeBridge.onPostMessage(message.data, sourceOrigin, isMainFrame, replyProxy)
            }
        }
        webView.loadUrl("${NativeWearableBridge.APP_ORIGIN}/assets/index.html")
    }

    override fun onDestroy() {
        pendingCameraPermission?.deny()
        pendingCameraPermission = null
        if (::nativeBridge.isInitialized) nativeBridge.close()
        if (::webView.isInitialized) {
            webView.stopLoading()
            webView.destroy()
        }
        super.onDestroy()
    }

    @Deprecated("Use the runtime camera permission callback")
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != CAMERA_PERMISSION_REQUEST) return
        val request = pendingCameraPermission ?: return
        pendingCameraPermission = null
        if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) else request.deny()
    }

    private fun cameraOnlyWebChromeClient() = object : WebChromeClient() {
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
    }
}
