package ch.attest.onboarding.scan

import ch.digitaltrust.engine.CardSide
import ch.digitaltrust.engine.Finding
import ch.attest.onboarding.core.Check
import ch.attest.onboarding.core.Group
import ch.attest.onboarding.core.Outcome
import ch.attest.onboarding.core.Side

/** Maps the scanning engine's plain findings onto the app's signal model. */
fun Side.toCard(): CardSide = if (this == Side.FRONT) CardSide.FRONT else CardSide.BACK

fun Finding.toCheck(): Check = Check(
    group = Group.valueOf(group),
    side = side?.let { if (it == CardSide.FRONT) Side.FRONT else Side.BACK },
    label = label,
    outcome = Outcome.valueOf(outcome),
    value = value,
    rule = rule,
    risk = risk,
    why = why,
)

fun List<Finding>.toChecks(): List<Check> = map { it.toCheck() }
