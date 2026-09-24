/**
 * Session intake: envelope → verified payload → server signals → score → route → case.
 *
 * The response to the phone carries only the route (CONTINUE / MANUAL_REVIEW / BRANCH_VISIT), never the
 * reasons: the applicant-facing channel must not become an oracle an attacker can iterate against.
 * STEP_UP remains only for analyst-requested active liveness (REQUEST_VERIFICATION), not auto-routing.
 */
import * as audit from "./audit.ts";
import { verify } from "./attestation.ts";
import * as blob from "./blobstore.ts";
import type { Sql } from "./db.ts";
import { type Envelope, EnvelopeError, openEnvelope } from "./envelope.ts";
import { explain } from "./explainer.ts";
import * as face from "./facecheck.ts";
import { fired, scoreWithLadder, serverSignals, type Sig, sig } from "./risk.ts";
import { sha256Hex, unb64 } from "./util.ts";

export class IntakeError extends Error {}

export const STATUS_FOR_ROUTE: Record<string, string> = {
  CONTINUE: "AUTO_APPROVED",
  MANUAL_REVIEW: "IN_TRIAGE",
  BRANCH_VISIT: "BRANCH_INVITED",
  /** Analyst-requested active liveness only — not an auto score route. */
  STEP_UP: "STEP_UP_REQUESTED",
};
export const OPEN = ["STEP_UP_REQUESTED", "IN_TRIAGE", "ESCALATED", "BRANCH_INVITED"];
export const ACTIONS = ["APPROVE", "REQUEST_VERIFICATION", "ESCALATE", "REJECT"];
const NEXT_STATUS: Record<string, string> = { APPROVE: "APPROVED", REJECT: "REJECTED", ESCALATE: "ESCALATED", REQUEST_VERIFICATION: "STEP_UP_REQUESTED" };

const assurance = (level: string, chipVerified: boolean) =>
  level === "LOW" ? (chipVerified ? "HIGH" : "SUBSTANTIAL") : "PENDING";


export const KIND_PATTERN = /^(rv\d{1,2}_)?(front|back|portrait|chipPhoto|selfie|burst[1-4]|active[1-6])$/;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

export interface Img { kind: string; mime: string; width: number; height: number; sha256: string; data: Uint8Array }

/** Pops payload.images (kept out of the stored JSON), validates each one, leaves a manifest. */
// deno-lint-ignore no-explicit-any
async function extractImages(payload: any): Promise<Img[]> {
  const raw = payload.images ?? {};
  delete payload.images;
  const out: Img[] = [];
  const manifest: Record<string, unknown> = {};
  for (const [kind, img] of Object.entries(raw as Record<string, any>)) {
    if (!KIND_PATTERN.test(kind) || typeof img !== "object" || !img) continue;
    let data: Uint8Array;
    try { data = unb64(String(img.b64 ?? "")); } catch { continue; }
    const mime = data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff ? "image/jpeg"
      : data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47 ? "image/png" : null;
    if (!mime || data.length > MAX_IMAGE_BYTES) continue;
    const sha256 = await sha256Hex(data);
    out.push({ kind, mime, width: Number(img.width) || 0, height: Number(img.height) || 0, sha256, data });
    manifest[kind] = { sha256, bytes: data.length };
  }
  payload.imageManifest = manifest;
  return out;
}

/** Images go to Supabase Storage when configured (only the key is kept), else into the database. */
// deno-lint-ignore no-explicit-any
async function storeImages(tx: any, c: { id: number; session_id: string }, images: Img[]) {
  for (const im of images) {
    let key = "", data: Uint8Array | null = im.data;
    if (blob.enabled()) {
      key = `${c.session_id}/${im.kind}-${im.sha256.slice(0, 12)}.${im.mime === "image/png" ? "png" : "jpg"}`;
      await blob.put(key, im.data, im.mime);
      data = null;
    }
    await tx`insert into attest.case_images (case_id, kind, mime, width, height, sha256, data, storage_key)
             values (${c.id}, ${im.kind}, ${im.mime}, ${im.width}, ${im.height}, ${im.sha256}, ${data}, ${key})
             on conflict (case_id, kind) do nothing`;
  }
}

