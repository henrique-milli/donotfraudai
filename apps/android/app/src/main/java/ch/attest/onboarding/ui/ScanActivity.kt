package ch.attest.onboarding.ui

import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Color
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import android.util.Size
import android.view.View
import android.widget.LinearLayout
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import ch.attest.onboarding.R
import ch.attest.onboarding.core.Check
import ch.attest.onboarding.core.Group
import ch.attest.onboarding.core.Mode
import ch.attest.onboarding.core.Mrz
import ch.attest.onboarding.core.MrzParser
import ch.attest.onboarding.core.Outcome
import ch.attest.onboarding.core.Session
import ch.attest.onboarding.core.Side
import ch.attest.onboarding.core.SideCapture
import ch.attest.onboarding.core.SwissClassifier
import ch.attest.onboarding.databinding.ActivityScanBinding
import ch.attest.onboarding.databinding.ChipSignalBinding
import ch.attest.onboarding.databinding.RowPadResultBinding
import ch.digitaltrust.engine.DocumentPipeline
import ch.digitaltrust.engine.DocumentPipeline.Hint
import ch.digitaltrust.engine.Frames
import ch.attest.onboarding.scan.ChipSymbol
import ch.attest.onboarding.scan.toCard
import ch.attest.onboarding.scan.toChecks
import ch.attest.onboarding.scan.Ocr
import ch.attest.onboarding.signals.MotionProbe
import ch.attest.onboarding.ui.widget.CardFrameView
import org.opencv.core.Mat
import java.util.Calendar
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Scans one side of the card.
 *
 * Preview frames run the quality gate; once it passes on consecutive frames (and, on the back, a
 * valid MRZ is read), a full-resolution still is taken and the presentation-attack checks and OCR
 * run on it. Applicants only ever see guidance; in presenter mode a HUD shows the gate live and
 * reveals the attack checks after capture.
 */
class ScanActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_SIDE = "side"
        private const val TAG = "AttestScan"
        private const val STREAK = 2
        private const val HINT_HOLD_MS = 1100L
    }

    /** live gate chips, in pipeline order; the check labels they light up on */
    private data class Gate(val chip: String, val check: String)

    private lateinit var b: ActivityScanBinding
    private lateinit var side: Side
    private val stage get() = Mode.stage
    private val onMode: (Boolean) -> Unit = { runOnUiThread { applyMode() } }
    private val pipeline = DocumentPipeline()
    private val worker: ExecutorService = Executors.newSingleThreadExecutor()
    private lateinit var motion: MotionProbe

    private var imageCapture: ImageCapture? = null
    private var camera: Camera? = null
    private var torch = false

    @Volatile private var previewW = 0
    @Volatile private var previewH = 0
    @Volatile private var capturing = false
    /** back side: frames are ignored while the "turn your card over" animation plays */
    @Volatile private var flipping = false
    private var streak = 0
    private var previewChecks: List<Check> = emptyList()
    private var previewMrz: Mrz? = null
    private var lastHint: Hint? = null
    private var lastHintAt = 0L
    private var lastFrameAt = 0L
    /** back side: the Swiss document the scan shows when it differs from the selection */
    @Volatile private var suggested: ch.attest.onboarding.core.SwissDocType? = null
    private var fps = 0.0

    private val gates by lazy {
        listOf(
            Gate("Card", "Card detected"), Gate("Light", "Lighting"), Gate("Distance", "Distance"),
            Gate("Sharp", "Sharpness"), Gate("Fingers", "Fingers on card"), Gate("Glare", "Glare"),
        ) + if (side == Side.FRONT) Gate("Photo", "ID photo quality") else Gate("MRZ", "MRZ")
    }
    private val chipViews = ArrayList<ChipSignalBinding>()

    override fun onCreate(savedInstanceState: Bundle?) {
        setTheme(R.style.Theme_Attest_Night)
        super.onCreate(savedInstanceState)
        b = ActivityScanBinding.inflate(layoutInflater)
        setContentView(b.root)
        side = Side.valueOf(intent.getStringExtra(EXTRA_SIDE) ?: Side.FRONT.name)
        motion = MotionProbe(this)

        b.frame.centerY = 0.40f
        b.stepBar.steps = 4
        b.stepBar.current = if (side == Side.FRONT) 0 else 1
        b.stepLabel.text = "Step ${if (side == Side.FRONT) 1 else 2} of 4"
        b.title.text = getString(if (side == Side.FRONT) R.string.scan_front_title else R.string.scan_back_title)
        b.hint.text = getString(if (side == Side.FRONT) R.string.scan_front_hint else R.string.scan_back_hint)
        b.btnBack.setOnClickListener { finish() }
        b.btnFlash.setOnClickListener {
            torch = !torch
            camera?.cameraControl?.enableTorch(torch)
            b.btnFlash.setImageResource(if (torch) R.drawable.ic_flash_on else R.drawable.ic_flash_off)
        }
        // edge-to-edge: camera full-bleed, controls clear of the system bars
        b.btnBack.marginForSystemBars(top = true)
        b.hud.marginForSystemBars(bottom = true)
        b.btnMode.visibility = if (Mode.available) View.VISIBLE else View.GONE
        b.btnMode.setOnClickListener { Mode.toggle(this) }
        Mode.observe(onMode)
        applyMode()
        b.padPanel.setOnClickListener { next() }
        if (side == Side.BACK) {
            flipping = true
            b.flipOverlay.visibility = View.VISIBLE
            b.flipCard.post {
                b.flipCard.play {
                    b.flipOverlay.animate().alpha(0f).setDuration(300).withEndAction {
                        b.flipOverlay.visibility = View.GONE
                        flipping = false
                    }.start()
                }
            }
        }
        b.preview.post { previewW = b.preview.width; previewH = b.preview.height }
        startCamera()
    }

    override fun onResume() { super.onResume(); motion.start() }
    override fun onPause() { motion.stop(); super.onPause() }

    /** Verbose ⇄ production, live: the HUD appears or disappears mid-scan; production shows no indicator. */
    private fun applyMode() {
        b.btnMode.setImageResource(if (stage) R.drawable.ic_eye else R.drawable.ic_eye_off)
        b.hud.visibility = if (stage && b.padPanel.visibility != View.VISIBLE) View.VISIBLE else View.GONE
        if (!stage) b.gateBanner.visibility = View.GONE
        if (stage && !capturing && chipViews.isEmpty()) buildChips()
        if (!stage && b.frame.state != CardFrameView.State.CAPTURING && b.frame.state != CardFrameView.State.DONE) {
            b.frame.state = CardFrameView.State.SEARCHING
        }
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
                        .setResolutionStrategy(ResolutionStrategy(Size(1920, 1080), ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER))
                        .build(),
                )
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .build()
                .also { it.setAnalyzer(worker, ::analyze) }
            imageCapture = ImageCapture.Builder().setCaptureMode(ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY).build()
            provider.unbindAll()
            camera = provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis, imageCapture)
            Session.tel(side).openedAt = System.currentTimeMillis()
        }, ContextCompat.getMainExecutor(this))
    }

    // ---------------------------------------------------------------- preview: quality gate

    private fun analyze(image: ImageProxy) {
        if (capturing || flipping || previewW == 0) { image.close(); return }
        val frame = image.use { Frames.toMat(it) } ?: return
        val tel = Session.tel(side)
        val now = SystemClock.elapsedRealtime()
        if (tel.firstFrameAt == 0L) tel.firstFrameAt = System.currentTimeMillis()
        tel.frames++
        if (lastFrameAt > 0) fps = 0.8 * fps + 0.2 * (1000.0 / (now - lastFrameAt).coerceAtLeast(1))
        lastFrameAt = now
        try {
            val gate = pipeline.gate(frame, side.toCard(), previewW, previewH)
            if (!gate.passed) {
                streak = 0
                tel.hint(gate.hint!!.key)
                render(gate.hint, gate.findings.toChecks(), null)
                return
            }
            val doc = gate.document!!
            try {
                var checks = gate.findings.toChecks()
                if (side == Side.BACK) {
                    val mrz = MrzParser.find(Ocr.lines(Frames.toBitmap(doc)))
                    val ok = mrz != null && mrz.checks.all
                    checks = checks + Check(
                        Group.QUALITY, side, "MRZ", if (ok) Outcome.PASS else Outcome.FAIL,
                        if (mrz == null) "not found" else if (ok) "3 lines · check digits ✓" else "check digits failing", "",
                    )
                    if (!ok) {
                        streak = 0
                        tel.hint(Hint.MRZ.key)
                        render(Hint.MRZ, checks, null)
                        return
                    }
                    previewMrz = mrz
                }
                streak++
                previewChecks = gate.findings.toChecks()
                render(null, checks, "All quality gates passed · capturing")
                if (streak >= STREAK) {
                    capturing = true
                    runOnUiThread { capture() }
                }
            } finally {
                doc.release()
            }
        } catch (e: Exception) {
            Log.e(TAG, "gate failed", e)
        } finally {
            frame.release()
        }
    }

    private fun hintText(h: Hint) = getString(
        when (h) {
            Hint.FIND_CARD -> R.string.hint_no_card
            Hint.CENTER -> R.string.hint_center
            Hint.DARK -> R.string.hint_dark
            Hint.CLOSER -> R.string.hint_closer
            Hint.BLUR -> R.string.hint_blur
            Hint.FINGERS -> R.string.hint_fingers
            Hint.GLARE -> R.string.hint_glare
            Hint.PHOTO -> R.string.hint_photo
            Hint.MRZ -> R.string.hint_mrz
        },
    )

    /** Guidance for the applicant (held long enough to read) + the presenter HUD. */
    private fun render(hint: Hint?, checks: List<Check>, readyText: String?) {
        val now = SystemClock.elapsedRealtime()
        runOnUiThread {
            if (capturing) return@runOnUiThread
            if (hint == null) {
                if (stage) b.frame.state = CardFrameView.State.READY
                b.hint.text = getString(R.string.scan_hold)
                lastHint = null
            } else if (hint != lastHint && now - lastHintAt > HINT_HOLD_MS) {
                b.hint.text = hintText(hint)
                lastHint = hint; lastHintAt = now
                b.frame.state = if (!stage || hint == Hint.FIND_CARD) CardFrameView.State.SEARCHING else CardFrameView.State.GUIDING
            }
            if (stage) renderHud(hint, checks, readyText)
        }
    }

    // ---------------------------------------------------------------- presenter HUD

    private fun buildChips() {
        b.hudChips.removeAllViews(); chipViews.clear()
        gates.chunked(4).forEachIndexed { r, row ->
            val line = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                if (r > 0) setPadding(0, dp(6), 0, 0)
            }
            row.forEach { g ->
                val c = ChipSignalBinding.inflate(layoutInflater, line, false)
                c.text.text = g.chip
                line.addView(c.root); chipViews += c
            }
            repeat(4 - row.size) { line.addView(View(this), LinearLayout.LayoutParams(0, 1, 1f).apply { marginEnd = dp(6) }) }
            b.hudChips.addView(line)
        }
        paintChips(emptyList(), failingIndex = 0)
    }

    private fun renderHud(hint: Hint?, checks: List<Check>, readyText: String?) {
        val failing = when (hint) {
            null -> -1
            Hint.FIND_CARD, Hint.CENTER -> 0
            else -> checks.lastOrNull { it.outcome == Outcome.FAIL }?.let { f -> gates.indexOfFirst { it.check == f.label } } ?: -1
        }
        paintChips(checks, failing)
        val f = checks.lastOrNull { it.outcome == Outcome.FAIL }
        // the blocking gate, big and in plain words, right under the card for the audience
        b.gateBanner.visibility = View.VISIBLE
        if (readyText != null) {
            b.gateBanner.text = "✓  All quality gates passed · capturing"
            b.gateBanner.backgroundTintList = ColorStateList.valueOf(Color.parseColor("#2BD48A"))
        } else {
            b.gateBanner.text = gateText(hint, f)
            b.gateBanner.backgroundTintList = ColorStateList.valueOf(Color.parseColor("#FFC24B"))
        }
        b.hudReadout.text = when {
            readyText != null -> readyText
            f != null -> "${f.label} · ${f.value}" + if (f.rule.isNotBlank()) "  (${f.rule})" else ""
            else -> "Searching for a card"
        }
        b.hudMeta.text = "gyro %.3f · %.0f fps".format(motion.liveGyro, fps)
    }

    /** Solid state colours an audience can read from a distance: green passed, amber blocking, grey not reached. */
    private fun paintChips(checks: List<Check>, failingIndex: Int) {
        val pass = Color.parseColor("#2BD48A"); val fail = Color.parseColor("#FFC24B"); val idle = Color.parseColor("#1FFFFFFF")
        gates.forEachIndexed { i, g ->
            val c = checks.firstOrNull { it.label == g.check }
            val col = when {
                i == failingIndex -> fail
                c?.outcome == Outcome.PASS -> pass
                else -> idle
            }
            chipViews.getOrNull(i)?.let { v ->
                v.root.backgroundTintList = ColorStateList.valueOf(col)
                v.dot.visibility = View.GONE
                v.text.setTextColor(if (col == idle) Color.parseColor("#80FFFFFF") else Color.parseColor("#111112"))
                v.text.text = (if (col == pass) "✓ " else if (col == fail) "! " else "") + g.chip
            }
        }
    }

    private fun gateText(hint: Hint?, f: Check?): String = when (hint) {
        Hint.FIND_CARD, null -> "Looking for the card"
        Hint.CENTER -> "Card not centred"
        Hint.DARK -> "Too dark · brightness ${f?.value ?: ""}"
        Hint.CLOSER -> "Card too far · ${f?.value ?: ""} of the frame"
        Hint.BLUR -> "Blurry image"
        Hint.FINGERS -> "Finger over the card · ${f?.value ?: ""}"
        Hint.GLARE -> "Glare on the card · ${f?.value ?: ""}"
        Hint.PHOTO -> "ID photo not clearly visible"
        Hint.MRZ -> "Code lines not readable yet"
    }.trimEnd(' ', '·')

    // ---------------------------------------------------------------- still: PAD + OCR

    private fun capture() {
        b.frame.state = CardFrameView.State.CAPTURING
        b.spinner.visibility = View.VISIBLE
        b.hint.text = getString(R.string.scan_checking)
        if (stage) {
            b.gateBanner.text = "Checking for screen replay, print, moiré${if (side == Side.FRONT) ", photo tampering" else ""}…"
            b.gateBanner.backgroundTintList = ColorStateList.valueOf(Color.WHITE)
        }
        val tel = Session.tel(side)
        tel.gyroRms = motion.gyroRms(); tel.accelStd = motion.accelStd(); tel.motionSamples = motion.samples()
        val ic = imageCapture ?: return resume(null)
        ic.takePicture(worker, object : ImageCapture.OnImageCapturedCallback() {
            override fun onCaptureSuccess(image: ImageProxy) {
                val frame = image.use { Frames.toMat(it) }
                if (frame == null) { resume(null); return }
                try {
                    process(frame)
                } catch (e: Exception) {
                    Log.e(TAG, "capture processing failed", e)
                    resume(null)
                } finally {
                    frame.release()
                }
            }

            override fun onError(exception: ImageCaptureException) {
                Log.e(TAG, "capture failed", exception)
                resume(null)
            }
        })
    }

    private fun process(frame: Mat) {
        val gate = pipeline.gate(frame, side.toCard(), previewW, previewH, highResolution = true)
        if (!gate.passed) { resume(gate.hint); return }
        val doc = gate.document!!
        try {
            val pad = pipeline.presentationAttack(frame, doc, side.toCard(), gate.faceRect).toChecks()
            // is this a chipped card? (ICAO chip symbol) — decides whether the chip step is mandatory
            val symbol = ChipSymbol.detect(doc)
            Session.chipSymbol[side] = symbol.confidence
            val symbolCheck = Check(
                Group.CHIP, side, "ICAO chip symbol", Outcome.INFO,
                (if (symbol.found) "found" else "not found") + " · %.2f".format(symbol.confidence),
                "≥ ${ChipSymbol.THRESHOLD} → chip read becomes mandatory",
            )
            val bitmap = Frames.toBitmap(doc)
            val lines = Ocr.lines(bitmap)
            // quality as measured on the still, plus the preview-only checks (fingers, glare)
            val still = gate.findings.toChecks()
            val onStill = still.map { it.label }.toSet()
            val quality = still + previewChecks.filter { it.label !in onStill }
            Session.tel(side).capturedAt = System.currentTimeMillis()
            val face = gate.faceRect?.let { android.graphics.Rect(it.x, it.y, it.x + it.width, it.y + it.height) }
            val captured = SideCapture(side, bitmap, quality + pad + symbolCheck, lines, face)

            if (side == Side.FRONT) {
                Session.front = captured
                Session.frontTemplate = gate.nearestTemplate
            } else {
                Session.back = captured
                val mrz = MrzParser.find(lines)?.takeIf { it.checks.all } ?: previewMrz
                Session.mrz = mrz
                val front = Session.front?.ocrLines.orEmpty()
                Session.classification = SwissClassifier.classify(Session.selected, front, mrz, Session.frontTemplate) +
                    SwissClassifier.crossChecks(front, mrz, today())
                val detected = SwissClassifier.detectedType(front, mrz)
                suggested = detected.takeIf { Session.selected != ch.attest.onboarding.core.SwissDocType.ANY_TD1 && it != null && it != Session.selected }
            }
            Log.i(TAG, "${side.label}: " + (quality + pad).joinToString { "${it.label}=${it.outcome}" })
            runOnUiThread { reveal(pad + symbolCheck) }
        } finally {
            doc.release()
        }
    }

    /** Presenter: reveal each attack check one by one. Applicant: a quick confirmation. */
    private fun reveal(pad: List<Check>) {
        b.spinner.visibility = View.GONE
        b.frame.state = CardFrameView.State.DONE
        b.doneMark.visibility = View.VISIBLE
        b.doneMark.scaleX = 0.6f; b.doneMark.scaleY = 0.6f
        b.doneMark.animate().scaleX(1f).scaleY(1f).setDuration(220).start()
        b.hint.text = getString(R.string.scan_done)
        if (!stage) {
            b.root.postDelayed({ next() }, 650)
            return
        }
        showAttackResults(pad)
    }

    /**
     * Verbose: the presentation-attack verdict of this capture, one check at a time, big enough for
     * the people watching the demo. Tap to continue (or it continues by itself).
     */
    private fun showAttackResults(pad: List<Check>) {
        b.hud.visibility = View.GONE
        b.gateBanner.visibility = View.GONE
        b.padRows.removeAllViews()
        b.padTitle.text = "Presentation-attack checks · ${side.label} of the card"
        b.padVerdict.visibility = View.INVISIBLE
        b.padPanel.alpha = 0f; b.padPanel.translationY = 40 * resources.displayMetrics.density
        b.padPanel.visibility = View.VISIBLE
        b.padPanel.animate().alpha(1f).translationY(0f).setDuration(260).start()
        val step = 420L
        pad.forEachIndexed { i, c ->
            b.root.postDelayed({
                if (isFinishing) return@postDelayed
                val r = RowPadResultBinding.inflate(layoutInflater, b.padRows, false)
                val (glyph, col) = when (c.outcome) {
                    Outcome.PASS -> "✓" to Color.parseColor("#2BD48A")
                    Outcome.FAIL -> "✕" to Color.parseColor("#FF5A4E")
                    Outcome.WARN -> "!" to Color.parseColor("#FFC24B")
                    else -> "i" to Color.parseColor("#7A7F8A")
                }
                val (title, detail) = attackLine(c)
                r.mark.text = glyph
                r.mark.backgroundTintList = ColorStateList.valueOf(col)
                r.title.text = title
                r.detail.text = detail
                r.root.alpha = 0f; r.root.translationX = 24 * resources.displayMetrics.density
                b.padRows.addView(r.root)
                r.root.animate().alpha(1f).translationX(0f).setDuration(220).start()
                r.mark.scaleX = 0.4f; r.mark.scaleY = 0.4f
                r.mark.animate().scaleX(1f).scaleY(1f).setDuration(260).setInterpolator(android.view.animation.OvershootInterpolator(2f)).start()
            }, 300L + i * step)
        }
        val attack = pad.firstOrNull { it.outcome == Outcome.FAIL }
        b.root.postDelayed({
            if (isFinishing) return@postDelayed
            b.padVerdict.text = if (attack == null) "✓  No attack detected on the ${side.label}" else "✕  ATTACK DETECTED · ${attackLine(attack).first}"
            b.padVerdict.backgroundTintList = ColorStateList.valueOf(Color.parseColor(if (attack == null) "#1F9D63" else "#D7261B"))
            b.padVerdict.visibility = View.VISIBLE
            b.padVerdict.scaleX = 0.9f; b.padVerdict.scaleY = 0.9f
            b.padVerdict.animate().scaleX(1f).scaleY(1f).setDuration(240).start()
        }, 300L + pad.size * step)
        b.root.postDelayed({ next() }, 300L + pad.size * step + if (attack == null) 2600L else 4500L)
    }

    /** Plain-language line for an attack check, for people who don't read model names. */
    private fun attackLine(c: Check): Pair<String, String> {
        val pass = c.outcome == Outcome.PASS
        return when (c.label) {
            "Physical document" -> if (pass) "Real card in front of the camera" to "not a screen, not a printout · ${c.value.substringAfter("· ")}"
                else "Not a physical card: ${c.value.substringBefore(" ·")}" to "scene model · ${c.value.substringAfter("· ")}"
            "Colour document" -> if (pass) "Original colour card" to "not a black-and-white photocopy"
                else if (c.outcome == Outcome.SKIPPED) "Colour check skipped" to c.value else "Black-and-white copy" to "a photocopy of the card"
            "Screen pattern (moiré)" -> if (pass) "No screen pixel pattern" to "not filmed off another display · moiré ${c.value}"
                else "Screen pattern detected" to "filmed off a display · moiré ${c.value} (limit ${c.rule.removePrefix("≤ ")})"
            "ID photo tampering" -> if (pass) "ID photo intact" to "no sign of a replaced portrait · ${c.value}"
                else "ID photo replaced or edited" to "tamper score ${c.value}"
            "ICAO chip symbol" -> if (c.value.startsWith("found")) "Chip symbol found" to "the chip read will be required" else "No chip symbol" to "chip step stays optional"
            else -> c.label to c.value
        }
    }

    private fun resume(hint: Hint?) {
        streak = 0
        runOnUiThread {
            b.spinner.visibility = View.GONE
            b.frame.state = CardFrameView.State.SEARCHING
            if (stage) { b.hudTitle.text = "Live signals"; buildChips() }
            hint?.let { b.hint.text = hintText(it); lastHint = it; lastHintAt = SystemClock.elapsedRealtime() }
            capturing = false
        }
    }

    /** The card is a different Swiss document than the one selected: offer to switch, don't fail silently. */
    private fun confirmDocumentType(detected: ch.attest.onboarding.core.SwissDocType) {
        val selected = Session.selected
        androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle(getString(R.string.doc_mismatch_title, detected.title))
            .setMessage(getString(R.string.doc_mismatch_body, selected.title, detected.title))
            .setCancelable(false)
            .setPositiveButton(getString(R.string.doc_mismatch_switch, detected.title)) { _, _ ->
                Session.selected = detected
                val front = Session.front?.ocrLines.orEmpty()
                Session.classification = SwissClassifier.classify(detected, front, Session.mrz, Session.frontTemplate) +
                    SwissClassifier.crossChecks(front, Session.mrz, today()) +
                    Check(Group.CLASSIFICATION, null, "Document type corrected", Outcome.INFO,
                        "selected ${selected.title} → scanned card is ${detected.title} (applicant confirmed)",
                        "type detected from the front title and the MRZ")
                suggested = null
                next()
            }
            .setNegativeButton(R.string.doc_mismatch_keep) { _, _ -> suggested = null; next() }
            .show()
    }

    private fun next() {
        if (isFinishing) return
        suggested?.let { confirmDocumentType(it); return }
        if (side == Side.FRONT) {
            startActivity(Intent(this, ScanActivity::class.java).putExtra(EXTRA_SIDE, Side.BACK.name))
        } else {
            startActivity(Intent(this, NfcActivity::class.java))
        }
        overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out)
        finish()
    }

    private fun today(): Int = Calendar.getInstance().let {
        it.get(Calendar.YEAR) * 10000 + (it.get(Calendar.MONTH) + 1) * 100 + it.get(Calendar.DAY_OF_MONTH)
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
}
