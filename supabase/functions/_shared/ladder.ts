/**
 * Confidence-path ladder: map raw signals → per-step confidence → one final risk score.
 *
 * Steps (concept.md):
 *   1. device          — hardware / capture-channel reliability
 *   2. document        — photo quality, PAD, classification
 *   3. chip_or_agent   — NFC chip preferred; document-agent stub when chip missing/fails
 *   4. face            — liveness, face-swap, 1:1 match, PoU
 *
 * Final risk score (0..100, higher = worse) drives existing routes via policy.risk thresholds.
 */
import { policy } from "./policy.ts";
import { documentAgentAssess, type AgentMetric } from "./document_agent.ts";
import { fired, type Sig } from "./risk.ts";

export type StepId = "device" | "document" | "chip_or_agent" | "face";

export interface StepScore {
  id: StepId;
  title: string;
  /** 0..1 — higher means more confidence this step is satisfied */
  confidence: number;
  /** Contribution to final risk after step weight (0..100 scale piece) */
  risk: number;
  outcome: "PASS" | "WARN" | "FAIL" | "SKIPPED" | "INFO";
  summary: string;
  signals: number;
  fired: number;
  /** Which signal groups fed this step */
  groups: string[];
  weight: number;
}

export interface LadderScore {
  steps: StepScore[];
  /** Final risk 0..100 (compatible with existing cases.risk_score) */
  score: number;
  /** Weighted mean of step confidences 0..1 */
  confidence: number;
  level: "LOW" | "MEDIUM" | "HIGH";
  route: string;
  agent?: AgentMetric;
}

const STEPS: { id: StepId; title: string; groups: string[]; weightKey: keyof typeof policy.ladder.weights }[] = [
  { id: "device", title: "Device", groups: ["DEVICE", "SERVER", "BEHAVIOUR"], weightKey: "device" },
  { id: "document", title: "Document photos", groups: ["PAD", "CLASSIFICATION", "CONSISTENCY", "QUALITY"], weightKey: "document" },
  { id: "chip_or_agent", title: "Chip / document agent", groups: ["CHIP"], weightKey: "chipOrAgent" },
  { id: "face", title: "Face", groups: ["FACE"], weightKey: "face" },
];

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

/** Per-step confidence from capped fired risk points in that step's groups. */
function stepFromSignals(
  id: StepId,
  title: string,
  groups: string[],
  weight: number,
  signals: Sig[],
  agent?: AgentMetric,
): StepScore {
  const mine = signals.filter((s) => groups.includes(s.grp));
  const hard = mine.some((s) => s.outcome === "FAIL" && policy.risk.hardStopGroups.includes(s.grp));
  const by: Record<string, number> = {};
  for (const s of mine) {
    if (!fired(s)) continue;
    by[s.grp] = (by[s.grp] ?? 0) + s.risk_points;
  }
  const raw = Object.entries(by).reduce((a, [g, p]) => a + Math.min(p, policy.risk.groupCaps[g] ?? 100), 0);
  const cap = 100;
  let confidence = clamp01(1 - raw / cap);
  if (hard) confidence = Math.min(confidence, 0.15);

  // Document-agent stub: when chip step has no verified PASS, blend in agent metric
  let summary = "";
  let outcome: StepScore["outcome"] = "PASS";
  if (id === "chip_or_agent") {
    const chipPass = mine.some((s) => s.label.startsWith("SOD signature") && s.outcome === "PASS") &&
      !mine.some((s) => s.outcome === "FAIL");
    const chipFail = mine.some((s) => s.outcome === "FAIL");
    const skipped = mine.every((s) => s.outcome === "SKIPPED" || s.outcome === "INFO") || mine.length === 0;
    if (chipPass) {
      confidence = Math.max(confidence, 0.9);
      summary = "NFC chip verified";
      outcome = "PASS";
    } else if (agent) {
      // blend: chip miss → agent confidence is the step confidence
      confidence = clamp01(agent.confidence);
      summary = `Document agent (${agent.mode}): ${agent.summary}`;
      outcome = agent.confidence >= 0.7 ? "PASS" : agent.confidence >= 0.4 ? "WARN" : "FAIL";
      if (chipFail) summary = `Chip failed · ${summary}`;
      else if (skipped) summary = `No chip · ${summary}`;
    } else {
      summary = chipFail ? "Chip checks failed" : skipped ? "Chip not read" : "Chip incomplete";
      outcome = hard ? "FAIL" : mine.some((s) => fired(s)) ? "WARN" : mine.length ? "INFO" : "SKIPPED";
    }
  } else {
    const worst = hard ? "FAIL" : mine.some((s) => s.outcome === "WARN") ? "WARN" : mine.some((s) => s.outcome === "PASS") ? "PASS" : mine.length ? "INFO" : "SKIPPED";
    outcome = worst;
    const top = mine.filter(fired).sort((a, b) => b.risk_points - a.risk_points)[0];
    summary = top ? `${top.label}: ${top.value}`.slice(0, 96) : mine.some((s) => s.outcome === "PASS") ? "Checks passed" : "No signals";
  }

  const risk = Math.round((1 - confidence) * 100 * weight);
  return {
    id, title, confidence: Math.round(confidence * 1000) / 1000, risk, outcome, summary,
    signals: mine.length, fired: mine.filter(fired).length, groups, weight,
  };
}

/**
 * Score the confidence path. Optionally pass chip context so the document-agent stub can run
 * when NFC is missing or failed.
 */
export function scoreLadder(
  signals: Sig[],
  opts: { chipVerified?: boolean; chipExpected?: string; documentNumber?: string } = {},
): LadderScore {
  const chipVerified = !!opts.chipVerified;
  const needAgent = !chipVerified;
  const agent = needAgent
    ? documentAgentAssess({
      documentNumber: opts.documentNumber ?? "",
      chipExpected: opts.chipExpected ?? "",
      chipVerified,
      signals: signals.filter((s) => s.grp === "CHIP" || s.grp === "CLASSIFICATION" || s.grp === "CONSISTENCY"),
    })
    : undefined;

  const weights = policy.ladder.weights;
  const steps = STEPS.map((s) =>
    stepFromSignals(s.id, s.title, s.groups, weights[s.weightKey], signals, s.id === "chip_or_agent" ? agent : undefined),
  );

  const wSum = steps.reduce((a, s) => a + s.weight, 0) || 1;
  const confidence = steps.reduce((a, s) => a + s.confidence * s.weight, 0) / wSum;
  // Final risk: weighted (1 - step confidence), plus hard-stop floor
  let score = Math.round(steps.reduce((a, s) => a + (1 - s.confidence) * 100 * (s.weight / wSum), 0));
  const hard = signals.some((s) => s.outcome === "FAIL" && policy.risk.hardStopGroups.includes(s.grp));
  const padPass = signals.some((s) => s.grp === "PAD" && s.outcome === "PASS");
  if (hard) score = Math.max(score, policy.risk.highFrom);
  if (!padPass) score = Math.max(score, policy.risk.lowBelow);
  score = Math.min(100, score);

  const r = policy.risk;
  const level = (hard || score >= r.highFrom ? "HIGH" : (score >= r.lowBelow || !padPass) ? "MEDIUM" : "LOW") as LadderScore["level"];
  return {
    steps,
    score,
    confidence: Math.round(confidence * 1000) / 1000,
    level,
    route: policy.routes[level],
    agent,
  };
}
