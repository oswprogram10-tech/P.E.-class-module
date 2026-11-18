plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    sourceSets.getByName("main").java.srcDir("../shared/src/main/java")
    namespace = "com.peloop.studentwear"
    compileSdk = 35

    defaultConfig {
    applicationId = "com.peloop.studentcompanion"
        minSdk = 30
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
    implementation("androidx.activity:activity-ktx:1.10.0")
    implementation("androidx.fragment:fragment-ktx:1.8.5")
    implementation("androidx.health:health-services-client:1.1.0")
    implementation("com.google.guava:guava:33.3.1-android")
    implementation("com.google.android.gms:play-services-wearable:19.0.0")
    implementation("androidx.core:core-ktx:1.15.0")
    runtimeOnly("org.slf4j:slf4j-nop:2.0.13")
    testImplementation("junit:junit:4.13.2")
}
