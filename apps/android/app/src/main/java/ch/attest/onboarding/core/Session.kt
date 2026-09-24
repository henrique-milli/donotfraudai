package ch.attest.onboarding.core

import android.graphics.Bitmap
import java.util.UUID

enum class SwissDocType(val title: String, val subtitle: String, val stageOnly: Boolean = false) {
    CHE_ID("Swiss identity card", "Identitätskarte · Carte d'identité · Carta d'identità"),
    CHE_RESIDENCE("Swiss residence permit", "Ausländerausweis · Titre de séjour · Permesso di soggiorno"),
    /** rehearsal option: any ICAO TD1 card, Swiss-specific classification is not applied */
    ANY_TD1("Any ICAO ID card", "Rehearsal · Swiss classification not applied", stageOnly = true),
}

enum class Side(val label: String) { FRONT("front"), BACK("back") }

enum class Group(val title: String, val short: String) {
    PAD("Presentation attack", "Liveness of the card"),
    FACE("Face", "Is it the holder, and alive"),
    CLASSIFICATION("Document", "What the card claims to be"),
    CONSISTENCY("Cross-checks", "Does the card agree with itself"),
    CHIP("Chip · ICAO 9303", "Cryptographic proof"),
    DEVICE("Device integrity", "Is the capture channel trusted"),
    BEHAVIOUR("Capture behaviour", "Does a human hold a real card"),
    QUALITY("Image quality", "Could the models see clearly"),
}

enum class Outcome { PASS, FAIL, WARN, INFO, SKIPPED }

/**
 * One signal. [rule] states the threshold that produced the outcome so the verdict is auditable.
 * [risk] is the number of risk points this signal adds when its outcome is FAIL or WARN
 * (hand-set weights for the demo, not trained).
 */
data class Check(
    val group: Group,
    val side: Side?,
    val label: String,
    val outcome: Outcome,
    val value: String,
    val rule: String,
    val risk: Int = 0,
    /** plain-language reason shown as a risk driver */
    val why: String? = null,
) {
    val fired get() = outcome == Outcome.FAIL || outcome == Outcome.WARN
    val points get() = if (fired) risk else 0
}

data class SideCapture(
    val side: Side,
    val document: Bitmap,
    val checks: List<Check>,
    val ocrLines: List<String>,
    /** ID portrait location on [document] (front side), from the face-detection model */
    val face: android.graphics.Rect? = null,
)

data class ChipReport(
    val checks: List<Check>,
    val face: Bitmap?,
    val chipMrz: Mrz?,
)

/** What happened while one side was being captured — behavioural signals, collected silently. */
class SideTelemetry {
    var openedAt = 0L
    var firstFrameAt = 0L
    var capturedAt = 0L
    var frames = 0
    /** how often each guidance hint was raised before capture */
    val hints = LinkedHashMap<String, Int>()
    var gyroRms = Double.NaN
    var accelStd = Double.NaN
    var motionSamples = 0

    val seconds: Double get() = if (capturedAt > openedAt && openedAt > 0) (capturedAt - openedAt) / 1000.0 else Double.NaN
    fun hint(key: String) { hints[key] = (hints[key] ?: 0) + 1 }
}

/** Selfie capture. Passive: neutral selfie + burst frames. Active: neutral selfie + one frame per gesture. */
class FaceCapture(
    val mode: String,                      // PASSIVE / ACTIVE
    val selfie: Bitmap,
    val frames: List<Bitmap>,              // burst frames (passive) or gesture frames (active), in step order
    val gestures: List<String> = emptyList(),
    val checks: List<Check>,
    /** id of the server-issued face challenge the gestures answer; null when drawn offline */
    val challenge: String? = null,
)

/** In-memory session for one onboarding run. */
object Session {
    var id: String = newId()
    var selected: SwissDocType = SwissDocType.CHE_ID
    var startedAt = 0L
    var front: SideCapture? = null
    var back: SideCapture? = null
    var mrz: Mrz? = null
    /** nearest ID-classifier template for the front, informational only */
    var frontTemplate: String? = null
    var classification: List<Check> = emptyList()
    var device: List<Check> = emptyList()
    var chip: ChipReport? = null
    var chipSkippedReason: String? = null
    var face: FaceCapture? = null
    /** proves to the backend that this phone owns the session (sent inside the signed payload) */
    var resumeToken: String = newToken()
    /** best ICAO chip-symbol confidence per side */
    val chipSymbol = mutableMapOf<Side, Double>()
    var chipDecision: ChipPolicy.Decision? = null
    var chipAttempts = 0
    /** device attestation + profile, collected in the background at session start */
    @Volatile var attestation: ch.attest.onboarding.signals.AttestationReport? = null
    var attestationJob: java.util.concurrent.Future<*>? = null
    val telemetry = mutableMapOf<Side, SideTelemetry>()

