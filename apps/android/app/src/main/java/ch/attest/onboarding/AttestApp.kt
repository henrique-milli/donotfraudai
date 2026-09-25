package ch.attest.onboarding

import android.app.Application
import ch.attest.onboarding.core.Mode
import ch.digitaltrust.engine.FaceEngine
import ch.digitaltrust.engine.ScannerRuntime

class AttestApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Mode.load(this)
        // Start the scanning engine (asynchronous; HomeActivity waits for STATUS.DONE).
        ScannerRuntime.init(this)
        FaceEngine.init(this)
    }
}
