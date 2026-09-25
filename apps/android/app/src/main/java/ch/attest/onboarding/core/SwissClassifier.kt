package ch.attest.onboarding.core

import java.text.Normalizer

/**
 * Swiss document classification.
 *
 * The ID template classifier has no Swiss classes, so the decision is made from evidence printed on
 * the document itself and cross-checked:
 *   1. the card title on the FRONT (OCR), in any of the national languages or English
 *   2. the MRZ on the BACK: issuing state must be CHE; an identity card is issued to a Swiss
 *      national (nationality CHE), a residence permit to a foreign national (nationality ≠ CHE)
 */
object SwissClassifier {

    enum class Kind { ID_CARD, RESIDENCE_PERMIT, UNKNOWN }

    private val idTitles = listOf(
        "IDENTITATSKARTE", "IDENTITAETSKARTE", "CARTEDIDENTITE", "CARTADIDENTITA",
        "CARTADIDENTITAD", "IDENTITYCARD",
    )
    private val permitTitles = listOf(
        "AUSLANDERAUSWEIS", "AUSLAENDERAUSWEIS", "TITREDESEJOUR", "PERMESSODISOGGIORNO",
        "PERMISSIUNDADIMORA", "RESIDENCEPERMIT", "LIVRETPOURETRANGERS",
    )
    private val swissMarks = listOf("SCHWEIZ", "SUISSE", "SVIZZERA", "SVIZRA", "SWITZERLAND", "CONFOEDERATIO")

    /** Upper-case, strip diacritics and everything that is not a letter, so OCR noise matters less. */
    fun squash(s: String): String =
        Normalizer.normalize(s, Normalizer.Form.NFD)
            .replace(Regex("\\p{M}+"), "")
            .uppercase()
            .filter { it in 'A'..'Z' }

    data class FrontEvidence(val kind: Kind, val matched: String?, val swissMark: String?)

    fun front(ocrLines: List<String>): FrontEvidence {
        val text = squash(ocrLines.joinToString(" "))
        val id = idTitles.firstOrNull { text.contains(it) }
        val permit = permitTitles.firstOrNull { text.contains(it) }
        val mark = swissMarks.firstOrNull { text.contains(it) }
        val kind = when {
            permit != null -> Kind.RESIDENCE_PERMIT // permit wording is specific; ID wording can appear on permits
            id != null -> Kind.ID_CARD
            else -> Kind.UNKNOWN
        }
        return FrontEvidence(kind, permit ?: id, mark)
    }

    fun mrzKind(m: Mrz): Kind = when {
        m.issuingState != "CHE" -> Kind.UNKNOWN
        m.nationality == "CHE" -> Kind.ID_CARD
        else -> Kind.RESIDENCE_PERMIT
    }

    /**
     * Which Swiss document the scan shows, when the evidence is clear: the front title and the MRZ
     * agree, or the MRZ is Swiss and the front title was not read. Null when unsure.
     */
    fun detectedType(frontOcr: List<String>, mrz: Mrz?): SwissDocType? {
        val f = front(frontOcr).kind
        val m = mrz?.let { mrzKind(it) } ?: Kind.UNKNOWN
        val k = when {
            f != Kind.UNKNOWN && m != Kind.UNKNOWN -> if (f == m) f else Kind.UNKNOWN
            m != Kind.UNKNOWN -> m
            else -> f
        }
        return when (k) {
            Kind.ID_CARD -> SwissDocType.CHE_ID
            Kind.RESIDENCE_PERMIT -> SwissDocType.CHE_RESIDENCE
            Kind.UNKNOWN -> null
        }
    }

    fun expected(doc: SwissDocType) = when (doc) {
        SwissDocType.CHE_ID -> Kind.ID_CARD
        SwissDocType.CHE_RESIDENCE -> Kind.RESIDENCE_PERMIT
        SwissDocType.ANY_TD1 -> Kind.UNKNOWN
    }

    fun label(k: Kind) = when (k) {
        Kind.ID_CARD -> "Swiss identity card"
        Kind.RESIDENCE_PERMIT -> "Swiss residence permit"
        Kind.UNKNOWN -> "not recognised"
    }

