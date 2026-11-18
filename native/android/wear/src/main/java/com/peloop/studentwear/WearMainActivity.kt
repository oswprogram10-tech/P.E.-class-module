package com.peloop.studentwear

import com.peloop.wearable.GalaxyWatchCatalog
import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.activity.ComponentActivity

class WearMainActivity : ComponentActivity() {
    private lateinit var status: TextView
    private val model = Build.MODEL.trim().uppercase()

    private val permissionRequest = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        if (result.values.all { it } && sensorPermissionGranted()) showStatus("준비되었습니다. 학생 휴대폰 앱에서 수업 연결을 시작하면 측정합니다.")
        else showStatus("심박 센서와 알림 권한이 필요합니다. 권한을 허용하지 않으면 측정값은 전송되지 않습니다.")
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(22, 18, 22, 18)
        }
        root.addView(TextView(this).apply {
            text = getString(R.string.watch_app_title)
            textSize = 21f
            gravity = Gravity.CENTER
        })
        status = TextView(this).apply {
            textSize = 15f
            gravity = Gravity.CENTER
            text = getString(R.string.watch_model, model)
        }
        root.addView(status)
        root.addView(Button(this).apply {
            text = "권한 확인"
            setOnClickListener { requestPermissionsIfNeeded() }
        })
        root.addView(TextView(this).apply {
            text = "수업 연결이 끊기면 측정값을 보내지 않습니다. 기록을 저장하거나 나중에 다시 보내지 않습니다."
            textSize = 13f
            gravity = Gravity.CENTER
        })
        setContentView(ScrollView(this).apply {
            isFillViewport = true
            addView(root)
        })
        if (GalaxyWatchCatalog.lookup(model) == null) showStatus("워치 모델이 후보 목록에 없습니다.")
        else if (!GalaxyWatchCatalog.watchAllowed(GalaxyWatchCatalog.lookup(model)!!, Build.VERSION.SDK_INT)) showStatus("워치 OS 버전이 필요한 조건보다 낮습니다.")
    }

    private fun requestPermissionsIfNeeded() {
        val profile = GalaxyWatchCatalog.lookup(model)
        if (profile == null) {
            showStatus("이 워치 모델은 후보 목록에서 확인되지 않았습니다.")
            return
        }
        if (!GalaxyWatchCatalog.watchAllowed(profile, Build.VERSION.SDK_INT)) {
            showStatus("워치 OS 버전이 필요한 조건보다 낮습니다.")
            return
        }
        val requested = mutableListOf(sensorPermission())
        if (Build.VERSION.SDK_INT >= 33) requested += Manifest.permission.POST_NOTIFICATIONS
        val missing = requested.filter { ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isEmpty()) showStatus("준비되었습니다. 학생 휴대폰 앱에서 수업 연결을 시작하면 측정합니다.")
        else permissionRequest.launch(missing.toTypedArray())
    }

    private fun sensorPermission(): String = if (applicationInfo.targetSdkVersion >= 36) "android.permission.health.READ_HEART_RATE" else Manifest.permission.BODY_SENSORS
    private fun sensorPermissionGranted(): Boolean = ContextCompat.checkSelfPermission(this, sensorPermission()) == PackageManager.PERMISSION_GRANTED
    private fun showStatus(value: String) { if (::status.isInitialized) status.text = value }
}
