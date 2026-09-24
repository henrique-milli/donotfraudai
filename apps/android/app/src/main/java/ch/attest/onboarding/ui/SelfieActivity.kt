package ch.attest.onboarding.ui

import android.content.Context
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Bitmap
import android.graphics.Color
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import android.util.Size
import android.view.View
import android.widget.LinearLayout
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import ch.attest.onboarding.R
import ch.attest.onboarding.core.Check
import ch.attest.onboarding.core.FaceCapture
import ch.attest.onboarding.core.Group
import ch.attest.onboarding.core.Mode
import ch.attest.onboarding.core.Outcome
import ch.attest.onboarding.core.Payload
import ch.attest.onboarding.core.Session
import ch.attest.onboarding.databinding.ActivitySelfieBinding
import ch.attest.onboarding.databinding.ChipSignalBinding
import ch.attest.onboarding.ui.widget.FaceOvalView
import ch.digitaltrust.engine.FaceEngine
import ch.digitaltrust.engine.FaceEngine.Gesture
import ch.digitaltrust.engine.FaceEngine.Observation
import ch.digitaltrust.engine.FaceEngine.Position
import ch.digitaltrust.engine.Frames
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlin.math.max
import kotlin.math.min

/**
 * Selfie capture on the front camera, analysed on device by the face engine.
 *
 *  PASSIVE (default): the applicant just looks at the phone. Once the capture gate passes on
 *  consecutive frames, a selfie plus a short burst of frames is taken; the backend decides liveness
 *  (anti-spoofing on every frame) and matches the face 1:1 and 1:N.
 *
 *  ACTIVE (only when the backend asks, i.e. re-verification): a neutral selfie, then the random
 *  gesture sequence the backend issued, one frame per gesture. The phone checks each gesture to
 *  guide the user; the backend re-checks every frame itself.
 */
class SelfieActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "AttestSelfie"
        const val EXTRA_MODE = "mode"
        const val EXTRA_PARENT = "parent"
        const val EXTRA_TOKEN = "token"
        const val EXTRA_RV = "rv"
        const val EXTRA_STEPS = "steps"
        private const val READY_STREAK = 3
        private const val GESTURE_STREAK = 2
        private const val BURST = 4
        private const val HINT_HOLD_MS = 900L

        fun active(ctx: Context, p: Payload.Pending) = Intent(ctx, SelfieActivity::class.java)
            .putExtra(EXTRA_MODE, "ACTIVE").putExtra(EXTRA_PARENT, p.parentSession).putExtra(EXTRA_TOKEN, p.token)
            .putExtra(EXTRA_RV, p.number).putExtra(EXTRA_STEPS, p.steps.toTypedArray())
    }

    private enum class Phase { NEUTRAL, BURST, GESTURE, RETURN, DONE }

    private lateinit var b: ActivitySelfieBinding
    private val stage get() = Mode.stage
    private val onMode: (Boolean) -> Unit = { runOnUiThread { applyMode() } }
    private val worker: ExecutorService = Executors.newSingleThreadExecutor()
    private var active = false
    private var steps: List<Gesture> = emptyList()

    // capture state (worker thread)
    @Volatile private var phase = Phase.NEUTRAL
    private var streak = 0
    private var stepIndex = 0
    private var stepStartedAt = 0L
    private var selfie: Bitmap? = null
    private val frames = ArrayList<Bitmap>()
    private val stepTimes = ArrayList<Long>()
    private val observations = ArrayList<Observation>()
    private var startedAt = 0L
    private var lastHintAt = 0L
    private var lastHint = 0

    private val chips by lazy { listOf("Face", "Centered", "Distance", "Clear", "Eyes", "Light", "Pose") }
    private val chipViews = ArrayList<ChipSignalBinding>()

    override fun onCreate(savedInstanceState: Bundle?) {
        setTheme(R.style.Theme_Attest_Night)
        super.onCreate(savedInstanceState)
        b = ActivitySelfieBinding.inflate(layoutInflater)
        setContentView(b.root)
        active = intent.getStringExtra(EXTRA_MODE) == "ACTIVE"
        steps = intent.getStringArrayExtra(EXTRA_STEPS)?.mapNotNull { runCatching { Gesture.valueOf(it) }.getOrNull() }.orEmpty()

        b.stepBar.steps = if (active) 1 else 4
        b.stepBar.current = if (active) 0 else 3
        b.title.text = getString(if (active) R.string.selfie_active_title else R.string.selfie_title)
        b.hint.text = getString(if (active) R.string.selfie_active_intro else R.string.selfie_hint_loading)
        b.btnBack.setOnClickListener { finish() }
        b.btnBack.marginForSystemBars(top = true)
        b.hud.marginForSystemBars(bottom = true)
        b.hudTitle.text = if (active) "Face capture · active · ${steps.joinToString { it.name.lowercase() }}" else "Face capture · passive"
        b.btnMode.visibility = if (Mode.available) View.VISIBLE else View.GONE
        b.btnMode.setOnClickListener { Mode.toggle(this) }
        Mode.observe(onMode)
        applyMode()
        startedAt = SystemClock.elapsedRealtime()
        startCamera()
    }

    private fun applyMode() {
        b.btnMode.setImageResource(if (stage) R.drawable.ic_eye else R.drawable.ic_eye_off)
        b.hud.visibility = if (stage) View.VISIBLE else View.GONE
        if (stage && chipViews.isEmpty()) buildChips()
    }

    /** production: the oval never changes colour, so nothing tells an attacker which check is passing */
    private fun ovalState(s: FaceOvalView.State) {
        b.oval.state = if (stage || s == FaceOvalView.State.DONE) s else FaceOvalView.State.SEARCHING
    }

    override fun onDestroy() {
        Mode.forget(onMode)
        worker.shutdown()
        super.onDestroy()
    }

    private fun startCamera() {
        val future = ProcessCameraProvider.getInstance(this)
        future.addListener({
            val provider = future.get()
            val preview = Preview.Builder().build().also { it.setSurfaceProvider(b.preview.surfaceProvider) }
            val analysis = ImageAnalysis.Builder()
                .setResolutionSelector(
                    ResolutionSelector.Builder()
                        .setAspectRatioStrategy(AspectRatioStrategy.RATIO_16_9_FALLBACK_AUTO_STRATEGY)
                        .setResolutionStrategy(ResolutionStrategy(Size(1280, 720), ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER))
                        .build(),
                )
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .build()
                .also { it.setAnalyzer(worker, ::analyze) }
            provider.unbindAll()
            provider.bindToLifecycle(this, CameraSelector.DEFAULT_FRONT_CAMERA, preview, analysis)
        }, ContextCompat.getMainExecutor(this))
    }

    // ------------------------------------------------------------------ per frame (worker thread)

    private fun analyze(image: ImageProxy) {
        if (phase == Phase.DONE) { image.close(); return }
        val mat = image.use { Frames.toMat(it) } ?: return
        try {
            val o = FaceEngine.analyze(mat)
            if (o.ready && o.faces == 1) observations += o
            when (phase) {
                Phase.NEUTRAL -> neutral(o) { selfie = Frames.toBitmap(mat) }
                Phase.BURST -> if (o.faces == 1) {
                    frames += Frames.toBitmap(mat)
                    ui { b.oval.progress = frames.size / BURST.toFloat() }
                    if (frames.size >= BURST) finishCapture()
                }
                Phase.GESTURE -> gesture(o) { frames += Frames.toBitmap(mat) }
                Phase.RETURN -> if (o.faces == 1 && o.lookLeftRight <= 0.5 && o.tilt <= 0.3 && o.position != Position.TOO_CLOSE && o.position != Position.TOO_FAR) {
                    phase = Phase.GESTURE; stepStartedAt = SystemClock.elapsedRealtime(); streak = 0
                    ui { showGesture() }
                } else ui { b.hint.text = getString(R.string.gesture_back_neutral) }
                Phase.DONE -> Unit
            }
            if (stage) ui { renderHud(o) }
        } catch (e: Exception) {
            Log.e(TAG, "face analysis failed", e)
        } finally {
            mat.release()
        }
    }

    private fun neutral(o: Observation, grab: () -> Unit) {
        if (!o.captureReady) {
            streak = 0
            hint(o)
            ui { ovalState(if (o.faces == 0) FaceOvalView.State.SEARCHING else FaceOvalView.State.GUIDING) }
            return
        }
        streak++
        ui { ovalState(FaceOvalView.State.READY); b.hint.text = getString(R.string.selfie_hint_hold) }
        if (streak < READY_STREAK) return
        grab()
        streak = 0
        if (active && steps.isNotEmpty()) {
            phase = Phase.GESTURE; stepIndex = 0; stepStartedAt = SystemClock.elapsedRealtime()
            ui { showGesture() }
        } else {
            phase = Phase.BURST
            ui { ovalState(FaceOvalView.State.CAPTURING) }
        }
    }

    private fun gesture(o: Observation, grab: () -> Unit) {
        val g = steps[stepIndex]
        if (FaceEngine.performed(g, o)) streak++ else streak = 0
        if (streak < GESTURE_STREAK) return
        grab()
        stepTimes += SystemClock.elapsedRealtime() - stepStartedAt
        streak = 0
        stepIndex++
        ui { b.oval.progress = stepIndex / steps.size.toFloat() }
        if (stepIndex >= steps.size) finishCapture() else phase = Phase.RETURN
    }

    private fun showGesture() {
        val g = steps[stepIndex]
        b.gesture.visibility = View.VISIBLE
        b.gesture.text = getString(resources.getIdentifier("gesture_${g.name}", "string", packageName))
        b.hint.text = "Step ${stepIndex + 1} of ${steps.size}"
        ovalState(FaceOvalView.State.GUIDING)
    }

    private fun hint(o: Observation) {
        val id = when {
            !o.ready -> R.string.selfie_hint_loading
            o.faces == 0 -> R.string.selfie_hint_place
            o.faces > 1 -> R.string.selfie_hint_one
            o.position == Position.TOO_FAR -> R.string.selfie_hint_closer
            o.position == Position.TOO_CLOSE -> R.string.selfie_hint_further
            o.position == Position.NOT_CENTERED -> R.string.selfie_hint_center
            !o.clear -> R.string.selfie_hint_blur
            o.backgroundDarkness < 50 || o.faceDarkness < 35 -> R.string.selfie_hint_dark
            o.spotlight >= 7 -> R.string.selfie_hint_light
            !o.eyesOpen -> R.string.selfie_hint_eyes
            else -> R.string.selfie_hint_straight
        }
        val now = SystemClock.elapsedRealtime()
        if (id != lastHint && now - lastHintAt > HINT_HOLD_MS) {
            lastHint = id; lastHintAt = now
            ui { b.hint.text = getString(id) }
        }
    }

    // ------------------------------------------------------------------ done

    private fun finishCapture() {
        phase = Phase.DONE
        val shot = selfie ?: return
        val capture = FaceCapture(
            mode = if (active) "ACTIVE" else "PASSIVE", selfie = shot, frames = frames.toList(),
            gestures = if (active) steps.map { it.name } else emptyList(), checks = deviceChecks(),
        )
        ui {
            ovalState(FaceOvalView.State.DONE)
            b.oval.progress = 1f
            b.gesture.visibility = View.GONE
            b.hint.text = getString(if (active) R.string.finishing else R.string.selfie_hint_done)
        }
        if (!active) {
            Session.face = capture
            ui {
                b.root.postDelayed({
                    startActivity(Intent(this, ResultActivity::class.java))
                    overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out)
                    finish()
                }, 350)
            }
            return
        }
        // active: sealed with its own attested key and sent straight away
        val pending = Payload.Pending(
            intent.getStringExtra(EXTRA_PARENT).orEmpty(), intent.getStringExtra(EXTRA_TOKEN).orEmpty(),
            intent.getIntExtra(EXTRA_RV, 0), steps.map { it.name },
        )
        val app = applicationContext
        Thread {
            val sealed = Payload.sealReverification(app, pending, capture)
            ui {
                startActivity(Intent(this, ResultActivity::class.java)
                    .putExtra(ResultActivity.EXTRA_REVERIFIED, true)
                    .putExtra(ResultActivity.EXTRA_ROUTE, sealed?.route)
                    .putExtra(ResultActivity.EXTRA_DELIVERY, sealed?.delivery ?: "could not seal"))
                finish()
            }
        }.start()
    }

    /** What the phone saw. Informational for the backend, which decides liveness and match itself. */
    private fun deviceChecks(): List<Check> {
        val g = Group.FACE
        val out = ArrayList<Check>()
        val obs = observations.toList()
        val last = obs.lastOrNull()
        out += Check(g, null, "Face capture gate", if (last?.clear == true) Outcome.PASS else Outcome.INFO,
            last?.let { "quality ${it.quality?.lowercase()} · face %.0f%% of frame · %d frames analysed".format(it.areaPct, obs.size) } ?: "no face",
            "one face, centred, sharp, eyes open, lit (face module gate)")
        if (!active) {
            val blink = obs.any { it.leftEyeOpen == false || it.rightEyeOpen == false }
            out += Check(g, null, "Natural blink", Outcome.INFO, if (blink) "seen during capture" else "not seen",
                "weak liveness cue, recorded")
            val look = obs.map { it.lookLeftRight }
            out += Check(g, null, "Head micro-movement", Outcome.INFO,
                if (look.size > 1) "look range %.2f · tilt range %.2f".format(look.max() - look.min(), obs.maxOf { it.tilt } - obs.minOf { it.tilt }) else "—",
                "a printed photo or a still screen does not move; recorded")
            out += Check(g, null, "Capture time", Outcome.INFO,
                "%.1f s · selfie + %d frames".format((SystemClock.elapsedRealtime() - startedAt) / 1000.0, frames.size), "recorded")
        } else {
            out += Check(g, null, "Gestures on device", Outcome.PASS,
                steps.zip(stepTimes).joinToString(" · ") { (s, t) -> "${s.name.lowercase().replace('_', ' ')} ✓ %.1f s".format(t / 1000.0) },
                "random sequence issued by the backend; re-checked server-side")
        }
        return out
    }

    // ------------------------------------------------------------------ presenter HUD

    private fun buildChips() {
        b.hudChips.removeAllViews(); chipViews.clear()
        chips.chunked(4).forEachIndexed { r, row ->
            val line = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; if (r > 0) setPadding(0, dp(6), 0, 0) }
            row.forEach { name ->
                val c = ChipSignalBinding.inflate(layoutInflater, line, false)
                c.text.text = name
                line.addView(c.root); chipViews += c
            }
            repeat(4 - row.size) { line.addView(View(this), LinearLayout.LayoutParams(0, 1, 1f).apply { marginEnd = dp(6) }) }
            b.hudChips.addView(line)
        }
    }

    private fun renderHud(o: Observation) {
        val pass = Color.parseColor("#2BD48A"); val fail = Color.parseColor("#FFC24B"); val idle = Color.parseColor("#4DFFFFFF")
        val states = listOf(
            o.faces == 1,
            o.faces == 1 && o.position != Position.NOT_CENTERED,
            o.faces == 1 && (o.position == Position.OK || o.position == Position.NOT_CENTERED),
            o.clear,
            o.eyesOpen,
            o.faces == 1 && o.backgroundDarkness >= 50 && o.faceDarkness >= 35 && o.spotlight < 7,
            o.faces == 1 && o.lookLeftRight <= 0.5 && o.tilt <= 0.3,
        )
        chipViews.forEachIndexed { i, v ->
            val col = if (!o.ready || o.faces == 0) idle else if (states[i]) pass else fail
            v.dot.backgroundTintList = ColorStateList.valueOf(col)
            v.text.alpha = if (col == idle) 0.5f else 1f
        }
        b.hudMeta.text = "${observations.size} frames"
        b.hudReadout.text = if (o.faces != 1) "faces ${o.faces}" else
            "q ${o.quality?.lowercase()} · area %.0f%% · look %.2f · tilt %.2f · L%s R%s".format(
                o.areaPct, o.lookLeftRight, o.tilt, if (o.turnedLeft) "✓" else "·", if (o.turnedRight) "✓" else "·") +
                if (phase == Phase.GESTURE && stepIndex < steps.size) " · waiting for ${steps[stepIndex].name.lowercase()}" else ""
    }

    private fun ui(block: () -> Unit) = runOnUiThread { if (!isFinishing) block() }
    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
}
