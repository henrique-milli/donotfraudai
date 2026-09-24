package ch.attest.onboarding.core

/**
 * Does this document have a chip, and must the holder use it?
 *
 * The downgrade attack: when the strong (chip) path is optional, fraud takes the weak (visual)
 * path. So whenever there is evidence the card is chipped AND the phone can read it, the chip is
 * enforced: no skip. Evidence, strongest first:
 *   1. the ICAO chip symbol printed on the card (Doc 9303 Part 9 makes it mandatory on eMRTDs)
 *   2. issuer policy for the document type (server-configurable in production)
 * A successful tap is proof regardless of the prediction.
 */
object ChipPolicy {

    enum class Expectation(val label: String) {
        REQUIRED("chip expected"),
        UNKNOWN("chip unknown"),
    }

    /**
     * Issuer rules per document type. Deliberately conservative: only facts we are sure of are
     * encoded, everything else falls back to the printed symbol. Production pulls this table from
     * the backend so it can change without an app release.
     */
    private val issuerRule: Map<SwissDocType, Expectation> = mapOf(
        // legacy and new-design Swiss ID cards both circulate; only the chipped variant carries the symbol
        SwissDocType.CHE_ID to Expectation.UNKNOWN,
        // permit generations differ; rely on the symbol
        SwissDocType.CHE_RESIDENCE to Expectation.UNKNOWN,
        SwissDocType.ANY_TD1 to Expectation.UNKNOWN,
    )

    data class Decision(
        val expectation: Expectation,
        val reason: String,
        val phoneCanRead: Boolean,
        val phoneNfcOn: Boolean,
    ) {
        /** chip must be read before the session can be accepted */
        val enforced get() = expectation == Expectation.REQUIRED && phoneCanRead
    }

    fun decide(doc: SwissDocType, symbolConfidence: Double?, symbolSide: Side?, hasNfc: Boolean, nfcOn: Boolean): Decision {
        val symbol = symbolConfidence != null && symbolConfidence >= SYMBOL_THRESHOLD
        val rule = issuerRule[doc] ?: Expectation.UNKNOWN
        val (exp, reason) = when {
            symbol -> Expectation.REQUIRED to "ICAO chip symbol on the ${symbolSide?.label ?: "card"} (%.2f)".format(symbolConfidence)
            rule == Expectation.REQUIRED -> Expectation.REQUIRED to "issuer policy for ${doc.title}"
            else -> Expectation.UNKNOWN to "no chip symbol found (best %.2f)".format(symbolConfidence ?: 0.0)
        }
        return Decision(exp, reason, hasNfc, nfcOn)
    }

    const val SYMBOL_THRESHOLD = 0.25   // = scan.ChipSymbol.THRESHOLD

    /** Signals describing the decision and what happened, for the report and the backend. */
    fun checks(d: Decision?, chipRead: Boolean, skippedReason: String?, attempts: Int): List<Check> {
        if (d == null) return emptyList()
        val g = Group.CHIP
        val out = ArrayList<Check>()
        out += Check(g, null, "Chip expected", Outcome.INFO, "${d.expectation.label} · ${d.reason}", "symbol → enforce chip")
        out += Check(g, null, "Phone NFC", Outcome.INFO,
            if (!d.phoneCanRead) "no NFC reader" else if (d.phoneNfcOn) "available" else "reader off", "recorded")
        if (d.expectation == Expectation.REQUIRED && !chipRead) {
            if (!d.phoneCanRead) {
                out += Check(g, null, "Chip enforcement", Outcome.WARN, "chip expected, this phone cannot read it",
                    "chipped card on NFC phone → chip mandatory", risk = 15,
                    why = "The card has a chip but this phone cannot read it: visual evidence only")
            } else {
                out += Check(g, null, "Chip enforcement", Outcome.WARN,
                    "chip expected, not read after $attempts attempt(s)" + (skippedReason?.let { " · $it" } ?: ""),
                    "chipped card on NFC phone → chip mandatory", risk = 45,
                    why = "The card has a chip but it was not read: possible downgrade to the weaker visual path")
            }
        } else if (d.expectation == Expectation.REQUIRED) {
            out += Check(g, null, "Chip enforcement", Outcome.PASS, "chip expected and read", "chipped card on NFC phone → chip mandatory")
        }
        return out
    }
}
