plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    sourceSets.getByName("main").java.srcDir("../shared/src/main/java")
    namespace = "com.peloop.studentcompanion"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.peloop.studentcompanion"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
    implementation("com.google.android.gms:play-services-wearable:19.0.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    runtimeOnly("org.slf4j:slf4j-nop:2.0.13")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
