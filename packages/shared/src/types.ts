// attest API (supabase/functions/attest): what the phone and the console exchange

/** The only thing the phone learns about its session: never the score or the reasons. */
export type AttestRoute = "CONTINUE" | "STEP_UP" | "MANUAL_REVIEW";
export type AttestLevel = "LOW" | "MEDIUM" | "HIGH";
export type AttestCaseStatus =
  | "AUTO_APPROVED"
  | "STEP_UP_REQUESTED"
  | "IN_TRIAGE"
  | "ESCALATED"
  | "APPROVED"
  | "REJECTED";
export type AttestAction = "APPROVE" | "REQUEST_VERIFICATION" | "ESCALATE" | "REJECT";
export type SignalGroup =
  | "PAD"
  | "FACE"
  | "CLASSIFICATION"
  | "CONSISTENCY"
  | "CHIP"
  | "DEVICE"
  | "SERVER"
  | "BEHAVIOUR"
  | "QUALITY";

/** POST /v1/sessions body: ECDH-ES-P256 + HKDF-SHA256 + AES-256-GCM over {payload, sig}. */
export interface SealedEnvelope {
  v: 1;
  alg: "ECDH-ES-P256+HKDF-SHA256+A256GCM";
  kid: string;
  session?: string;
  epk: string;
  iv: string;
  ct: string;
}

/** POST /v1/sessions/:id/next → what the phone must do next. */
export type NextAction =
  | { action: "NONE" }
  | { action: "ACTIVE_LIVENESS"; reverification: number; steps: ("TURN_LEFT" | "TURN_RIGHT" | "TILT_LEFT" | "TILT_RIGHT")[]; expiresAt: string };

export interface HealthStatus {
  service: string;
  ok: boolean;
  version?: string;
  time: string;
}
