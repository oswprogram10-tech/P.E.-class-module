package com.peloop.studentcompanion

import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService

internal object StudentSessionRegistry {
    @Volatile var active: StudentSessionService? = null
}

class StudentDataLayerService : WearableListenerService() {
    override fun onMessageReceived(event: MessageEvent) {
        if (event.path != WearableWireMessage.path()) return
        StudentSessionRegistry.active?.receiveWatchMessage(event.data)
    }
}
