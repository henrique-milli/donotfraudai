package ch.attest.onboarding

import ch.attest.onboarding.core.Check
import ch.attest.onboarding.core.Group
import ch.attest.onboarding.core.MrzParser
import ch.attest.onboarding.core.Outcome
import ch.attest.onboarding.core.Session
import ch.attest.onboarding.core.SwissClassifier
import ch.attest.onboarding.core.SwissDocType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MrzAndClassifierTest {

    // ICAO Doc 9303 Part 5, TD1 specimen (fictional state UTO)
    private val specimen = listOf(
        "I<UTOD231458907<<<<<<<<<<<<<<<",
        "7408122F1204159UTO<<<<<<<<<<<6",
        "ERIKSSON<<ANNA<MARIA<<<<<<<<<<",
    )

    @Test
    fun icaoSpecimen_parsesWithAllCheckDigitsValid() {
        val m = MrzParser.parse(specimen[0], specimen[1], specimen[2])!!
        assertEquals("I", m.documentCode)
        assertEquals("UTO", m.issuingState)
        assertEquals("D23145890", m.documentNumber)
        assertEquals("740812", m.dateOfBirth)
        assertEquals("120415", m.dateOfExpiry)
        assertEquals("F", m.sex)
        assertEquals("UTO", m.nationality)
        assertEquals("ERIKSSON", m.surname)
        assertEquals("ANNA MARIA", m.givenNames)
        assertTrue("all four check digits must validate", m.checks.all)
    }

    @Test
    fun corruptedDigit_isCaughtByCheckDigits() {
        val bad = specimen[1].replaceRange(2, 3, "9") // alter DOB month
        val m = MrzParser.parse(specimen[0], bad, specimen[2])!!
        assertFalse(m.checks.dateOfBirth)
        assertFalse(m.checks.composite)
    }

    @Test
    fun ocrNoise_isRepairedInNumericFields() {
        // OCR reads 0→O, 1→I, 5→S, '<'→'«' and inserts spaces
        val noisy = listOf(
            "Some text above the MRZ",
            "I«UTOD23145890 7<<<<<<<<<<<<<<<",
            "74O8I22F I2O4IS9UTO<<<<<<<<<<<6",
            "ERIKSSON<<ANNA<MARIA<<<<<<<<<<",
        )
        val m = MrzParser.find(noisy)
        assertNotNull(m)
        assertEquals("740812", m!!.dateOfBirth)
        assertEquals("120415", m.dateOfExpiry)
        assertTrue(m.checks.all)
    }

    @Test
    fun frontTitle_classifiesInAnyNationalLanguageWithOcrDiacriticLoss() {
        assertEquals(SwissClassifier.Kind.ID_CARD, SwissClassifier.front(listOf("SCHWEIZ SUISSE SVIZZERA", "IDENTITATSKARTE CARTE D'IDENTITE")).kind)
        assertEquals(SwissClassifier.Kind.ID_CARD, SwissClassifier.front(listOf("Carta d'identità")).kind)
        assertEquals(SwissClassifier.Kind.RESIDENCE_PERMIT, SwissClassifier.front(listOf("AUSLÄNDERAUSWEIS", "Titre de séjour")).kind)
        assertEquals(SwissClassifier.Kind.UNKNOWN, SwissClassifier.front(listOf("BUNDESREPUBLIK DEUTSCHLAND", "PERSONALAUSWEIS")).kind)
    }

    private fun swissMrz(nationality: String) = MrzParser.parse(
        "IDCHEA1234567<5<<<<<<<<<<<<<<<".let { l ->
            // recompute doc number check digit so the fixture is internally valid
            val d = MrzParser.checkDigit(l.substring(5, 14)); l.replaceRange(14, 15, d.toString())
        },
        "9001014F3001012${nationality}<<<<<<<<<<<0",
        "MUSTER<<ANNA<<<<<<<<<<<<<<<<<<",
    )!!

    @Test
    fun mrzNationality_separatesIdCardFromResidencePermit() {
        assertEquals(SwissClassifier.Kind.ID_CARD, SwissClassifier.mrzKind(swissMrz("CHE")))
        assertEquals(SwissClassifier.Kind.RESIDENCE_PERMIT, SwissClassifier.mrzKind(swissMrz("DEU")))
    }

    @Test
    fun frontBackDisagreement_failsClassification() {
        val checks = SwissClassifier.classify(
            SwissDocType.CHE_ID,
            frontOcr = listOf("AUSLÄNDERAUSWEIS"),  // front says residence permit
            mrz = swissMrz("CHE"),                  // back says Swiss national (ID card)
            nearestTemplate = null,
        )
        assertEquals(Outcome.FAIL, checks.first { it.label == "Front and back agree" }.outcome)
    }

    @Test
    fun consistentSwissId_passesClassification() {
        val checks = SwissClassifier.classify(SwissDocType.CHE_ID, listOf("SCHWEIZ", "IDENTITÄTSKARTE"), swissMrz("CHE"), null)
        assertEquals(Outcome.PASS, checks.first { it.label == "Front and back agree" }.outcome)
        assertEquals(Outcome.PASS, checks.first { it.label == "Matches selected document" }.outcome)
        assertEquals(Outcome.PASS, checks.first { it.label == "Issuing state (MRZ)" }.outcome)
    }

    @Test
    fun crossChecks_findFrontFieldsAndFlagExpiry() {
        val m = swissMrz("CHE") // doc A1234567, born 01.01.1990, expires 01.01.2030
        val front = listOf("IDENTITÄTSKARTE", "MUSTER", "Anna", "A1234567", "01 01 1990")
        val ok = SwissClassifier.crossChecks(front, m, todayYmd = 20260924)
        assertEquals(Outcome.PASS, ok.first { it.label == "Document number on front" }.outcome)
        assertEquals(Outcome.PASS, ok.first { it.label == "Birth date on front" }.outcome)
        assertEquals(Outcome.PASS, ok.first { it.label == "Surname on front" }.outcome)
        assertEquals(Outcome.PASS, ok.first { it.label == "Document valid" }.outcome)
        assertEquals("36 years", ok.first { it.label == "Holder of age" }.value)

        val expired = SwissClassifier.crossChecks(front, m, todayYmd = 20310101)
        assertEquals(Outcome.WARN, expired.first { it.label == "Document valid" }.outcome)
        // OCR missing a field is information, never a risk on its own
        val blind = SwissClassifier.crossChecks(emptyList(), m, todayYmd = 20260924)
        assertTrue(blind.filter { it.label.endsWith("on front") }.all { it.outcome == Outcome.INFO && it.points == 0 })
    }

    private fun chk(g: Group, o: Outcome, risk: Int) = Check(g, null, "x", o, "", "", risk)

    @Test
    fun risk_scoresFiredSignalsAndHardStopsOnAttackEvidence() {
        val clean = listOf(chk(Group.PAD, Outcome.PASS, 70), chk(Group.BEHAVIOUR, Outcome.PASS, 10))
        assertEquals(0, Session.riskScore(clean))
        assertEquals(Session.Verdict.ACCEPTED, Session.verdict(clean))

        val soft = listOf(chk(Group.BEHAVIOUR, Outcome.WARN, 10), chk(Group.DEVICE, Outcome.WARN, 20))
        assertEquals(30, Session.riskScore(soft))
        assertEquals(Session.Verdict.REVIEW, Session.verdict(soft))

        // one screen-replay signal is enough, whatever the score
        val replay = listOf(chk(Group.PAD, Outcome.FAIL, 5))
        assertEquals(Session.Verdict.REJECTED, Session.verdict(replay))

        // no captured evidence is never "verified"
        assertEquals(Session.Verdict.REVIEW, Session.verdict(emptyList()))

        assertEquals(100, Session.riskScore(List(5) { chk(Group.CONSISTENCY, Outcome.WARN, 60) }))
    }

    @Test
    fun detectedType_findsThePermitWhenTheIdWasSelected() {
        // the card tested on stage: French permit title on the front, foreign national in the MRZ
        assertEquals(SwissDocType.CHE_RESIDENCE, SwissClassifier.detectedType(listOf("TITRE DE SEJOUR"), swissMrz("UGA")))
        assertEquals(SwissDocType.CHE_ID, SwissClassifier.detectedType(listOf("IDENTITÄTSKARTE"), swissMrz("CHE")))
        // MRZ only (front title unreadable) is enough; front and MRZ disagreeing is not
        assertEquals(SwissDocType.CHE_RESIDENCE, SwissClassifier.detectedType(emptyList(), swissMrz("DEU")))
        assertEquals(null, SwissClassifier.detectedType(listOf("AUSLÄNDERAUSWEIS"), swissMrz("CHE")))
    }
}
