# PE Loop Wearable Relay (Android)

This is the teacher-tablet host app source for the selected student-phone → local Wi-Fi → teacher-tablet path. It packages the current PWA as Android app assets, loads it through AndroidX `WebViewAssetLoader`, and injects a narrowly scoped Web Message bridge for one-session pairing and live heart-rate frames. It also includes the first TLS WebSocket relay implementation.

The LAN relay uses TLS WebSocket with a one-use bearer ticket and the SHA-256 public-key fingerprint carried in the pairing QR. It accepts one student-phone session and heart-rate frames only. No heart-rate sample is written to disk, a database, analytics, or logs. The server does not queue samples for replay. A debug APK has been built, its JVM unit test passed, and APK signature verification succeeded; installation and execution on an Android tablet are still pending. The student phone/watch clients are not included.

Build with Android Studio or Gradle 8.10.2 and JDK 17 or newer. The module targets Android API 35 and requires Android 8.0/API 26 or later. `:app:testDebugUnitTest`, `:app:assembleDebug`, and `:app:lintDebug` passed with Android SDK Platform 35 and Build Tools 35.0.0; lint reported zero errors and warnings. The debug APK is at `app/build/outputs/apk/debug/app-debug.apk`. Installation, tablet validation, and review of Android OS integration details are still pending. The iOS/watchOS and student-phone apps are separate follow-on modules.

The PWA files are copied from the repository root during `preBuild`; the list in `app/build.gradle.kts` must stay aligned with `sw.js`'s app shell. Runtime behavior requires the trusted tablet WebView; a regular PWA browser cannot open the receiver.
