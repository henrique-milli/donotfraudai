package ch.attest.onboarding.ui

import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Color
import android.os.Bundle
import android.view.View
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import ch.attest.onboarding.BuildConfig
import ch.attest.onboarding.R
import ch.attest.onboarding.core.Envelope
import ch.attest.onboarding.core.Check
import ch.attest.onboarding.core.Group
import ch.attest.onboarding.core.LastSession
import ch.attest.onboarding.core.Mode
import ch.attest.onboarding.core.Outcome
import ch.attest.onboarding.core.Payload
import ch.attest.onboarding.core.Session
import ch.attest.onboarding.core.SwissClassifier
import ch.attest.onboarding.databinding.ActivityDoneBinding
import ch.attest.onboarding.databinding.ActivityResultBinding
import ch.attest.onboarding.databinding.RowCheckBinding
import ch.attest.onboarding.databinding.RowDriverBinding
import ch.attest.onboarding.databinding.RowGroupBinding
import java.util.Calendar

/**
 * End of the flow. The session payload is always written (that is the silent collection).
 * Applicant view: a neutral ending, whatever the verdict. Presenter view: the full risk dashboard.
 */
class ResultActivity : AppCompatActivity() {

    companion object {
        /** presenter asks to see exactly what the applicant would see */
        const val EXTRA_APPLICANT = "applicant"
        /** coming back from an active-liveness re-verification */
        const val EXTRA_REVERIFIED = "reverified"
        const val EXTRA_ROUTE = "route"
        const val EXTRA_DELIVERY = "delivery"
    }

