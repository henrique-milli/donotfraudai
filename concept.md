# DoNotFraudAI

Neutralizing AI Fraud Era Threats.

## Core thesis

In-person ID was never perfect. A calm person that looks like a decade's old photo is good enough. Society runs on **shallow identity assumptions**, that AI **scales**.

So to neutralize the AI fraud era treats, we don't need to do better than the clerk, just as good:

- Verify **PoH** (proof of human): Introduces labor in a hypothetical fraud operation.  
- Verify **PoU** (proof of uniqueness) disrupts further by requiring a new human for the next scam.

Even assuming documents can be forged, the residual risk looks like mule economics, not AI agent scalability.

## Confidence path

Capture runs as a **fixed sequence**. There is no mid-process exit: the applicant completes the steps, the phone seals the session, and the server **scores once**.

There is **no hard auto-denial**. Auto-reject is a grey zone — when confidence is too low for remote approval, we invite the applicant to a branch instead of an unappealable refusal.

| Confidence | Server route | Outcome |
| --- | --- | --- |
| **High** | `CONTINUE` | Auto-approve; skips human-in-the-loop |
| **Medium** | `MANUAL_REVIEW` | Online human review (triage) |
| **Low** | `BRANCH_VISIT` | Polite invite to the nearest branch (annoying, but appealable) |

Analysts may still reject after review. The phone never learns scores or reasons — only the route.

1. **Device.** We aggregate metrics that assess hardware reliability. That raises confidence that submitted photos and videos come from a real camera, not a compromised one.
2. **Document photos.** The user photographs the ID. We check quality, tampering, and overall reliability, then pick one of two alternatives:
  - **NFC chip (preferred).** If the ID has a chip, the user taps it. A valid chip proves they hold a real, untampered ID.
  - **Document agent (fallback).** If NFC is missing or fails, an agent runs extensive online lookups to raise confidence instead.
3. **Face scan.** The user takes a live selfie and then performs 3 randomized actions the server issues at that moment (always one head turn), something that cannot be filmed in advance (**PoH**). An analyst can request a second, new sequence. We check:
  - Tampering: live face-swap / deepfake injection.
  - Face matches the document.
  - Biometric uniqueness: this face is not already enrolled under another identity (**PoU**).
