package ch.attest.onboarding.ui

import android.content.Intent
import android.nfc.NfcAdapter
import android.nfc.Tag
import android.os.Bundle
import android.provider.Settings
import android.util.Log
import android.view.View
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import ch.attest.onboarding.R
import ch.attest.onboarding.core.ChipPolicy
import ch.attest.onboarding.core.Mode
import ch.attest.onboarding.core.Session
import ch.attest.onboarding.databinding.ActivityNfcBinding
import ch.attest.onboarding.nfc.ChipVerifier
import ch.digitaltrust.engine.ChipReader

/**
 * Standard ICAO 9303 chip read (PACE, BAC fallback, DG14 Chip Authentication), keyed from the
 * printed MRZ, then verified on device by ChipVerifier.
 *
 * Enforcement: when the card shows chip evidence and this phone can read NFC, the step cannot be
 * skipped — that closes the downgrade path. After repeated failures the applicant can continue,
 * but the session goes to review instead of being accepted on visual evidence alone.
 */
class NfcActivity : AppCompatActivity(), NfcAdapter.ReaderCallback {

    private lateinit var b: ActivityNfcBinding
    private var adapter: NfcAdapter? = null
    @Volatile private var reading = false
    private lateinit var decision: ChipPolicy.Decision
    private val maxAttempts = 3

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivityNfcBinding.inflate(layoutInflater)
        setContentView(b.root)
        b.stepBar.onDark = false
        b.root.padForSystemBars()
        b.stepBar.steps = 4
        b.stepBar.current = 2
        b.progress.tint(ContextCompat.getColor(this, R.color.at_ink), ContextCompat.getColor(this, R.color.at_hairline))
        b.btnBack.setOnClickListener { finish() }
        adapter = NfcAdapter.getDefaultAdapter(this)

        val best = Session.bestSymbol()
        decision = ChipPolicy.decide(Session.selected, best?.second, best?.first, adapter != null, adapter?.isEnabled == true)
        Session.chipDecision = decision

        val mrz = Session.mrz
        if (mrz == null || !mrz.checks.all) {
            skip("MRZ not read, so the chip access key is unavailable"); return
        }
        b.stageBox.visibility = if (Mode.stage) View.VISIBLE else View.GONE
        b.stageTitle.text = if (decision.enforced) "Presenter · chip enforced" else "Presenter · chip optional"
        b.docLine.text = "${decision.expectation.label} — ${decision.reason}\n" +
            "access key: ${mrz.documentCode} · ${mrz.issuingState} · ${mask(mrz.documentNumber)} · birth •••••• · expiry ${mrz.dateOfExpiry}"
        val expected = decision.expectation == ChipPolicy.Expectation.REQUIRED
        b.required.visibility = if (decision.enforced) View.VISIBLE else View.GONE
        if (adapter == null) {
            b.body.text = getString(if (expected) R.string.nfc_none_expected else R.string.nfc_none)
            b.btnSkip.text = getString(R.string.nfc_continue)
            b.btnSkip.setOnClickListener { skip("no NFC reader on this phone") }
            return
        }
        if (decision.enforced) {
            // chipped card + NFC phone: the chip is the only way forward
            b.btnSkip.visibility = View.GONE
            b.btnSkip.setOnClickListener { skip("holder could not complete the chip read") }
        } else {
            b.btnSkip.setOnClickListener { skip("holder reported the card has no chip") }
        }
        b.btnSettings.setOnClickListener { startActivity(Intent(Settings.ACTION_NFC_SETTINGS)) }
    }

    private fun bodyText() = getString(if (decision.enforced) R.string.nfc_body_required else R.string.nfc_body)

    private fun mask(s: String) = if (s.length <= 3) s else s.take(2) + "•".repeat(s.length - 4) + s.takeLast(2)

    override fun onResume() {
        super.onResume()
        val a = adapter ?: return
        if (!a.isEnabled) {
            b.body.text = getString(R.string.nfc_off)
            b.btnSettings.visibility = View.VISIBLE
            return
        }
        b.btnSettings.visibility = View.GONE
        if (!reading) b.body.text = bodyText()
        a.enableReaderMode(
            this, this,
            NfcAdapter.FLAG_READER_NFC_A or NfcAdapter.FLAG_READER_NFC_B or NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK,
            Bundle().apply { putInt(NfcAdapter.EXTRA_READER_PRESENCE_CHECK_DELAY, 500) },
        )
    }

    override fun onPause() {
        adapter?.disableReaderMode(this)
        super.onPause()
    }

    /** Binder thread — blocking chip I/O is fine here. */
    override fun onTagDiscovered(tag: Tag) {
        if (reading) return
        val mrz = Session.mrz ?: return
        reading = true
        runOnUiThread {
            b.progress.visibility = View.VISIBLE
            b.pulse.active = true
            b.body.text = getString(R.string.nfc_reading)
            b.btnSkip.isEnabled = false
        }
        Session.chipAttempts++
        try {
            val data = ChipReader.read(tag, mrz.accessKey)
            Session.chip = ChipVerifier.verify(data, mrz)
            runOnUiThread { result() }
        } catch (e: Exception) {
            Log.e("AttestNfc", "chip read failed", e)
            reading = false
            val bac = e.javaClass.simpleName.contains("BAC", ignoreCase = true)
            runOnUiThread {
                b.progress.visibility = View.GONE
                b.pulse.active = false
                b.btnSkip.isEnabled = true
                b.body.text = getString(if (bac) R.string.nfc_bac else R.string.nfc_retry)
                // enforced: after repeated failures allow continuing, but the session goes to review
                if (decision.enforced && Session.chipAttempts >= maxAttempts) {
                    b.btnSkip.text = getString(R.string.nfc_give_up)
                    b.btnSkip.visibility = View.VISIBLE
                }
            }
        }
    }

    private fun skip(reason: String) {
        Session.chipSkippedReason = reason
        result()
    }

    private fun result() {
        startActivity(Intent(this, SelfieActivity::class.java))
        overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out)
        finish()
    }
}
