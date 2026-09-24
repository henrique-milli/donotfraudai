/**
 * The scored signals turned into what an L1 analyst reads first: a summary, a recommendation with a
 * confidence, and the reasons for not approving / not rejecting outright. Rule-based on purpose:
 * every sentence traces back to a signal, which is what an audit needs.
 */
import { fired, type Sig } from "./risk.ts";

type S = Pick<Sig, "grp" | "label" | "outcome" | "value" | "risk_points">;

export interface Explanation {
  summary: string; recommendation: string; recommendationText: string; confidence: number; whyNotApprove: string[]; whyNotReject: string[];
}

const passed = (s: S[], g: string) => { const x = s.filter((y) => y.grp === g && ["PASS", "FAIL", "WARN"].includes(y.outcome)); return x.length > 0 && x.every((y) => y.outcome === "PASS"); };
const facePass = (s: S[], start: string) => s.some((y) => y.grp === "FACE" && y.label.startsWith(start) && y.outcome === "PASS");

export function explain(signals: S[], level: string, score: number, chipVerified: boolean, chipExpected: string): Explanation {
  const f = signals.filter((s) => fired(s) && s.risk_points > 0).sort((a, b) => b.risk_points - a.risk_points);
  const fails = f.filter((s) => s.outcome === "FAIL");
  const pad = passed(signals, "PAD"), doc = passed(signals, "CLASSIFICATION"), cross = passed(signals, "CONSISTENCY");
  const good: string[] = [];
  if (pad) good.push("the card is a genuine physical document (no screen replay, print or photo tampering)");
  if (doc) good.push("the document is classified consistently on both sides");
  if (cross) good.push("the printed front agrees with the MRZ");
  if (chipVerified) good.push("the chip's issuer signature verifies");
  if (facePass(signals, "Face match") || facePass(signals, "Matches chip") || facePass(signals, "Matches ID")) good.push("the selfie matches the document photo");
  if (facePass(signals, "Passive liveness") || facePass(signals, "Active liveness")) good.push("the selfie comes from a live person");
  const bad = f.slice(0, 3).map((s) => `${s.label.toLowerCase()} (${s.value})`);
  let summary = good.length && bad.length ? `The session shows that ${good.join("; ")}. However, ${bad.join("; ")}.`
    : good.length ? `The session shows that ${good.join("; ")}. No risk signal fired.`
    : bad.length ? `Risk signals fired: ${bad.join("; ")}.` : "Not enough evidence was captured to assess this session.";
  if (chipExpected === "REQUIRED" && !chipVerified) summary += " The card carries a chip symbol but no chip evidence was obtained.";

  const whyNotApprove = f.slice(0, 4).map((s) => `${s.label}: ${s.value}`);
  if (!pad) whyNotApprove.push("No passing presentation-attack evidence");
  const whyNotReject: string[] = [];
  if (pad) whyNotReject.push("Physical card confirmed by the attack checks");
  if (doc) whyNotReject.push("Document classification consistent");
  if (chipVerified) whyNotReject.push("Chip signature verified");
  if (!signals.some((s) => s.label === "Previous fraud history" && fired(s))) whyNotReject.push("No prior fraud history");

  const groups = new Set(f.map((s) => s.grp));
  const faceFail = fails.filter((s) => s.grp === "FACE");
  let rec: string, text: string;
  if (faceFail.length) {
    rec = "REJECT"; text = `Face evidence is conclusive (${faceFail[0].label.toLowerCase()}: ${faceFail[0].value}). Reject.`;
  } else if ((fails.length && fails.some((s) => ["PAD", "CLASSIFICATION", "CHIP"].includes(s.grp))) || signals.some((s) => s.label === "Previous fraud history" && fired(s))) {
    rec = "REJECT"; text = "Attack or document evidence is conclusive. Reject and flag the document.";
  } else if (level === "HIGH" && [...groups].every((g) => ["DEVICE", "SERVER", "BEHAVIOUR"].includes(g))) {
    rec = "ESCALATE"; text = "The document looks genuine but the capture channel is not trusted. Escalate to a specialist.";
  } else if (level === "LOW") {
    rec = "APPROVE"; text = "All decisive checks passed. Approve.";
  } else {
    const faceDoubt = signals.some((s) => s.grp === "FACE" && fired(s) && s.risk_points);
    const target = chipExpected === "REQUIRED" && !chipVerified ? "a chip read" : faceDoubt ? "an active liveness check (random head gestures)" : "a second capture on a trusted device";
    rec = "REQUEST_VERIFICATION"; text = `Evidence is mixed. Request ${target} before deciding.`;
  }
  const edge = Math.min(Math.abs(score - 25), Math.abs(score - 60));
  let conf = 0.55 + Math.min(0.35, edge / 100) + (chipVerified ? 0.05 : 0) - (f.length > 4 ? 0.05 : 0);
  if (fails.length) conf = Math.max(conf, 0.85);
  return { summary, recommendation: rec, recommendationText: text, confidence: Math.round(Math.min(conf, 0.97) * 100) / 100,
    whyNotApprove: whyNotApprove.slice(0, 5), whyNotReject: whyNotReject.slice(0, 5) };
}
