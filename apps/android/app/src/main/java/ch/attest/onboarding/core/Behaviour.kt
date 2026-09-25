package ch.attest.onboarding.core

/**
 * Capture-behaviour signals. Derived from what happened while the applicant scanned — never shown
 * to them in production. Individually weak (hence small weights); they matter in combination, and
 * they are exactly the kind of signal that improves most with labelled internal data.
 */
object Behaviour {
    /** gyro RMS below this while scanning = the phone was not hand-held (rig, stand, emulator) */
    const val STILL_RMS = 0.004
    /** a person needs time to frame a card; a replayed or injected stream is ready at once */
    const val FAST_CAPTURE_S = 1.2

    fun checks(s: Session): List<Check> {
        val g = Group.BEHAVIOUR
        val tel = Side.values().mapNotNull { side -> s.telemetry[side]?.let { side to it } }
        if (tel.isEmpty()) return emptyList()
        val out = ArrayList<Check>()

        // hand-held micro-motion
        val withMotion = tel.filter { it.second.motionSamples > 20 && !it.second.gyroRms.isNaN() }
        if (withMotion.isEmpty()) {
            out += Check(g, null, "Hand-held micro-motion", Outcome.INFO, "no gyroscope data", "gyro RMS ≥ $STILL_RMS rad/s")
        } else {
            val rms = withMotion.map { it.second.gyroRms }.average()
            val still = rms < STILL_RMS
            out += Check(
                g, null, "Hand-held micro-motion",
                if (still) Outcome.WARN else Outcome.PASS,
                withMotion.joinToString(" · ") { (side, t) -> "${side.label} %.3f".format(t.gyroRms) } + " rad/s",
                "gyro RMS ≥ $STILL_RMS rad/s", risk = 10,
                why = "The phone was perfectly still during the scan, as on a rig or an emulator",
            )
        }

        // time to capture
        val times = tel.filter { !it.second.seconds.isNaN() }
        if (times.isNotEmpty()) {
            val fast = times.size == 2 && times.all { it.second.seconds < FAST_CAPTURE_S }
            out += Check(
                g, null, "Time to capture",
                if (fast) Outcome.WARN else Outcome.PASS,
                times.joinToString(" · ") { (side, t) -> "${side.label} %.1f s".format(t.seconds) },
                "≥ $FAST_CAPTURE_S s per side", risk = 8,
                why = "Both sides were captured faster than a person can frame a card",
            )
        }

        // guidance the applicant needed — a genuine user typically needs some
        val hints = LinkedHashMap<String, Int>()
        tel.forEach { (_, t) -> t.hints.forEach { (k, v) -> hints[k] = (hints[k] ?: 0) + v } }
        out += Check(
            g, null, "Guidance events",
            Outcome.INFO,
            if (hints.isEmpty()) "none" else hints.entries.sortedByDescending { it.value }.take(4).joinToString(" · ") { "${it.key} ${it.value}" },
            "recorded for model training",
        )
        out += Check(
            g, null, "Frames analysed",
            Outcome.INFO,
            tel.joinToString(" · ") { (side, t) -> "${side.label} ${t.frames}" },
            "every preview frame runs the quality gate",
        )
        val f = s.telemetry[Side.FRONT]; val b = s.telemetry[Side.BACK]
        if (f != null && b != null && f.capturedAt > 0 && b.capturedAt > 0) {
            out += Check(g, null, "Card flip", Outcome.INFO, "%.1f s front → back".format((b.capturedAt - f.capturedAt) / 1000.0), "recorded for model training")
        }
        return out
    }
}