    fun classify(selected: SwissDocType, frontOcr: List<String>, mrz: Mrz?, nearestTemplate: String?): List<Check> {
        if (selected == SwissDocType.ANY_TD1) return classifyAny(mrz, nearestTemplate)
        val g = Group.CLASSIFICATION
        val out = ArrayList<Check>()
        val f = front(frontOcr)
        out += Check(
            g, Side.FRONT, "Card title (front OCR)",
            if (f.kind == Kind.UNKNOWN) Outcome.FAIL else Outcome.PASS,
            f.matched?.let { "${label(f.kind)} · \"$it\"" } ?: "no Swiss card title found",
            "title must read Identitätskarte / Ausländerausweis (any national language)", risk = 40,
            why = "The front does not carry a Swiss card title",
        )
        out += Check(
            g, Side.FRONT, "Swiss state marking",
            if (f.swissMark != null) Outcome.PASS else Outcome.INFO,
            f.swissMark ?: "not read",
            "Schweiz · Suisse · Svizzera · Svizra",
        )
        if (mrz == null) {
            out += Check(g, Side.BACK, "MRZ", Outcome.FAIL, "not read", "valid TD1 MRZ required", risk = 50,
                why = "The machine-readable zone could not be read")
            return out
        }
        out += Check(
            g, Side.BACK, "Issuing state (MRZ)",
            if (mrz.issuingState == "CHE") Outcome.PASS else Outcome.FAIL,
            mrz.issuingState, "must be CHE", risk = 60,
            why = "The card was not issued by Switzerland (${mrz.issuingState})",
        )
        out += Check(
            g, Side.BACK, "MRZ check digits",
            if (mrz.checks.all) Outcome.PASS else Outcome.FAIL,
            listOf(
                "doc" to mrz.checks.documentNumber, "dob" to mrz.checks.dateOfBirth,
                "exp" to mrz.checks.dateOfExpiry, "composite" to mrz.checks.composite,
            ).joinToString(" · ") { (k, v) -> "$k ${if (v) "✓" else "✗"}" },
            "ICAO 9303 weights 7-3-1", risk = 60,
            why = "MRZ check digits do not add up, a sign of an edited MRZ",
        )
        out += Check(
            g, Side.BACK, "MRZ document code",
            Outcome.INFO, mrz.documentCode, "recorded; verify code mapping against a reference card",
        )
        val m = mrzKind(mrz)
        out += Check(
            g, Side.BACK, "Holder nationality (MRZ)",
            if (m == Kind.UNKNOWN) Outcome.FAIL else Outcome.PASS,
            "${mrz.nationality} → ${label(m)}",
            "ID card: CHE national · residence permit: foreign national", risk = 40,
            why = "MRZ nationality does not fit a Swiss document",
        )
        val agree = f.kind != Kind.UNKNOWN && f.kind == m
        out += Check(
            g, null, "Front and back agree",
            if (agree) Outcome.PASS else Outcome.FAIL,
            "front: ${label(f.kind)} · back: ${label(m)}", "both sides must describe the same document", risk = 60,
            why = "Front and back describe different documents",
        )
        val exp = expected(selected)
        out += Check(
            g, null, "Matches selected document",
            if (m == exp) Outcome.PASS else Outcome.FAIL,
            "selected ${label(exp)}", "user selection must match the document presented", risk = 30,
            why = "The card presented is not the one the applicant selected",
        )
        out += Check(
            g, Side.FRONT, "ID template classifier",
            Outcome.INFO, nearestTemplate ?: "no known template ≥ 0.95",
            "no Swiss class in the model — shown as nearest template only",
        )
        return out
    }

    /** Rehearsal path for non-Swiss TD1 cards: only document-agnostic ICAO checks. */
    private fun classifyAny(mrz: Mrz?, nearestTemplate: String?): List<Check> {
        val g = Group.CLASSIFICATION
        if (mrz == null) {
            return listOf(Check(g, Side.BACK, "MRZ", Outcome.FAIL, "not read", "valid TD1 MRZ required", risk = 50,
                why = "The machine-readable zone could not be read"))
        }
        return listOf(
            Check(g, Side.BACK, "TD1 MRZ", Outcome.PASS, "${mrz.documentCode} · ${mrz.issuingState}", "3 × 30 characters"),
            Check(
                g, Side.BACK, "MRZ check digits",
                if (mrz.checks.all) Outcome.PASS else Outcome.FAIL,
                listOf("doc" to mrz.checks.documentNumber, "dob" to mrz.checks.dateOfBirth,
                    "exp" to mrz.checks.dateOfExpiry, "composite" to mrz.checks.composite,
                ).joinToString(" · ") { (k, v) -> "$k ${if (v) "✓" else "✗"}" },
                "ICAO 9303 weights 7-3-1", risk = 60, why = "MRZ check digits do not add up, a sign of an edited MRZ",
            ),
            Check(g, Side.BACK, "Issuing state (MRZ)", Outcome.INFO, mrz.issuingState, "rehearsal: any state accepted"),
            Check(g, Side.FRONT, "ID template classifier", Outcome.INFO, nearestTemplate ?: "no known template ≥ 0.95", "nearest known template"),
        )
    }

