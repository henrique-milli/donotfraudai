package ch.attest.onboarding.core

/**
 * ICAO 9303 TD1 (ID-1 card, 3 × 30) machine readable zone.
 *
 * Swiss identity cards and Swiss residence permits both carry a TD1 MRZ on the back.
 */
data class Mrz(
    val documentCode: String,
    val issuingState: String,
    val documentNumber: String,
    val dateOfBirth: String,   // YYMMDD
    val sex: String,
    val dateOfExpiry: String,  // YYMMDD
    val nationality: String,
    val surname: String,
    val givenNames: String,
    val lines: List<String>,
    val checks: CheckDigits,
) {
    data class CheckDigits(
        val documentNumber: Boolean,
        val dateOfBirth: Boolean,
        val dateOfExpiry: Boolean,
        val composite: Boolean,
    ) {
        val all: Boolean get() = documentNumber && dateOfBirth && dateOfExpiry && composite
    }

    /** Key material for BAC / PACE-MRZ: document number, date of birth, date of expiry. */
    val accessKey: Array<String> get() = arrayOf(documentNumber, dateOfBirth, dateOfExpiry)
}

object MrzParser {
    private const val LEN = 30
    private val weights = intArrayOf(7, 3, 1)

    fun checkDigit(s: String): Int {
        var sum = 0
        s.forEachIndexed { i, c ->
            val v = when (c) {
                in '0'..'9' -> c - '0'
                in 'A'..'Z' -> c - 'A' + 10
                else -> 0 // '<'
            }
            sum += v * weights[i % 3]
        }
        return sum % 10
    }

    private fun ok(field: String, digit: Char): Boolean = digit.isDigit() && checkDigit(field) == digit - '0'

    /** Characters OCR commonly confuses in fields that must be numeric. */
    private fun toDigits(s: String) = s.map {
        when (it) {
            'O', 'Q', 'D' -> '0'; 'I', 'L' -> '1'; 'Z' -> '2'; 'S' -> '5'; 'G' -> '6'; 'B' -> '8'; 'T' -> '7'
            else -> it
        }
    }.joinToString("")

    /** Normalises an OCR line to the MRZ alphabet [A-Z0-9<]. */
    fun normalise(raw: String): String =
        raw.uppercase()
            .replace(" ", "")
            .replace('«', '<').replace('‹', '<').replace('(', '<').replace('[', '<').replace('{', '<')
            .filter { it in 'A'..'Z' || it in '0'..'9' || it == '<' }

    /**
     * Finds a TD1 MRZ inside arbitrary OCR text lines: three consecutive candidate lines of ~30
     * characters from the MRZ alphabet. Returns the parse with the best check-digit score.
     */
    fun find(ocrLines: List<String>): Mrz? {
        val cand = ocrLines.map(::normalise).filter { it.length in 26..34 && it.count { c -> c == '<' } >= 2 }
        if (cand.size < 3) return null
        var best: Mrz? = null
        var bestScore = -1
        for (i in 0..cand.size - 3) {
            val m = parse(cand[i], cand[i + 1], cand[i + 2]) ?: continue
            val score = listOf(m.checks.documentNumber, m.checks.dateOfBirth, m.checks.dateOfExpiry, m.checks.composite).count { it }
            if (score > bestScore) { best = m; bestScore = score }
        }
        return best
    }

    fun parse(l1Raw: String, l2Raw: String, l3Raw: String): Mrz? {
        val l1 = l1Raw.padEnd(LEN, '<').take(LEN)
        val l3 = l3Raw.padEnd(LEN, '<').take(LEN)
        // line 2 is numeric-heavy: repair OCR confusions in the fixed numeric positions only
        val l2In = l2Raw.padEnd(LEN, '<').take(LEN)
        val l2 = buildString {
            append(toDigits(l2In.substring(0, 7)))   // DOB + check
            append(l2In[7])                           // sex
            append(toDigits(l2In.substring(8, 15)))  // expiry + check
            append(l2In.substring(15, 29))            // nationality + optional
            append(toDigits(l2In.substring(29, 30)))  // composite check
        }
        if (!l1[0].isLetter()) return null

        // document number may overflow into the optional field (ICAO 9303-5 §4.2.2)
        var docNumber = l1.substring(5, 14)
        var docCheck = l1[14]
        if (docCheck == '<') {
            val overflow = l1.substring(15).substringBefore('<')
            if (overflow.isNotEmpty()) {
                docNumber = (docNumber + overflow.dropLast(1))
                docCheck = overflow.last()
            }
        }
        val dob = l2.substring(0, 6)
        val exp = l2.substring(8, 14)
        val composite = l1.substring(5, 30) + l2.substring(0, 7) + l2.substring(8, 15) + l2.substring(18, 29)

        val names = l3.trimEnd('<').split("<<", limit = 2)
        return Mrz(
            documentCode = l1.substring(0, 2).trimEnd('<'),
            issuingState = l1.substring(2, 5).trimEnd('<'),
            documentNumber = docNumber.trimEnd('<'),
            dateOfBirth = dob,
            sex = l2[7].toString().replace("<", "X"),
            dateOfExpiry = exp,
            nationality = l2.substring(15, 18).trimEnd('<'),
            surname = names.getOrElse(0) { "" }.replace('<', ' ').trim(),
            givenNames = names.getOrElse(1) { "" }.replace('<', ' ').trim(),
            lines = listOf(l1, l2, l3),
            checks = Mrz.CheckDigits(
                documentNumber = ok(docNumber, docCheck),
                dateOfBirth = ok(dob, l2[6]),
                dateOfExpiry = ok(exp, l2[14]),
                composite = ok(composite, l2[29]),
            ),
        )
    }
}
