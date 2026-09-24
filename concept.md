# DoNotFraudAI

Identity solutions for the AI fraud era.

## Core thesis

In-person ID was never perfect. A calm person that looks like a decade's old photo is good enough. Society runs on **shallow identity assumptions**, that AI **scales**.

So to neutralize the AI fraud era treats, we don't need to do better than the clerk, just as good:

- Verify **PoH** (proof of human): Introduces labor in a hypothetical fraud operation.  
- Verify **PoU** (proof of uniqueness) disrupts further by requiring a new human for the next scam.

Even assuming documents can be forged, the residual risk looks like mule economics, not AI agent scalability.

## Confidence ladder

We do not run a fixed set. The user is guided one step at a time. After each step we score what we have, and we stop as soon as the confidence bar clears.

People who submit strong signals leave early. If the ladder is exhausted and the score is still short of auto-approval, the session drops to a lower tier — online human review, or a branch visit.

1. **Device.** We aggregate metrics that assess hardware reliability. That raises confidence that submitted photos and videos come from a real camera, not a compromised one.
2. **Document photos.** The user photographs the ID. We check quality, tampering, and overall reliability, then pick one of two alternatives:
   - **NFC chip (preferred).** If the ID has a chip, the user taps it. A valid chip proves they hold a real, untampered ID.
   - **Document agent (fallback).** If NFC is missing or fails, an agent runs extensive online lookups to raise confidence instead.
3. **Face scan with randomized challenges.** The user is asked to do something that cannot be filmed in advance (**PoH**). We check:
   - Tampering: live face-swap.
   - Face matches the document.
   - Biometric uniqueness: this face is not already enrolled under another identity (**PoU**).

