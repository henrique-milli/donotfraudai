package ch.attest.onboarding

import ch.attest.onboarding.core.FaceChallenge
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FaceChallengeTest {
    @Test
    fun offlineSequenceFollowsTheServerRules() {
        val seen = HashSet<String>()
        repeat(300) {
            val c = FaceChallenge.local()
            assertNull(c.id)
            assertEquals(3, c.steps.size)
            assertEquals(3, c.steps.toSet().size)
            assertTrue(c.steps.any { it.startsWith("TURN") })
            seen += c.steps.joinToString()
        }
        assertTrue("only ${seen.size} distinct sequences", seen.size > 40)
    }
}
