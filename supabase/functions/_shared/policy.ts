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
  /** Confidence-path step weights (must sum ~1). Final risk = weighted (1 − step confidence). */
  ladder: {
    weights: { device: 0.2, document: 0.25, chipOrAgent: 0.3, face: 0.25 },
  },
  face: {
    matchThreshold: 0.363, borderlineMargin: 0.07, searchThreshold: 0.5, samePersonThreshold: 0.5,
    burstThreshold: 0.5, livenessPass: 0.7, livenessFail: 0.2, // calibrated on Pixel 6 sessions: real users make small moves; the order, direction and identity checks carry the security
    gestureYaw: 0.12, gestureRoll: 6, gestureCloser: 1.15, gestureFurther: 0.87, actionSameFace: 0.4,
    weights: {
      noSelfie: 30, noFace: 40, multipleFaces: 40, livenessInconclusive: 35, livenessFail: 70, burstInconsistent: 50,
      faceBorderline: 40, faceMismatch: 70, portraitChipMismatch: 80, duplicateFace: 60, repeatAttempt: 30,
      portraitReused: 60, documentOtherFace: 80, gestureFailed: 70,
      faceSwapFail: 70, faceSwapWarn: 40, noActiveChallenge: 35, challengeInvalid: 80,
    },
    /** faceswap / deepfake service (services/faceswap): swap_score above fail → FAIL, above warn → WARN */
    swapFailFrom: 0.75,
    swapWarnFrom: 0.35,
  },
  /**
   * Randomized face actions, issued by the server at selfie time for every session (and again when an
   * analyst requests a re-verification). Unpredictable order = nothing can be recorded in advance; each action is
   * re-measured on the server. One head turn is always included: live face-swap models are trained on
   * frontal faces and lose tracking / blend seams first when the head turns.
   */
  faceChallenge: {
    steps: 3, ttlSeconds: 180,
    gestures: ["TURN_LEFT", "TURN_RIGHT", "TILT_LEFT", "TILT_RIGHT", "MOVE_CLOSER", "MOVE_FURTHER"],
    alwaysOneOf: ["TURN_LEFT", "TURN_RIGHT"],
  },
  activeLiveness: { steps: 3, gestures: ["TURN_LEFT", "TURN_RIGHT", "TILT_LEFT", "TILT_RIGHT", "MOVE_CLOSER", "MOVE_FURTHER"], ttlHours: 24 },
  routes: { LOW: "CONTINUE", MEDIUM: "MANUAL_REVIEW", HIGH: "BRANCH_VISIT" } as Record<string, string>,
};
