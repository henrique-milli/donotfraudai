package ch.attest.onboarding

import ch.attest.onboarding.core.Check
import ch.attest.onboarding.core.ChipPolicy
import ch.attest.onboarding.core.Envelope
import ch.attest.onboarding.core.Group
import ch.attest.onboarding.core.Outcome
import ch.attest.onboarding.core.Session
import ch.attest.onboarding.core.Side
import ch.attest.onboarding.core.SwissDocType
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.security.KeyPairGenerator
import java.security.spec.ECGenParameterSpec

class AttestationAndEnvelopeTest {

    private fun hex(s: String) = s.chunked(2).map { it.toInt(16).toByte() }.toByteArray()

    @Test
    fun hkdf_matchesRfc5869TestCase1() {
        val okm = Envelope.hkdf(
            ikm = ByteArray(22) { 0x0b },
            salt = hex("000102030405060708090a0b0c"),
            info = hex("f0f1f2f3f4f5f6f7f8f9"),
            len = 42,
        )
        assertArrayEquals(hex("3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865"), okm)
    }

    private val backend = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()

    @Test
    fun envelope_roundTripsAndIsFreshEachTime() {
        val msg = """{"session":"ABC","signals":[1,2,3]}""".toByteArray()
        val a = Envelope.seal(msg, backend.public, "k1")
        val b = Envelope.seal(msg, backend.public, "k1")
        assertArrayEquals(msg, Envelope.open(a, backend.private))
        assertFalse("ephemeral key must differ per payload", a.epk.contentEquals(b.epk))
        assertFalse(a.ct.contentEquals(b.ct))
        assertEquals(msg.size + 16, a.ct.size) // GCM tag
    }

    @Test
    fun envelope_rejectsTamperingWrongKidAndWrongKey() {
        val s = Envelope.seal("risk=0".toByteArray(), backend.public, "k1")
        val flipped = s.ct.copyOf().also { it[0] = (it[0].toInt() xor 1).toByte() }
        expectFailure { Envelope.open(Envelope.Sealed("k1", s.epk, s.iv, flipped), backend.private) }
        expectFailure { Envelope.open(Envelope.Sealed("k2", s.epk, s.iv, s.ct), backend.private) } // AAD binds the kid
        val other = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()
        expectFailure { Envelope.open(s, other.private) }
    }

    private fun expectFailure(block: () -> Unit) {
        try { block(); fail("expected decryption to fail") } catch (e: Exception) { /* AEADBadTagException */ }
    }

    @Test
    fun chipPolicy_enforcesOnlyWithSymbolAndNfc() {
        val symbolNfc = ChipPolicy.decide(SwissDocType.CHE_ID, 0.82, Side.BACK, hasNfc = true, nfcOn = true)
        assertEquals(ChipPolicy.Expectation.REQUIRED, symbolNfc.expectation)
        assertTrue(symbolNfc.enforced)

        val symbolNoNfc = ChipPolicy.decide(SwissDocType.CHE_ID, 0.82, Side.BACK, hasNfc = false, nfcOn = false)
        assertFalse("cannot enforce what the phone cannot read", symbolNoNfc.enforced)

        val legacy = ChipPolicy.decide(SwissDocType.CHE_ID, 0.20, Side.FRONT, hasNfc = true, nfcOn = true)
        assertEquals(ChipPolicy.Expectation.UNKNOWN, legacy.expectation)
        assertFalse(legacy.enforced)
    }

    @Test
    fun chipPolicy_scoresTheDowngrade() {
        val d = ChipPolicy.decide(SwissDocType.CHE_ID, 0.9, Side.BACK, hasNfc = true, nfcOn = true)
        val skipped = ChipPolicy.checks(d, chipRead = false, skippedReason = "gave up", attempts = 3)
        val enforcement = skipped.first { it.label == "Chip enforcement" }
        assertEquals(Outcome.WARN, enforcement.outcome)
        assertEquals(45, enforcement.points)
        // chipped card, chip not read → never auto-accepted
        val pad = Check(Group.PAD, Side.FRONT, "Physical document", Outcome.PASS, "", "")
        assertNotEquals(Session.Verdict.ACCEPTED, Session.verdict(skipped + pad))

        val read = ChipPolicy.checks(d, chipRead = true, skippedReason = null, attempts = 1)
        assertEquals(Outcome.PASS, read.first { it.label == "Chip enforcement" }.outcome)

        val noNfc = ChipPolicy.decide(SwissDocType.CHE_ID, 0.9, Side.BACK, hasNfc = false, nfcOn = false)
        assertEquals(15, ChipPolicy.checks(noNfc, false, null, 0).first { it.label == "Chip enforcement" }.points)
    }

    @Test
    fun correlatedDeviceSignals_areCapped() {
        // rooted phone: root files + root app + unlocked bootloader all fire
        val rooted = listOf(
            Check(Group.DEVICE, null, "Root access", Outcome.WARN, "", "", 20),
            Check(Group.DEVICE, null, "Risk apps installed", Outcome.WARN, "", "", 15),
            Check(Group.DEVICE, null, "Verified boot", Outcome.WARN, "", "", 35),
        )
        assertEquals(50, Session.riskScore(rooted))
        val pad = Check(Group.PAD, Side.FRONT, "Physical document", Outcome.PASS, "", "")
        assertEquals(Session.Verdict.REVIEW, Session.verdict(rooted + pad))
    }
}
