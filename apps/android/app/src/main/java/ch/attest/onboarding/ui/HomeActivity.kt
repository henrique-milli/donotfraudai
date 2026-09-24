package ch.attest.onboarding.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Bundle
import android.view.HapticFeedbackConstants
import android.view.View
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import ch.attest.onboarding.R
import ch.attest.onboarding.core.LastSession
import ch.attest.onboarding.core.Mode
import ch.attest.onboarding.core.Payload
import ch.attest.onboarding.core.Session
import ch.attest.onboarding.core.Side
import ch.attest.onboarding.core.SwissDocType
import ch.attest.onboarding.databinding.ActivityHomeBinding
import ch.attest.onboarding.databinding.RowOptionBinding
import ch.attest.onboarding.databinding.RowStepBinding
import ch.attest.onboarding.signals.Attestor
import ch.attest.onboarding.signals.DeviceIntegrity
import java.util.concurrent.Executors
import ch.digitaltrust.engine.ScannerRuntime

class HomeActivity : AppCompatActivity() {

    private lateinit var b: ActivityHomeBinding
    private var selected = SwissDocType.CHE_ID
    private val attestor = Executors.newSingleThreadExecutor()
    private val options = LinkedHashMap<SwissDocType, View>()

    private val cameraPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) start() else Toast.makeText(this, R.string.camera_required, Toast.LENGTH_LONG).show()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivityHomeBinding.inflate(layoutInflater)
        setContentView(b.root)
        b.loadingSpinner.tint(ContextCompat.getColor(this, R.color.at_ink), ContextCompat.getColor(this, R.color.at_hairline))

        listOf(
            Triple(R.drawable.ic_step_front, R.string.step_front, "Photo side"),
            Triple(R.drawable.ic_step_back, R.string.step_back, "Code lines"),
            Triple(R.drawable.ic_step_chip, R.string.step_chip, "If your card has one"),
            Triple(R.drawable.ic_step_face, R.string.step_face, "Look at the camera"),
        ).forEachIndexed { i, (icon, title, sub) ->
            val s = RowStepBinding.inflate(layoutInflater, b.steps, false)
            s.icon.setImageResource(icon)
            s.title.text = "${i + 1}  ${getString(title)}"
            s.subtitle.text = sub
            b.steps.addView(s.root)
        }

        b.root.padForSystemBars()
        b.modeVerbose.setOnClickListener { setMode(true, it) }
        b.modeProd.setOnClickListener { setMode(false, it) }
        b.btnStart.setOnClickListener {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) start()
            else cameraPermission.launch(Manifest.permission.CAMERA)
        }
        renderMode()
        ScannerRuntime.listen(::onModelLoad)
    }

    override fun onResume() {
        super.onResume()
        renderMode() // the mode may have been switched on a capture screen
        // a re-verification requested after the fact (risk engine or analyst) waits here
        val last = LastSession.get(this) ?: return
        Thread {
            val pending = Payload.next(last.first, last.second)
            runOnUiThread {
                if (isFinishing) return@runOnUiThread
                b.pendingCard.visibility = if (pending != null) View.VISIBLE else View.GONE
                pending?.let { p -> b.btnPending.setOnClickListener { startActivity(SelfieActivity.active(this, p)) } }
            }
        }.start()
    }

    override fun onDestroy() {
        ScannerRuntime.listen(null)
        super.onDestroy()
    }

    private fun setMode(verbose: Boolean, v: View) {
        if (Mode.stage == verbose) return
        v.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
        Mode.set(this, verbose)
        Toast.makeText(this, if (verbose) R.string.mode_stage_on else R.string.mode_stage_off, Toast.LENGTH_SHORT).show()
        renderMode()
    }

    private fun renderMode() {
        val stage = Mode.stage
        b.stageCard.visibility = if (stage) View.VISIBLE else View.GONE
        b.modeToggle.visibility = if (Mode.available) View.VISIBLE else View.GONE
        fun seg(t: android.widget.TextView, on: Boolean, activeColor: Int) {
            t.background = if (on) androidx.core.content.ContextCompat.getDrawable(this, R.drawable.bg_pill)?.mutate()?.apply {
                setTint(activeColor)
            } else null
            t.setTextColor(if (on) Color.WHITE else ContextCompat.getColor(this, R.color.at_ink_2))
        }
        seg(b.modeVerbose, stage, Color.parseColor("#D7261B"))
        seg(b.modeProd, !stage, ContextCompat.getColor(this, R.color.at_ink))
        if (!stage && selected.stageOnly) selected = SwissDocType.CHE_ID
        b.options.removeAllViews(); options.clear()
        SwissDocType.values().filter { stage || !it.stageOnly }.forEach { doc ->
            val o = RowOptionBinding.inflate(layoutInflater, b.options, false)
            o.title.text = doc.title
            o.subtitle.text = doc.subtitle
            o.root.setOnClickListener { select(doc) }
            b.options.addView(o.root)
            options[doc] = o.root
        }
        select(selected)
    }

    private fun select(doc: SwissDocType) {
        selected = doc
        options.forEach { (d, v) -> v.isSelected = d == doc }
    }

    private fun onModelLoad(status: ScannerRuntime.State, throwable: Throwable?) {
        runOnUiThread {
            when (status) {
                ScannerRuntime.State.DONE -> {
                    b.loadingRow.visibility = View.GONE
                    b.btnStart.isEnabled = true
                }
                ScannerRuntime.State.ERROR -> {
                    b.loadingSpinner.visibility = View.GONE
                    b.loadingText.text = getString(R.string.home_models_error)
                    b.btnStart.isEnabled = false
                }
                ScannerRuntime.State.LOADING -> {
                    b.loadingRow.visibility = View.VISIBLE
                    b.btnStart.isEnabled = false
                }
            }
        }
    }

    private fun start() {
        Session.reset(selected)
        Session.device = DeviceIntegrity.collect(this)
        Session.device.filter { it.outcome != ch.attest.onboarding.core.Outcome.PASS }
            .forEach { android.util.Log.i("AttestDevice", "${it.outcome} ${it.label}: ${it.value}") }
        // hardware attestation + device profile run while the applicant scans
        val id = Session.id
        val app = applicationContext
        Session.attestationJob = attestor.submit {
            val r = Attestor.collect(app, id)
            if (Session.id == id) Session.attestation = r
        }
        startActivity(Intent(this, ScanActivity::class.java).putExtra(ScanActivity.EXTRA_SIDE, Side.FRONT.name))
        overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out)
    }
}
