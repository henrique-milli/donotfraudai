/**
 * Document-agent fallback (stub). Concept: when NFC is missing/fails, an agent runs online
 * lookups to raise confidence. Real providers are TBD — this returns a ready-to-use metric
 * with the same shape other ladder steps consume.
 *
 * Swap `documentAgentAssess` for a real worker later; keep AgentMetric stable.
 */
export interface AgentInput {
  documentNumber: string;
  chipExpected: string;
  chipVerified: boolean;
  /** CHIP / CLASSIFICATION / CONSISTENCY signals already on the case */
  signals: { label: string; outcome: string; value: string }[];
}

export interface AgentMetric {
  /** 0..1 confidence that the document identity is reliable without a verified chip */
  confidence: number;
  summary: string;
  mode: "stub";
  lookups: string[];
}

/**
 * Stub metric: uses on-device classification/consistency already present; does not crawl.
 * Higher when MRZ/classification look coherent; lower when classification failed.
 */
export function documentAgentAssess(input: AgentInput): AgentMetric {
  const lookups = ["mrz_checksum_local", "classification_consistency_local"]; // placeholders for future providers
  const fail = input.signals.some((s) => s.outcome === "FAIL");
  const warn = input.signals.some((s) => s.outcome === "WARN");
  const passClass = input.signals.some((s) =>
    (s.label.toLowerCase().includes("classif") || s.label.toLowerCase().includes("mrz")) && s.outcome === "PASS"
  );
  let confidence = 0.55;
  if (passClass) confidence = 0.72;
  if (warn) confidence = Math.min(confidence, 0.48);
  if (fail) confidence = Math.min(confidence, 0.28);
  if (!input.documentNumber) confidence = Math.min(confidence, 0.4);
  const summary = fail
    ? "stub · document signals failed — agent cannot raise confidence"
    : passClass
    ? "stub · local MRZ/classification coherent (no online lookup yet)"
    : "stub · limited local evidence only";
  return { confidence, summary, mode: "stub", lookups };
}
