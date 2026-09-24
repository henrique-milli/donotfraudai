package ch.attest.onboarding.core

/**
 * Confidence-path ladder (mirrors supabase/functions/_shared/ladder.ts).
 * Maps raw [Check] groups → per-step confidence → one risk score for the presenter UI.
 */
object Ladder {

    data class Step(
        val id: String,
        val title: String,
        /** 0..1 */
        val confidence: Double,
        val outcome: Outcome,
        val summary: String,
        val weight: Double,
        val groups: List<Group>,
    )

    data class Result(
        val steps: List<Step>,
        /** Risk 0..100 (higher = worse) */
        val score: Int,
        val confidence: Double,
        val verdict: Session.Verdict,
    )

    private data class Spec(val id: String, val title: String, val groups: List<Group>, val weight: Double)

    private val SPECS = listOf(
        Spec("device", "Device", listOf(Group.DEVICE, Group.BEHAVIOUR), 0.20),
        Spec("document", "Document photos", listOf(Group.PAD, Group.CLASSIFICATION, Group.CONSISTENCY, Group.QUALITY), 0.25),
        Spec("chip_or_agent", "Chip / document agent", listOf(Group.CHIP), 0.30),
        Spec("face", "Face", listOf(Group.FACE), 0.25),
    )

    fun score(all: List<Check> = Session.allChecks()): Result {
        val steps = SPECS.map { spec -> step(spec, all) }
        val wSum = steps.sumOf { it.weight }
        val confidence = steps.sumOf { it.confidence * it.weight } / wSum
        var risk = (steps.sumOf { (1.0 - it.confidence) * 100.0 * (it.weight / wSum) }).toInt().coerceIn(0, 100)
        val hard = all.any { it.outcome == Outcome.FAIL && it.group in setOf(Group.PAD, Group.CLASSIFICATION, Group.CHIP, Group.DEVICE) }
        val padPass = all.any { it.group == Group.PAD && it.outcome == Outcome.PASS }
        if (hard) risk = maxOf(risk, 60)
        if (!padPass) risk = maxOf(risk, 25)
        val verdict = when {
            hard || risk >= 60 -> Session.Verdict.BRANCH
            risk >= 25 || !padPass -> Session.Verdict.REVIEW
            else -> Session.Verdict.ACCEPTED
        }
        return Result(steps, risk, confidence, verdict)
    }

    private fun step(spec: Spec, all: List<Check>): Step {
        val mine = all.filter { it.group in spec.groups }
        val hard = mine.any { it.outcome == Outcome.FAIL }
        val raw = mine.filter { it.fired }.groupBy { it.group }.entries
            .sumOf { (g, cs) -> cs.sumOf { it.points }.coerceAtMost(Session.groupCap[g] ?: 100) }
        var confidence = (1.0 - raw / 100.0).coerceIn(0.0, 1.0)
        if (hard) confidence = minOf(confidence, 0.15)

        val outcome: Outcome
        val summary: String
        if (spec.id == "chip_or_agent") {
            val chipPass = mine.any { it.label.startsWith("SOD signature") && it.outcome == Outcome.PASS } &&
                mine.none { it.outcome == Outcome.FAIL }
            when {
                chipPass -> {
                    confidence = maxOf(confidence, 0.9)
                    outcome = Outcome.PASS
                    summary = "NFC chip verified"
                }
                else -> {
                    // Local stub of document-agent metric (no online lookups)
                    val classOk = all.any { it.group == Group.CLASSIFICATION && it.outcome == Outcome.PASS }
                    confidence = when {
                        mine.any { it.outcome == Outcome.FAIL } -> 0.28
                        classOk -> 0.72
                        mine.any { it.fired } -> 0.48
                        else -> 0.55
                    }
                    outcome = if (confidence >= 0.7) Outcome.PASS else if (confidence >= 0.4) Outcome.WARN else Outcome.FAIL
                    summary = if (mine.any { it.outcome == Outcome.FAIL }) "Chip failed · agent stub (local only)"
                    else "No chip · agent stub (local MRZ/classification)"
                }
            }
        } else {
            outcome = when {
                hard -> Outcome.FAIL
                mine.any { it.outcome == Outcome.WARN } -> Outcome.WARN
                mine.any { it.outcome == Outcome.PASS } -> Outcome.PASS
                mine.isEmpty() -> Outcome.SKIPPED
                else -> Outcome.INFO
            }
            val top = mine.filter { it.fired }.maxByOrNull { it.points }
            summary = top?.let { "${it.label}: ${it.value}" }?.take(96)
                ?: if (mine.any { it.outcome == Outcome.PASS }) "Checks passed" else "No signals"
        }
        return Step(spec.id, spec.title, confidence, outcome, summary, spec.weight, spec.groups)
    }
}
