/** Risk policy (was attest.yml). Values here are policy, not code. */
export const policy = {
  challenge: { ttlSeconds: 900, requireServerIssued: false },
  attestation: {
    googleRootsPem: "",                     // PEM bundle of Google attestation roots; empty = not pinned
    trustedAppPackages: ["ch.attest.onboarding"],
    trustedAppSigners: [] as string[],      // release signing cert SHA-256; empty = any (debug)
  },
  risk: {
    groupCaps: { DEVICE: 50, BEHAVIOUR: 20, QUALITY: 20 } as Record<string, number>,
    lowBelow: 25,
    highFrom: 60,
    hardStopGroups: ["PAD", "CLASSIFICATION", "CHIP", "DEVICE", "SERVER", "FACE"],
    server: {
      signatureInvalid: 80, chainBroken: 40, challengeUnknown: 20, challengeReplayed: 80, appUntrusted: 60,
      unsignedPayload: 25, documentPreviouslyRejected: 70, deviceManyIdentities: 40, deviceIdentityThreshold: 3,
    },
  },
  face: {
    matchThreshold: 0.363, borderlineMargin: 0.07, searchThreshold: 0.5, samePersonThreshold: 0.5,
    burstThreshold: 0.5, livenessPass: 0.7, livenessFail: 0.2, gestureYaw: 0.18, gestureRoll: 10,
    weights: {
      noSelfie: 30, noFace: 40, multipleFaces: 40, livenessInconclusive: 35, livenessFail: 70, burstInconsistent: 50,
      faceBorderline: 40, faceMismatch: 70, portraitChipMismatch: 80, duplicateFace: 60, repeatAttempt: 30,
      portraitReused: 60, documentOtherFace: 80, gestureFailed: 70,
    },
  },
  activeLiveness: { steps: 2, gestures: ["TURN_LEFT", "TURN_RIGHT", "TILT_LEFT", "TILT_RIGHT"], ttlHours: 24 },
  routes: { LOW: "CONTINUE", MEDIUM: "STEP_UP", HIGH: "MANUAL_REVIEW" } as Record<string, string>,
};