// deno-lint-ignore no-explicit-any
function holder(payload: any) {
  const h = payload.holder ?? {};
  return {
    holder_name: [h.givenNames, h.surname].filter(Boolean).join(" ").trim().slice(0, 128),
    document_number: String(h.documentNumber ?? "").slice(0, 32),
    nationality: String(h.nationality ?? "").slice(0, 3),
    birth_date: String(h.dateOfBirth ?? "").slice(0, 10),
    expiry_date: String(h.dateOfExpiry ?? "").slice(0, 10),
    identity_source: String(h.source ?? "").slice(0, 16),
  };
}

// deno-lint-ignore no-explicit-any
const deviceSigs = (payload: any, source: string, only?: string): Sig[] =>
  (payload.signals ?? []).filter((s: any) => !only || s.group === only).map((s: any) =>
    sig(String(s.group), String(s.signal), String(s.outcome), String(s.value ?? ""), String(s.rule ?? ""), Number(s.riskPoints ?? 0) | 0, s.side ?? "", source));

// deno-lint-ignore no-explicit-any
async function insertSignals(tx: any, caseId: number, sigs: Sig[]) {
  if (!sigs.length) return;
  await tx`insert into attest.signals ${tx(sigs.map((s) => ({
    case_id: caseId, grp: s.grp.slice(0, 16), side: (s.side ?? "").slice(0, 8), label: s.label.slice(0, 64), outcome: s.outcome.slice(0, 8),
    value: s.value, rule: s.rule, risk_points: fired(s) ? s.risk_points : 0, source: s.source,
  })))}`;
}

const tokenHash = (t: unknown) => (t ? sha256Hex(String(t)) : Promise.resolve(""));

export interface Ingested { case: { id: number; number: number; session_id: string; route: string; risk_level: string; risk_score: number; recommendation: string }; created: boolean }

