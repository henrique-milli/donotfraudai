package ch.attest.onboarding

import android.app.Application
import ch.attest.onboarding.core.Mode
import ch.digitaltrust.engine.FaceEngine
import ch.digitaltrust.engine.ScannerRuntime

class AttestApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Mode.load(this)
        // OpenCV + native scanner libraries, then load every on-device model.
        // Model loading is asynchronous; HomeActivity waits for STATUS.DONE.
        ScannerRuntime.init(this)
        FaceEngine.init(this)
    }
}
