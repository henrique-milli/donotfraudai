/**
 * Server risk engine. The phone's own score is advisory; the backend re-scores every session from
 * the raw signals plus what only the server can know (verification results, history).
 *
 * Scoring is the confidence-path ladder (`ladder.ts`): per-step confidence → weighted final risk.
 *   level = LOW < 25 <= MEDIUM < 60 <= HIGH;  any FAIL in a hard-stop group -> HIGH
 *   route = LOW -> CONTINUE, MEDIUM -> MANUAL_REVIEW, HIGH -> BRANCH_VISIT
 *   (no auto-deny; analysts may still REJECT after review)
 */
import { policy } from "./policy.ts";
import type { Verification } from "./attestation.ts";
import { scoreLadder, type LadderScore } from "./ladder.ts";

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

/** Full ladder score (steps + final). Prefer this when chip/doc context is available. */
export function scoreWithLadder(
  signals: Sig[],
  opts: { chipVerified?: boolean; chipExpected?: string; documentNumber?: string } = {},
): LadderScore {
  return scoreLadder(signals, opts);
}

/** Compatible wrapper: same shape as before for call sites that only need score/level/route. */
export function score(signals: { grp: string; outcome: string; risk_points: number; label?: string; value?: string; rule?: string; side?: string; source?: string }[]): {
  score: number; level: string; route: string; ladder?: LadderScore;
} {
  const full: Sig[] = signals.map((s) => ({
    grp: s.grp, label: s.label ?? "", outcome: s.outcome, value: s.value ?? "", rule: s.rule ?? "",
    risk_points: s.risk_points, side: s.side ?? "", source: s.source ?? "SERVER",
  }));
  const ladder = scoreLadder(full);
  return { score: ladder.score, level: ladder.level, route: ladder.route, ladder };
}