export async function ingest(sql: Sql, env: Envelope, clientIp: string | null, demoFixture = false): Promise<Ingested> {
  // deno-lint-ignore no-explicit-any
  let body: { payload: string; sig: string | null }, payload: any;
  try {
    body = await openEnvelope(env);
    payload = JSON.parse(body.payload);
  } catch (e) {
    await audit.record(sql, null, "system", "intake_rejected", { reason: String((e as Error).message), ip: clientIp, kid: env?.kid ?? null });
    throw new IntakeError(e instanceof EnvelopeError ? e.message : "payload unreadable");
  }
  if (payload.kind === "reverification") return await ingestReverification(sql, body, payload, clientIp);

  const sessionId = String(payload.session ?? "").slice(0, 32);
  if (!sessionId) throw new IntakeError("payload has no session id");
  const [existing] = await sql`select id, number, session_id, route, risk_level, risk_score, recommendation from attest.cases where session_id = ${sessionId}`;
  if (existing) {
    await audit.record(sql, existing as any, "device", "duplicate_submission", { ip: clientIp });
    return { case: existing as any, created: false };
  }

  const v = await verify(sql, body, payload); // signature is checked over the full payload, images included
  const images = await extractImages(payload);
  const h = holder(payload);
  const att = payload.attestation ?? {};
  const profile = att.profile ?? {};
  const deviceId = String(profile.deviceId || v.key?.bootKeySha256 || "").slice(0, 64);

  const history = {
    documentRejected: !!h.document_number &&
      (await sql`select 1 from attest.cases where document_number = ${h.document_number} and status = 'REJECTED' limit 1`).length > 0,
    deviceIdentities: deviceId
      ? new Set([...(await sql`select distinct document_number from attest.cases where device_key = ${deviceId} and document_number <> ''`).map((r: { document_number: string }) => r.document_number),
        ...(h.document_number ? [h.document_number] : [])]).size
      : 0,
  };

  const devSigs = deviceSigs(payload, "DEVICE");
  const srvSigs = serverSignals(v, history);
  const f = await face.analyzeSession(sql, Object.fromEntries(images.map((i) => [i.kind, i.data])), h.document_number);
  const all = [...devSigs, ...srvSigs, ...f.signals];

  const chip = payload.chip ?? {};
  const chipVerified = devSigs.some((x) => x.grp === "CHIP" && x.label.startsWith("SOD signature") && x.outcome === "PASS") &&
    !devSigs.some((x) => x.grp === "CHIP" && x.outcome === "FAIL");
  const ladder = scoreWithLadder(all, {
    chipVerified,
    chipExpected: String(chip.expectation ?? ""),
    documentNumber: h.document_number,
  });
  const s = { score: ladder.score, level: ladder.level, route: ladder.route };
  const ex = explain(all, s.level, s.score, chipVerified, String(chip.expectation ?? ""));
  const build = profile.build ?? {};

  const created = await sql.begin(async (tx: Sql) => {
    const [c] = await tx`
      insert into attest.cases ${tx({
        session_id: sessionId, demo_fixture: demoFixture, document_type: String(payload.document ?? "").slice(0, 32), ...h,
        device_model: `${build.manufacturer ?? ""} ${build.model ?? ""}`.trim().slice(0, 128), device_key: deviceId, client_ip: clientIp,
        signature_ok: v.signatureOk, chain_ok: v.chainOk, challenge_ok: v.challengeOk,
        secure_hardware: v.key?.securityLevel ?? "",
        verified_boot: v.key ? `${v.key.verifiedBoot} · ${v.key.deviceLocked ? "locked" : "unlocked"}` : "",
        chip_expected: String(chip.expectation ?? "").slice(0, 16), chip_read: !!chip.read, chip_verified: chipVerified,
        device_score: payload.deviceVerdict?.riskScore ?? null,
        risk_score: s.score, risk_level: s.level, route: s.route, status: STATUS_FOR_ROUTE[s.route], assurance: assurance(s.level, chipVerified),
        summary: ex.summary, recommendation: ex.recommendation, recommendation_text: ex.recommendationText, confidence: ex.confidence,
        why_not_approve: tx.json(ex.whyNotApprove), why_not_reject: tx.json(ex.whyNotReject),
        resume_token_hash: await tokenHash(payload.resumeToken),
        face_reference: f.reference, face_similarity: f.similarity, liveness_score: f.liveness, payload: tx.json(payload),
      })}
      returning id, number, session_id, created_at, document_number, route, risk_level, risk_score, recommendation`;
    await insertSignals(tx, c.id, all);
    await storeImages(tx, c, images);
    await face.enroll(tx, c, f.templates);
    let cluster: number | null = null;
    if (f.hasSelfie) {
      cluster = f.cluster ?? (await tx`insert into attest.face_clusters default values returning id`)[0].id;
      await tx`update attest.cases set face_cluster_id = ${cluster} where id = ${c.id}`;
      await tx`update attest.face_clusters set updated_at = now() where id = ${cluster}`; // most recent activity first
    }
    await audit.record(tx, c, "device", "session_received", {
      images: Object.fromEntries(images.map((i) => [i.kind, i.sha256])), session: sessionId, ip: clientIp, kid: env.kid,
      signed: v.signed, signature_ok: v.signatureOk, chain_ok: v.chainOk, challenge: v.challengeStatus,
    });
    await audit.record(tx, c, "system", "risk_assessed", {
      score: s.score, level: s.level, route: s.route, device_score: payload.deviceVerdict?.riskScore ?? null,
      recommendation: ex.recommendation, confidence: ex.confidence,
      ladder: {
        confidence: ladder.confidence,
        steps: ladder.steps.map((st) => ({
          id: st.id, title: st.title, confidence: st.confidence, risk: st.risk, outcome: st.outcome, summary: st.summary, weight: st.weight,
        })),
        agent: ladder.agent ?? null,
      },
      fired: all.filter((x) => fired(x) && x.risk_points).map((x) => `${x.grp}:${x.label}:+${x.risk_points}`),
      face: { reference: f.reference, similarity: f.similarity, liveness: f.liveness, cluster: face.clusterLabel(cluster) },
    });
    if (s.route === "STEP_UP") {
      const rv = await face.issue(tx, c.id, "risk engine");
      await audit.record(tx, c, "system", "reverification_requested", { number: rv.number, steps: rv.steps, by: "risk engine" });
    }
    return c;
  });
  console.log(`case #${created.number} session ${sessionId} score=${s.score} ${s.level} -> ${s.route}`);
  return { case: created as any, created: true };
}