    private fun newId() = UUID.randomUUID().toString().take(8).uppercase()
    private fun newToken() = UUID.randomUUID().toString().replace("-", "") + UUID.randomUUID().toString().replace("-", "")

    fun reset(doc: SwissDocType) {
        id = newId()
        selected = doc
        startedAt = System.currentTimeMillis()
        front = null; back = null; mrz = null; frontTemplate = null
        classification = emptyList(); device = emptyList(); chip = null; chipSkippedReason = null
        face = null; resumeToken = newToken()
        chipSymbol.clear(); chipDecision = null; chipAttempts = 0; attestation = null; attestationJob = null
        telemetry.clear()
    }

    fun tel(side: Side) = telemetry.getOrPut(side) { SideTelemetry() }

    /** Waits for the background device attestation (started with the session). */
    fun awaitAttestation(timeoutMs: Long = 15000) {
        runCatching { attestationJob?.get(timeoutMs, java.util.concurrent.TimeUnit.MILLISECONDS) }
    }

    fun chipChecks(): List<Check> = chip?.checks ?: listOf(
        Check(
            Group.CHIP, null, "Chip read", Outcome.SKIPPED,
            chipSkippedReason ?: "not attempted", "standard ICAO 9303",
        ),
    )

    /** best chip-symbol evidence across both sides */
    fun bestSymbol(): Pair<Side, Double>? = chipSymbol.maxByOrNull { it.value }?.toPair()

    fun allChecks(): List<Check> =
        classification + (front?.checks ?: emptyList()) + (back?.checks ?: emptyList()) +
            ChipPolicy.checks(chipDecision, chip != null, chipSkippedReason, chipAttempts) + chipChecks() +
            (face?.checks ?: emptyList()) +
            device + (attestation?.checks ?: emptyList()) + Behaviour.checks(this)

    // ------------------------------------------------------------------ decision

    enum class Verdict(val title: String) { ACCEPTED("Verified"), REVIEW("Needs review"), REJECTED("Rejected") }

    enum class Assurance(val title: String, val detail: String) {
        HIGH("High", "chip signature verified"),
        SUBSTANTIAL("Substantial", "visual checks only — no chip evidence"),
        PENDING("Pending", "decided after manual review"),
        NONE("None", "evidence rejected"),
    }

    /**
     * Correlated signals must not stack linearly (a rooted phone trips root files, root apps and
     * verified boot at once), so weak-evidence groups are capped. Attack evidence is not.
     */
    val groupCap = mapOf(Group.DEVICE to 50, Group.BEHAVIOUR to 20, Group.QUALITY to 20)

    /** 0..100: fired risk points summed per group, each group capped, total capped. */
    fun riskScore(all: List<Check> = allChecks()): Int =
        all.groupBy { it.group }
            .map { (g, cs) -> cs.sumOf { it.points }.coerceAtMost(groupCap[g] ?: 100) }
            .sum().coerceIn(0, 100)

    fun drivers(all: List<Check> = allChecks()): List<Check> =
        all.filter { it.points > 0 }.sortedByDescending { it.points }

    fun chipVerified(): Boolean {
        val c = chip?.checks ?: return false
        return c.none { it.outcome == Outcome.FAIL } &&
            c.any { it.label.startsWith("SOD signature") && it.outcome == Outcome.PASS }
    }

    fun verdict(all: List<Check> = allChecks()): Verdict {
        // hard stops: attack evidence, wrong document, broken chip crypto, compromised channel
        if (all.any { it.outcome == Outcome.FAIL && it.group in setOf(Group.PAD, Group.CLASSIFICATION, Group.CHIP, Group.DEVICE) }) {
            return Verdict.REJECTED
        }
        // nothing to be confident about: no presentation-attack evidence was captured at all
        if (all.none { it.group == Group.PAD && it.outcome == Outcome.PASS }) return Verdict.REVIEW
        val score = riskScore(all)
        return when {
            score >= 60 -> Verdict.REJECTED
            score >= 25 -> Verdict.REVIEW
            else -> Verdict.ACCEPTED
        }
    }

    fun assurance(v: Verdict = verdict()): Assurance = when {
        v == Verdict.REJECTED -> Assurance.NONE
        v == Verdict.REVIEW -> Assurance.PENDING
        chipVerified() -> Assurance.HIGH
        else -> Assurance.SUBSTANTIAL
    }
}
