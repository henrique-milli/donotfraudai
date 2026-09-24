export type SessionStatus =
  | "pending"
  | "auto_pass"
  | "auto_fail"
  | "needs_review"
  | "approved"
  | "rejected";

export type EvidenceKind = "selfie" | "id_document" | "device_attestation";

export type ReviewDecision = "approve" | "reject" | "request_more";

export interface VerificationSession {
  id: string;
  subjectRef: string;
  purpose: "onboarding" | "account_recovery";
  status: SessionStatus;
  createdAt: string;
}

export interface Evidence {
  id: string;
  sessionId: string;
  kind: EvidenceKind;
  storagePath: string | null;
  meta: Record<string, unknown>;
}

export interface VisionAnalysis {
  livenessScore: number;
  deepfakeScore: number;
  injectionLikely: boolean;
  artifacts: string[];
  model: string;
}

export interface RiskScore {
  score: number;
  decision: "allow" | "review" | "deny";
  signals: Record<string, number | boolean | string>;
  model: string;
}

export interface HealthStatus {
  service: string;
  ok: boolean;
  version: string;
  time: string;
}