/** The phone proves it owns a session with the resume token it put in the signed payload. */
export async function caseForToken(sql: Sql, sessionId: string, token: string) {
  const [c] = await sql`select * from attest.cases where session_id = ${String(sessionId).slice(0, 32)}`;
  if (!c || !c.resume_token_hash || !token) return null;
  const h = await tokenHash(token);
  let diff = h.length ^ c.resume_token_hash.length;
  for (let i = 0; i < Math.min(h.length, c.resume_token_hash.length); i++) diff |= h.charCodeAt(i) ^ c.resume_token_hash.charCodeAt(i);
  return diff === 0 ? c : null;
}

/** Recomputes score, level, route and explanation from the stored signals. */
// deno-lint-ignore no-explicit-any
export async function rescore(tx: any, caseId: number) {
  const [c] = await tx`select chip_verified, chip_expected, document_number from attest.cases where id = ${caseId}`;
  const sigs = await tx`select grp, label, outcome, value, rule, risk_points, side, source from attest.signals where case_id = ${caseId} order by id`;
  const ladder = scoreWithLadder(sigs, {
    chipVerified: !!c.chip_verified,
    chipExpected: c.chip_expected ?? "",
    documentNumber: c.document_number ?? "",
  });
  const s = { score: ladder.score, level: ladder.level, route: ladder.route };
  const ex = explain(sigs, s.level, s.score, c.chip_verified, c.chip_expected);
  await tx`update attest.cases set risk_score = ${s.score}, risk_level = ${s.level}, route = ${s.route},
             assurance = ${assurance(s.level, c.chip_verified)}, summary = ${ex.summary}, recommendation = ${ex.recommendation},
             recommendation_text = ${ex.recommendationText}, confidence = ${ex.confidence},
             why_not_approve = ${tx.json(ex.whyNotApprove)}, why_not_reject = ${tx.json(ex.whyNotReject)}, updated_at = now()
           where id = ${caseId}`;
  return s;
}