    // ------------------------------------------------------------------ cross-checks

    /** yyyymmdd as an Int, from an MRZ YYMMDD; birth dates roll back a century when in the future */
    fun ymd(yymmdd: String, birth: Boolean, todayYmd: Int): Int? {
        if (yymmdd.length != 6 || !yymmdd.all { it.isDigit() }) return null
        val yy = yymmdd.take(2).toInt()
        val nowYY = (todayYmd / 10000) % 100
        val century = if (birth && yy > nowYY) 1900 else 2000
        return (century + yy) * 10000 + yymmdd.substring(2).toInt()
    }

    /**
     * Does the card agree with itself? The printed front (visual zone) and the MRZ are produced by
     * the same personalisation step; a composed or edited card often gets one of them wrong.
     */
    fun crossChecks(frontOcr: List<String>, mrz: Mrz?, todayYmd: Int): List<Check> {
        val g = Group.CONSISTENCY
        if (mrz == null) return emptyList()
        val out = ArrayList<Check>()
        val frontAlnum = frontOcr.joinToString(" ").uppercase().filter { it.isLetterOrDigit() }
            .map { when (it) { 'O' -> '0'; 'I', 'L' -> '1'; else -> it } }.joinToString("")
        val docNo = mrz.documentNumber.uppercase().map { when (it) { 'O' -> '0'; 'I', 'L' -> '1'; else -> it } }.joinToString("")
        out += Check(
            g, Side.FRONT, "Document number on front",
            if (docNo.length >= 6 && frontAlnum.contains(docNo)) Outcome.PASS else Outcome.INFO,
            if (frontAlnum.contains(docNo)) "${mrz.documentNumber} = MRZ" else "not found by OCR",
            "front visual zone must repeat the MRZ number",
        )

        val dob = ymd(mrz.dateOfBirth, birth = true, todayYmd = todayYmd)
        if (dob != null) {
            val dd = "%02d".format(dob % 100); val mm = "%02d".format((dob / 100) % 100); val yyyy = "${dob / 10000}"
            val digits = frontOcr.joinToString(" ").filter { it.isDigit() }
            val found = digits.contains(dd + mm + yyyy)
            out += Check(
                g, Side.FRONT, "Birth date on front",
                if (found) Outcome.PASS else Outcome.INFO,
                if (found) "$dd.$mm.$yyyy = MRZ" else "not found by OCR", "front date must equal MRZ date",
            )
        }
        val surname = squash(mrz.surname)
        if (surname.length >= 2) {
            val found = squash(frontOcr.joinToString(" ")).contains(surname)
            out += Check(g, Side.FRONT, "Surname on front", if (found) Outcome.PASS else Outcome.INFO,
                if (found) "${mrz.surname} = MRZ" else "not found by OCR", "front name must equal MRZ name")
        }

        val exp = ymd(mrz.dateOfExpiry, birth = false, todayYmd = todayYmd)
        if (exp != null) {
            val valid = exp >= todayYmd
            out += Check(
                g, null, "Document valid",
                if (valid) Outcome.PASS else Outcome.WARN,
                "expires ${exp % 100}.${"%02d".format((exp / 100) % 100)}.${exp / 10000}", "expiry ≥ today", risk = 60,
                why = "The document has expired",
            )
        }
        if (dob != null) {
            val age = (todayYmd - dob) / 10000
            out += Check(
                g, null, "Holder of age",
                if (age >= 18) Outcome.PASS else Outcome.WARN,
                "$age years", "≥ 18 for a qualified signature", risk = 25,
                why = "The holder is under 18",
            )
        }
        return out
    }
}
