package ch.attest.onboarding.core

import android.util.Log
import ch.attest.onboarding.BuildConfig
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.SecureRandom

/**
 * The random face actions for this selfie. Issued by the backend at selfie time (POST /face-challenges),
 * so the sequence is unknown until the camera is already open and cannot have been recorded in advance.
 * The id goes into the signed payload; the backend consumes it once and re-measures every action.
 * Offline, the phone draws the sequence itself and the backend records that it was not server-issued.
 */
class FaceChallenge(val id: String?, val steps: List<String>) {

    companion object {
        private const val TAG = "AttestFace"
        private val POOL = listOf("TURN_LEFT", "TURN_RIGHT", "TILT_LEFT", "TILT_RIGHT", "MOVE_CLOSER", "MOVE_FURTHER")
        private val TURNS = listOf("TURN_LEFT", "TURN_RIGHT")
        private const val STEPS = 3

        /** Blocking; call off the main thread. */
        fun fetch(): FaceChallenge {
            if (BuildConfig.BACKEND_BASE.isNotBlank()) {
                runCatching {
                    val c = URL("${BuildConfig.BACKEND_BASE}/face-challenges").openConnection() as HttpURLConnection
                    c.requestMethod = "POST"; c.connectTimeout = 3000; c.readTimeout = 3000
                    val o = JSONObject(c.inputStream.bufferedReader().readText().also { c.disconnect() })
                    val steps = o.getJSONArray("steps").let { a -> List(a.length()) { a.getString(it) } }.filter { it in POOL }
                    if (steps.isNotEmpty()) return FaceChallenge(o.getString("id"), steps)
                }.onFailure { Log.w(TAG, "face challenge fetch failed: ${it.javaClass.simpleName}") }
            }
            return local()
        }

        /** Same rules as the server: distinct actions, one head turn always included, random order. */
        fun local(): FaceChallenge {
            val rnd = SecureRandom()
            val out = mutableListOf(TURNS[rnd.nextInt(TURNS.size)])
            val rest = POOL.filter { it !in out }.toMutableList()
            while (out.size < STEPS) out += rest.removeAt(rnd.nextInt(rest.size))
            out.shuffle(rnd)
            return FaceChallenge(null, out)
        }
    }
}