/** Active-liveness result for a pending re-verification of an existing case. */
// deno-lint-ignore no-explicit-any
async function ingestReverification(sql: Sql, body: { payload: string; sig: string | null }, payload: any, clientIp: string | null): Promise<Ingested> {
  const c = await caseForToken(sql, payload.parentSession ?? "", payload.resumeToken ?? "");
  if (!c) {
    await audit.record(sql, null, "device", "reverification_rejected", { reason: "unknown session or token", ip: clientIp });
    throw new IntakeError("unknown session");
  }
  const [rv] = await sql<face.Rv[]>`select * from attest.reverifications where case_id = ${c.id} and number = ${Number(payload.reverification) || 0} and status = 'PENDING'`;
  if (!rv) {
    await audit.record(sql, c as any, "device", "reverification_rejected", { reason: "no pending re-verification", ip: clientIp });
    throw new IntakeError("no pending re-verification");
  }
  if (new Date(rv.expires_at) < new Date()) {
    await sql`update attest.reverifications set status = 'EXPIRED' where id = ${rv.id}`;
    throw new IntakeError("re-verification expired");
  }

  const v = await verify(sql, body, payload);
  const images = await extractImages(payload);
  const imgmap = Object.fromEntries(images.map((i) => [i.kind, i.data]));
  for (const im of images) im.kind = `rv${rv.number}_${im.kind}`;
  const f = await face.analyzeActive(sql, c as any, rv, imgmap, payload.face?.gestures ?? []);
  const src = `RV${rv.number}`;
  const sigOk = !!(v.signed && v.signatureOk && v.challengeOk !== false);
  const fresh: Sig[] = [
    sig("SERVER", "Re-verification signature", sigOk ? "PASS" : "FAIL", sigOk ? `attested key · challenge ${v.challengeStatus}` : "unsigned, invalid or replayed",
      "signed by a hardware-attested key, fresh challenge", 80, "", src),
    ...f.signals.map((s) => ({ ...s, side: "", source: src })),
    ...deviceSigs(payload, src, "FACE"),
  ];
  const passed = sigOk && !fresh.some((s) => s.outcome === "FAIL") && fresh.some((s) => s.label === "Active liveness gestures" && s.outcome === "PASS");

  const after = await sql.begin(async (tx: Sql) => {
    await storeImages(tx, c, images);
    await face.enroll(tx, c as any, f.templates);
    await insertSignals(tx, c.id, fresh);
    if (passed) {
      // the doubts the active check was asked to resolve no longer count
      await tx`update attest.signals set risk_points = 0, value = left(value || ${` · cleared by re-verification ${rv.number}`}, 2000)
               where case_id = ${c.id} and grp = 'FACE' and outcome = 'WARN' and source <> ${src}`;
    }
    await tx`update attest.reverifications set status = ${passed ? "PASSED" : "FAILED"}, completed_at = now(),
               session_id = ${String(payload.session ?? "").slice(0, 32)},
               result = ${tx.json({ passed, similarity: f.similarity, liveness: f.liveness, signals: fresh.map((s) => `${s.label}: ${s.outcome}`) })}
             where id = ${rv.id}`;
    const s = await rescore(tx, c.id);
    // pass + high confidence → auto-approve; low confidence → branch invite; else triage
    const status = STATUS_FOR_ROUTE[s.route] ?? (passed && s.level === "LOW" ? "AUTO_APPROVED" : "IN_TRIAGE");
    await tx`update attest.cases set status = ${status},
               face_similarity = coalesce(${f.similarity}, face_similarity),
               face_reference = case when ${f.reference} <> '' then ${f.reference} else face_reference end,
               liveness_score = coalesce(${f.liveness}, liveness_score)
             where id = ${c.id}`;
    await audit.record(tx, c as any, "device", "reverification_received", {
      number: rv.number, steps: rv.steps, passed, ip: clientIp, images: Object.fromEntries(images.map((i) => [i.kind, i.sha256])),
      before: [c.risk_level, c.status], after: [s.level, status], score: s.score,
    });
    return (await tx`select id, number, session_id, route, risk_level, risk_score, recommendation from attest.cases where id = ${c.id}`)[0];
  });
  console.log(`case #${c.number} re-verification ${rv.number} passed=${passed} -> ${after.risk_level}`);
  return { case: after as any, created: true };
}

export async function decide(sql: Sql, number: number, analyst: string, action: string, note = "") {
  if (!ACTIONS.includes(action)) throw new RangeError(`unknown action ${action}`);
  return await sql.begin(async (tx: Sql) => {
    const [c] = await tx`select id, number, status, recommendation from attest.cases where number = ${number} for update`;
    if (!c) return null;
    const followed = action === c.recommendation;
    const [d] = await tx`insert into attest.decisions (case_id, analyst, action, note, followed_recommendation)
                         values (${c.id}, ${analyst}, ${action}, ${note.slice(0, 500)}, ${followed}) returning *`;
    await tx`update attest.cases set status = ${NEXT_STATUS[action]}, updated_at = now() where id = ${c.id}`;
    await audit.record(tx, c, analyst, "analyst_decision", {
      action, note: note.slice(0, 500), status: `${c.status} -> ${NEXT_STATUS[action]}`, ai_recommendation: c.recommendation, followed,
    });
    if (action === "REQUEST_VERIFICATION") {
      const rv = await face.issue(tx as any, c.id, analyst);
      await audit.record(tx, c, analyst, "reverification_requested", { number: rv.number, steps: rv.steps });
    }
    return d;
  });
}

export async function issueChallenge(sql: Sql, ttlSeconds: number, ip: string | null) {
  const value = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  await sql`insert into attest.challenges (value, expires_at, client_ip) values (${value}, now() + make_interval(secs => ${ttlSeconds}), ${ip})`;
  return value;
}
