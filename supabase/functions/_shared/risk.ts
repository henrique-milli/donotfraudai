/**
 * Server risk engine. The phone's own score is advisory; the backend re-scores every session from
 * the raw signals plus what only the server can know (verification results, history).
 *   score = sum over groups of min(sum of fired risk points in group, group cap), capped at 100
 *   level = LOW < 25 <= MEDIUM < 60 <= HIGH;  any FAIL in a hard-stop group -> HIGH
 *   route = LOW -> CONTINUE, MEDIUM -> STEP_UP, HIGH -> MANUAL_REVIEW
 */
import { policy } from "./policy.ts";
import type { Verification } from "./attestation.ts";

export interface Sig { grp: string; label: string; outcome: string; value: string; rule: string; risk_points: number; side: string; source: string }

export const sig = (grp: string, label: string, outcome: string, value: string, rule: string, risk = 0, side = "", source = "SERVER"): Sig =>
  ({ grp, label, outcome, value, rule, risk_points: risk, side, source });
export const fired = (s: { outcome: string }) => s.outcome === "FAIL" || s.outcome === "WARN";

export function serverSignals(v: Verification, history: { documentRejected: boolean; deviceIdentities: number }): Sig[] {
  const w = policy.risk.server;
  const out: Sig[] = [];
  const g = "SERVER";
  if (!v.signed) {
    // no attested key = the device could not prove itself: counts under the DEVICE cap
    out.push(sig("DEVICE", "Payload signature", "WARN", "unsigned (no hardware-attested key)", "signed by attested key", w.unsignedPayload));
  } else {
    out.push(sig(g, "Payload signature", v.signatureOk ? "PASS" : "FAIL", v.signatureOk ? "valid · ECDSA P-256 by attested key" : "INVALID signature",
      "signed by attested key", w.signatureInvalid));
  }
  if (v.chainOk !== null) out.push(sig(g, "Attestation chain", v.chainOk ? "PASS" : "FAIL", v.chainOk ? "intact" : "broken", "each cert signed by the next", w.chainBroken));
  out.push(sig(g, "Google root pinned", v.rootPinned === null ? "INFO" : v.rootPinned ? "PASS" : "WARN",
    v.rootPinned === null ? "roots not configured" : v.rootPinned ? "pinned root" : "unknown root", "policy.attestation.googleRootsPem", w.chainBroken));
  const st: Record<string, string> = { "server-issued": "PASS", local: "INFO", replayed: "FAIL", mismatch: "FAIL", expired: "WARN", absent: "INFO" };
  const pts = ["replayed", "mismatch"].includes(v.challengeStatus) ? w.challengeReplayed : w.challengeUnknown;
  out.push(sig(g, "Attestation challenge", v.challengeOk === false && v.challengeStatus === "local" ? "FAIL" : st[v.challengeStatus],
    v.challengeStatus, "issued by this backend, single use", pts));
  if (v.appOk !== null && v.key) {
    out.push(sig(g, "Attested app identity", v.appOk ? "PASS" : "FAIL", `${v.key.appPackage} · signer ${(v.key.appSigners[0] ?? "?").slice(0, 12)}…`,
      "trusted package + signer", w.appUntrusted));
  }
  if (v.key) {
    out.push(sig(g, "Secure hardware (server)", v.key.securityLevel !== "Software" ? "PASS" : "WARN",
      `${v.key.securityLevel} · boot ${v.key.verifiedBoot} · ${v.key.deviceLocked ? "locked" : "unlocked"}`, "re-parsed from the certificate, not the payload"));
  }
  out.push(sig(g, "Previous fraud history", history.documentRejected ? "FAIL" : "PASS",
    history.documentRejected ? "document previously rejected" : "no prior rejection for this document", "document number across all cases", w.documentPreviouslyRejected));
  const n = history.deviceIdentities, thr = w.deviceIdentityThreshold;
  out.push(sig(g, "Device reuse", n >= thr ? "WARN" : "PASS", `${n} distinct document(s) from this device`, `< ${thr} identities per attested device`, w.deviceManyIdentities));
  return out;
}

export function score(signals: { grp: string; outcome: string; risk_points: number }[]): { score: number; level: string; route: string } {
  const r = policy.risk;
  const by: Record<string, number> = {};
  for (const s of signals) if (fired(s)) by[s.grp] = (by[s.grp] ?? 0) + s.risk_points;
  const total = Math.min(100, Object.entries(by).reduce((a, [g, p]) => a + Math.min(p, r.groupCaps[g] ?? 100), 0));
  const hard = signals.some((s) => s.outcome === "FAIL" && r.hardStopGroups.includes(s.grp));
  const padPass = signals.some((s) => s.grp === "PAD" && s.outcome === "PASS");
  const level = hard || total >= r.highFrom ? "HIGH" : (total >= r.lowBelow || !padPass) ? "MEDIUM" : "LOW";
  return { score: total, level, route: policy.routes[level] };
}
