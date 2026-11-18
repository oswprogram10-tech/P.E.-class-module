package com.peloop.wearablerelay

internal fun isolationHeaders(existing: Map<String, String>?): Map<String, String> =
    (existing ?: emptyMap()) + mapOf(
        "Cross-Origin-Opener-Policy" to "same-origin",
        "Cross-Origin-Embedder-Policy" to "require-corp",
        "Cross-Origin-Resource-Policy" to "same-origin"
    )