    private fun c(id: Int) = ContextCompat.getColor(this, id)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val preview = intent.getBooleanExtra(EXTRA_APPLICANT, false)
        if (preview) { applicant(true, null); return }
        if (intent.getBooleanExtra(EXTRA_REVERIFIED, false)) { reverified(); return }
        // attestation → sign → seal → deliver; then ask the backend whether it needs an active check
        presenterLoading()
        val app = applicationContext
        Thread {
            Session.awaitAttestation()
            val sealed = Payload.seal(app)
            if (sealed?.route != null) LastSession.save(app, Session.id, Session.resumeToken)
            val pending = if (sealed?.route == "STEP_UP") Payload.next(Session.id, Session.resumeToken) else null
            runOnUiThread {
                if (isFinishing) return@runOnUiThread
                when {
                    Mode.stage -> presenter(sealed, pending)
                    // applicant: analyst-requested step-up is simply the next screen, with no reason given
                    pending != null -> { startActivity(SelfieActivity.active(this, pending)); finish() }
                    else -> applicant(false, sealed?.route)
                }
            }
        }.start()
    }

    private fun reverified() {
        val b = ActivityDoneBinding.inflate(layoutInflater)
        setContentView(b.root)
        b.root.padForSystemBars()
        b.btnDone.setOnClickListener { home() }
        if (Mode.stage) {
            b.presenterNote.visibility = View.VISIBLE
            b.presenterNote.text = "Presenter: active liveness sealed with a fresh attested key and sent. " +
                "Backend route now: ${intent.getStringExtra(EXTRA_ROUTE) ?: "not delivered"} (${intent.getStringExtra(EXTRA_DELIVERY)}). " +
                "The applicant sees only this screen."
        }
    }

    private fun presenterLoading() {
        setContentView(android.widget.FrameLayout(this).apply {
            setBackgroundColor(c(R.color.at_paper))
            addView(ch.attest.onboarding.ui.widget.ArcSpinner(this@ResultActivity).apply {
                tint(c(R.color.at_ink), c(R.color.at_hairline))
            }, android.widget.FrameLayout.LayoutParams(dp(40), dp(40), android.view.Gravity.CENTER))
        })
    }

    private fun home() {
        startActivity(Intent(this, HomeActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP))
        finish()
    }

    // ------------------------------------------------------------------ applicant

    private fun applicant(preview: Boolean, route: String?) {
        val b = ActivityDoneBinding.inflate(layoutInflater)
        setContentView(b.root)
        b.root.padForSystemBars()
        // Polite endings only — never scores or reasons (oracle-safe).
        when (route) {
            "CONTINUE" -> {
                b.title.setText(R.string.done_title_ok)
                b.body.setText(R.string.done_body_ok)
            }
            "BRANCH_VISIT" -> {
                b.title.setText(R.string.done_title_branch)
                b.body.setText(R.string.done_body_branch)
            }
            "MANUAL_REVIEW" -> {
                b.title.setText(R.string.done_title_review)
                b.body.setText(R.string.done_body_review)
            }
            else -> {
                b.title.setText(R.string.done_title)
                b.body.setText(R.string.done_body)
            }
        }
        b.presenterNote.visibility = if (preview) View.VISIBLE else View.GONE
        if (preview) {
            b.presenterNote.text = "Presenter: applicant ending for route ${route ?: "(preview)"}. No scores or reasons."
        }
        b.mark.scaleX = 0.5f; b.mark.scaleY = 0.5f; b.mark.alpha = 0f
        b.mark.animate().scaleX(1f).scaleY(1f).alpha(1f).setStartDelay(120).setDuration(380).start()
        b.btnDone.setOnClickListener { if (preview) finish() else home() }
    }

    // ------------------------------------------------------------------ presenter

    private lateinit var b: ActivityResultBinding
    private var revealed = false

    private fun presenter(sealed: Payload.Sealed?, pending: Payload.Pending?) {
        b = ActivityResultBinding.inflate(layoutInflater)
        setContentView(b.root)
        b.root.padForSystemBars()
        b.btnClose.setOnClickListener { home() }
        b.btnAgain.setOnClickListener { home() }
        b.btnApplicant.setOnClickListener {
            startActivity(Intent(this, ResultActivity::class.java).putExtra(EXTRA_APPLICANT, true))
        }
        b.session.text = "Session ${Session.id}"
        b.payloadPath.text = sealed?.file?.absolutePath?.let { "outbox → $it" } ?: ""
        b.sealTitle.text = if (sealed == null) "Payload not sealed" else "Sealed for the risk backend"
        b.sealBody.text = if (sealed == null) "sealing failed, see log" else listOf(
            "${Envelope.ALG} · key ${BuildConfig.BACKEND_KID}",
            "signed by ${sealed.signedBy?.let { "$it-attested key" } ?: "— (no attested key)"}",
            "%.1f KB signals → %.1f KB sealed".format(sealed.plainBytes / 1024.0, sealed.sealedBytes / 1024.0),
            sealed.delivery,
        ).joinToString("\n")
        if (pending != null) {
            b.btnActive.visibility = View.VISIBLE
            b.btnActive.text = "Backend asks for active liveness: ${pending.steps.joinToString(" · ") { it.lowercase().replace('_', ' ') }}  →  Start"
            b.btnActive.setOnClickListener { startActivity(SelfieActivity.active(this, pending)); finish() }
        }

        val all = Session.allChecks()
        hero(all)
        drivers(all)
        groups(all)
        b.reveal.setOnClickListener { revealed = !revealed; holder() }
        holder()
        b.imgFront.setImageBitmap(Session.front?.document)
        b.imgBack.setImageBitmap(Session.back?.document)
    }

    private fun tone(o: Outcome) = when (o) {
        Outcome.PASS -> R.color.at_pass to R.color.at_pass_bg
        Outcome.FAIL -> R.color.at_fail to R.color.at_fail_bg
        Outcome.WARN -> R.color.at_warn to R.color.at_warn_bg
        Outcome.INFO, Outcome.SKIPPED -> R.color.at_info to R.color.at_surface
    }

    private fun hero(all: List<Check>) {
        val v = Session.verdict(all)
        val score = Session.riskScore(all)
        val a = Session.assurance(v)
        b.docType.text = Session.selected.title
        b.gauge.set(score)
        b.verdict.text = v.title
        b.verdict.setTextColor(
            c(when (v) { Session.Verdict.ACCEPTED -> R.color.at_pass; Session.Verdict.REVIEW -> R.color.at_warn; Session.Verdict.BRANCH -> R.color.at_fail }),
        )
        b.assurance.text = "Assurance · ${a.title}"
        b.assuranceDetail.text = a.detail
        val scored = all.filter { it.outcome != Outcome.SKIPPED }
        b.statSignals.value.text = "${scored.size}"; b.statSignals.label.text = "signals"
        b.statPassed.value.text = "${all.count { it.outcome == Outcome.PASS }}"; b.statPassed.label.text = "passed"
        val fired = all.count { it.fired }
        b.statFired.value.text = "$fired"; b.statFired.label.text = "fired"
        b.statFired.value.setTextColor(c(if (fired == 0) R.color.at_ink else R.color.at_fail))
    }

    private fun drivers(all: List<Check>) {
        val top = Session.drivers(all).take(4)
        if (top.isEmpty()) {
            b.drivers.addView(TextView(this).apply {
                setTextAppearance(R.style.at_body); text = getString(R.string.result_no_drivers)
            })
            return
        }
        top.forEach { ch ->
            val r = RowDriverBinding.inflate(layoutInflater, b.drivers, false)
            val (fg, bg) = tone(ch.outcome)
            r.points.text = "+${ch.points}"
            r.points.setTextColor(c(fg))
            r.points.backgroundTintList = ColorStateList.valueOf(c(bg))
            r.why.text = ch.why ?: ch.label
            r.source.text = listOfNotNull(ch.group.title, ch.side?.label, ch.value).joinToString(" · ")
            b.drivers.addView(r.root)
        }
    }

    private fun groups(all: List<Check>) {
        for (g in Group.values()) {
            val rows = all.filter { it.group == g }
            if (rows.isEmpty()) continue
            val gb = RowGroupBinding.inflate(layoutInflater, b.groups, false)
            val scored = rows.filter { it.outcome == Outcome.PASS || it.outcome == Outcome.FAIL || it.outcome == Outcome.WARN }
            val worst = when {
                rows.any { it.outcome == Outcome.FAIL } -> Outcome.FAIL
                rows.any { it.outcome == Outcome.WARN } -> Outcome.WARN
                scored.isEmpty() -> Outcome.INFO
                else -> Outcome.PASS
            }
            gb.status.backgroundTintList = ColorStateList.valueOf(c(tone(worst).first))
            gb.title.text = g.title
            gb.subtitle.text = g.short
            gb.count.text = if (scored.isEmpty()) "—" else "${scored.count { it.outcome == Outcome.PASS }}/${scored.size}"
            rows.forEach { gb.rows.addView(row(it)) }
            fun setOpen(open: Boolean) {
                gb.rows.visibility = if (open) View.VISIBLE else View.GONE
                gb.chevron.animate().rotation(if (open) 90f else 0f).setDuration(150).start()
            }
            setOpen(worst == Outcome.FAIL || worst == Outcome.WARN)
            gb.header.setOnClickListener { setOpen(gb.rows.visibility != View.VISIBLE) }
            b.groups.addView(gb.root)
        }
    }

    private fun row(ch: Check): View {
        val r = RowCheckBinding.inflate(layoutInflater)
        val glyph = when (ch.outcome) {
            Outcome.PASS -> "✓"; Outcome.FAIL -> "✕"; Outcome.WARN -> "!"; Outcome.INFO -> "i"; Outcome.SKIPPED -> "–"
        }
        r.mark.text = glyph
        r.mark.backgroundTintList = ColorStateList.valueOf(c(tone(ch.outcome).first))
        r.label.text = ch.label + (ch.side?.let { "  ·  ${it.label}" } ?: "")
        r.value.text = ch.value
        r.rule.text = ch.rule
        r.rule.visibility = if (ch.rule.isBlank()) View.GONE else View.VISIBLE
        if (ch.points > 0) {
            r.risk.text = "+${ch.points}"
            r.risk.setTextColor(c(tone(ch.outcome).first))
        } else if (ch.risk > 0) {
            r.risk.text = "${ch.risk} pts"
            r.risk.setTextColor(Color.parseColor("#C4C6CC"))
        }
        return r.root
    }

    /** Holder data is masked by default: this screen is projected on stage. */
    private fun holder() {
        val chipMrz = Session.chip?.chipMrz
        val m = chipMrz ?: Session.mrz
        val photo = Session.chip?.face ?: Session.front?.document
        b.holderPhoto.setImageBitmap(photo)
        b.holderPhoto.alpha = if (revealed) 1f else 0.08f
        b.imgFront.alpha = if (revealed) 1f else 0.12f
        b.imgBack.alpha = if (revealed) 1f else 0.12f
        b.reveal.text = if (revealed) "Hide" else "Reveal"
        b.holderFields.removeAllViews()
        fun hide(s: String) = if (revealed) s else s.map { if (it.isLetterOrDigit()) '•' else it }.joinToString("")
        val fields = if (m == null) listOf("MRZ" to "not read") else listOf(
            "Name" to hide("${m.givenNames} ${m.surname}".trim()),
            "Document" to "${SwissClassifier.label(SwissClassifier.mrzKind(m))} · ${hide(m.documentNumber)}",
            "Nationality" to m.nationality,
            "Date of birth" to hide(date(m.dateOfBirth, past = true)),
            "Source" to if (chipMrz != null) "Chip (DG1), signature verified" else "Printed MRZ",
        )
        fields.forEach { (k, v) ->
            b.holderFields.addView(TextView(this).apply { setTextAppearance(R.style.at_label); text = k })
            b.holderFields.addView(TextView(this).apply {
                setTextAppearance(R.style.at_heading); textSize = 14f; text = v
                setPadding(0, dp(2), 0, dp(8))
            })
        }
    }

    private fun date(yymmdd: String, past: Boolean): String {
        val today = Calendar.getInstance().let { it.get(Calendar.YEAR) * 10000 + (it.get(Calendar.MONTH) + 1) * 100 + it.get(Calendar.DAY_OF_MONTH) }
        val d = SwissClassifier.ymd(yymmdd, birth = past, todayYmd = today) ?: return yymmdd
        return "%02d.%02d.%d".format(d % 100, (d / 100) % 100, d / 10000)
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
}
