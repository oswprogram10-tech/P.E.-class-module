plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.peloop.wearablerelay"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.peloop.wearablerelay"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

val pwaFiles = listOf(
    "index.html", "styles.css", "app.js", "pose-assets.js", "model-profiles.js", "volleyball-cue.js",
    "pose-runtime.js", "pose-presence.js", "basketball-shot.js", "shot-feedback.js", "shot-history.js",
    "shot-history-ui.js", "pose-ui.js", "pose-worker.js", "classroom-model.js", "paps-criteria-data.js",
    "paps-criteria.js", "paps-reports.js", "pe-curriculum.js", "teacher-evaluations.js", "exercise-routines.js", "qr-missions.js",
    "tactics-board.js", "wearable-bridge.js", "classroom-tools-ui.js", "classroom-repository.js",
    "classroom-sync.js", "classroom-ui.js", "qrcode-generator.js", "local-vault.js", "clip-repository.js",
    "webm-muxer.js", "clip-exporter.js", "timeline.js", "frame-buffer.js", "manifest.webmanifest", "sw.js",
    "icon.svg", "icon-192.png", "icon-512.png", "qrcode-generator.LICENSE",
    "device-check.js", "device-check-ui.js", "paps-bmi-criteria-data.js", "paps-bmi-criteria.js", "paps-program-selection.js",
    "gps-missions.js", "tactics-sharing.js", "tactics-search-local.js", "tactics-team-request.js", "tactics-local-prompt.js", "tactics-local-advisor.js", "tactics-student-ui.js", "tactics-tools-ui.js"
)

val pwaRoot = rootProject.file("../..")
val generatedPwaAssets = layout.buildDirectory.dir("generated/pwaAssets")
val copyPwaAssets = tasks.register<Sync>("copyPwaAssets") {
    from(pwaRoot) {
        pwaFiles.forEach { include(it) }
        include("vendor/**")
    }
    into(generatedPwaAssets)
}

android.sourceSets.getByName("main").assets.srcDir(generatedPwaAssets)
tasks.named("preBuild").configure { dependsOn(copyPwaAssets) }

dependencies {
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("org.java-websocket:Java-WebSocket:1.5.7")
    runtimeOnly("org.slf4j:slf4j-nop:2.0.13")
}
