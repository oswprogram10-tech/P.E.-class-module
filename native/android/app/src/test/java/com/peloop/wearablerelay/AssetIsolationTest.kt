package com.peloop.wearablerelay

import org.junit.Assert.assertEquals
import org.junit.Test

class AssetIsolationTest {
    @Test fun retainsHeadersAndAppliesIsolationPolicy() {
        val headers = isolationHeaders(mapOf("Cache-Control" to "no-cache"))
        assertEquals("no-cache", headers["Cache-Control"])
        assertEquals("same-origin", headers["Cross-Origin-Opener-Policy"])
        assertEquals("require-corp", headers["Cross-Origin-Embedder-Policy"])
        assertEquals("same-origin", headers["Cross-Origin-Resource-Policy"])
    }
}
