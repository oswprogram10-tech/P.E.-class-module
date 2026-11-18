package com.peloop.studentcompanion

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.CheckBox
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions

class StudentActivity : AppCompatActivity() {
    private lateinit var status: TextView
    private lateinit var studentConsent: CheckBox
    private lateinit var guardianConsent: CheckBox
    private lateinit var scanButton: Button
    private var permissionAction: (() -> Unit)? = null

    private val scanResult = registerForActivityResult(ScanContract()) { result ->
        val payload = result.contents ?: return@registerForActivityResult
        if (!studentConsent.isChecked || !guardianConsent.isChecked) {
            showStatus("학생 본인과 보호자의 동의가 확인된 뒤에 연결할 수 있습니다.")
            return@registerForActivityResult
        }
        try {
            PairingInvite.parse(payload)
            StudentSessionService.start(this, payload)
            showStatus("수업 연결을 시작했습니다. 알림에서 연결 상태를 확인할 수 있습니다.")
        } catch (error: IllegalArgumentException) {
            showStatus(error.message ?: "교사 연결 QR을 확인해 주세요.")
        }
    }

    private val permissionRequest = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        val action = permissionAction
        permissionAction = null
        if (result.values.all { it }) action?.invoke()
        else showStatus("알림과 로컬 네트워크 권한이 있어야 수업 중 연결을 유지할 수 있습니다.")
    }

    private val statusReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            intent?.getStringExtra(StudentSessionService.EXTRA_STATUS)?.let(::showStatus)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        title = "PELoop 학생 워치 연결"

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(24), dp(20), dp(24), dp(20))
        }
        root.addView(TextView(this).apply {
            text = getString(R.string.student_title)
            textSize = 23f
            setPadding(0, 0, 0, dp(10))
        }, matchWidth())
        root.addView(TextView(this).apply {
            text = getString(R.string.student_intro)
            textSize = 16f
            setPadding(0, 0, 0, dp(16))
        }, matchWidth())
        studentConsent = CheckBox(this).apply { text = "학생 본인이 이번 수업의 심박 측정에 동의합니다." }
        guardianConsent = CheckBox(this).apply { text = "보호자 동의가 학교에 제출되어 확인되었습니다." }
        root.addView(studentConsent, matchWidth())
        root.addView(guardianConsent, matchWidth())
        status = TextView(this).apply {
            text = StudentSessionService.statusText
            textSize = 16f
            setPadding(0, dp(20), 0, dp(16))
        }
        root.addView(status, matchWidth())
        scanButton = Button(this).apply {
            text = getString(R.string.scan_teacher_qr)
            isEnabled = false
            setOnClickListener { requestRuntimePermissions { launchScanner() } }
        }
        root.addView(scanButton, matchWidth())
        root.addView(Button(this).apply {
            text = getString(R.string.end_class_connection)
            setOnClickListener {
                StudentSessionService.stop(this@StudentActivity)
                showStatus("수업 연결을 종료했습니다.")
            }
        }, matchWidth())
        val consentListener = android.widget.CompoundButton.OnCheckedChangeListener { _, _ ->
            scanButton.isEnabled = studentConsent.isChecked && guardianConsent.isChecked
        }
        studentConsent.setOnCheckedChangeListener(consentListener)
        guardianConsent.setOnCheckedChangeListener(consentListener)
        setContentView(root)
    }

    override fun onStart() {
        super.onStart()
        val filter = IntentFilter(StudentSessionService.ACTION_STATUS)
        ContextCompat.registerReceiver(this, statusReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
        showStatus(StudentSessionService.statusText)
    }

    override fun onStop() {
        try { unregisterReceiver(statusReceiver) } catch (_: Exception) { }
        super.onStop()
    }

    private fun requestRuntimePermissions(action: () -> Unit) {
        val needed = buildList {
            if (Build.VERSION.SDK_INT >= 33) {
                add(Manifest.permission.POST_NOTIFICATIONS)
                add(Manifest.permission.NEARBY_WIFI_DEVICES)
            }
        }.filter { ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }
        if (needed.isEmpty()) action()
        else {
            permissionAction = action
            permissionRequest.launch(needed.toTypedArray())
        }
    }

    private fun launchScanner() {
        scanResult.launch(ScanOptions().apply {
            setDesiredBarcodeFormats(ScanOptions.QR_CODE)
            setPrompt("교사 태블릿의 PELoop 연결 QR을 스캔하세요")
            setBeepEnabled(false)
            setBarcodeImageEnabled(false)
            setOrientationLocked(true)
        })
    }

    private fun showStatus(value: String) { if (::status.isInitialized) status.text = value }
    private fun matchWidth(): LinearLayout.LayoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
