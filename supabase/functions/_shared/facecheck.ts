/**
 * Face signals for a session (passive) and for a re-verification (active). The models run in the face
 * microservice (faceclient.ts); this module is the policy: which comparisons, which thresholds, which risk.
 *
 * Session (passive, default):
 *   selfie present · one face · passive liveness over selfie + burst frames · burst frames are all the
 *   same face · face-swap / deepfake injection (services/faceswap) · 1:1 selfie vs reference (chip DG2
 *   photo if read, else ID portrait) · printed portrait vs chip photo · 1:N over people: face cluster,
 *   other documents, repeat attempts, document presented before by someone else, document photo reused
 *
 * Re-verification (active, requested by the risk engine on MEDIUM or by an analyst):
 *   each requested gesture visible in its frame (pose change from the neutral selfie, measured by the
 *   service from landmarks) · liveness on every frame · new selfie matches the first selfie and the reference
 */
import * as fc from "./faceclient.ts";
import * as fswap from "./faceswapclient.ts";
import type { Sql } from "./db.ts";
import { policy } from "./policy.ts";
import { type Sig, sig } from "./risk.ts";
import { dot } from "./util.ts";

const G = "FACE";
const cfg = policy.face;
const w = cfg.weights;

export const clusterLabel = (id: number | string | null) => (id == null ? null : `F-${String(id).padStart(5, "0")}`);
export const STATUS_LABEL: Record<string, string> = {
  AUTO_APPROVED: "Auto-approved", STEP_UP_REQUESTED: "Step-up requested", IN_TRIAGE: "In triage",
  ESCALATED: "Escalated", APPROVED: "Approved", REJECTED: "Rejected",
};

/** A template to enroll in the service gallery once the case exists (the API keeps no embedding). */
export interface Pending { kind: string; galleryKind: string; embedding: Float32Array; liveness: number | null; tags: Record<string, string> }

export interface FaceOutcome {
  signals: Sig[]; templates: Pending[]; reference: string; similarity: number | null; liveness: number | null;
  cluster: number | null; hasSelfie: boolean;
}
const outcome = (): FaceOutcome => ({ signals: [], templates: [], reference: "", similarity: null, liveness: null, cluster: null, hasSelfie: false });
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

function livenessSig(label: string, scores: number[]): Sig | null {
  if (!scores.length) return null;
  const m = mean(scores);
  const val = `${m.toFixed(2)} mean over ${scores.length} frame(s) · min ${Math.min(...scores).toFixed(2)}`;
  const rule = `MiniFASNet real-probability ≥ ${cfg.livenessPass} (fail < ${cfg.livenessFail})`;
  if (m >= cfg.livenessPass) return sig(G, label, "PASS", val, rule, w.livenessFail);
  if (m < cfg.livenessFail) return sig(G, label, "FAIL", val + " · spoof (print / screen / mask)", rule, w.livenessFail);
  return sig(G, label, "WARN", val + " · inconclusive", rule, w.livenessInconclusive);
}

function matchSig(label: string, sim: number, refName: string): Sig {
  const t = cfg.matchThreshold, rule = `SFace cosine ≥ ${t}`, val = `${sim.toFixed(2)} vs ${refName}`;
  if (sim >= t) return sig(G, label, "PASS", val, rule, w.faceMismatch);
  if (sim >= t - cfg.borderlineMargin) return sig(G, label, "WARN", val + " · borderline", rule, w.faceBorderline);
  return sig(G, label, "FAIL", val + " · different person", rule, w.faceMismatch);
}

export async function analyzeSession(sql: Sql, images: Record<string, Uint8Array>, documentNumber: string): Promise<FaceOutcome> {
  const out = outcome();
  const wanted = Object.fromEntries(Object.entries(images).filter(([k]) => ["selfie", "portrait", "chipPhoto"].includes(k) || k.startsWith("burst")));
  if (!("selfie" in wanted)) {
    out.signals.push(sig(G, "Selfie captured", "WARN", "no selfie in this session", "passive selfie required; active liveness requested instead", w.noSelfie));
    if (!Object.keys(wanted).length) return out;
  }
  let probes: Record<string, fc.Probe>;
  try {
    probes = await fc.analyze(wanted, Object.keys(wanted).filter((k) => k === "selfie" || k.startsWith("burst")));
  } catch (e) {
    if (!(e instanceof fc.Unavailable)) throw e;
    out.signals.push(sig(G, "Face service", "INFO", `unavailable: ${e.message}`.slice(0, 200), "services/face"));
    return out;
  }
  const selfie = probes.selfie, portrait = probes.portrait, chip = probes.chipPhoto;
  const bursts = Object.keys(probes).sort().filter((k) => k.startsWith("burst")).map((k) => probes[k]);

  // exactly one face in the selfie
  if (selfie) {
    if (selfie.faces === 0) out.signals.push(sig(G, "Face in selfie", "WARN", "no face found", "exactly one face", w.noFace));
    else if (selfie.faces > 1) out.signals.push(sig(G, "Face in selfie", "WARN", `${selfie.faces} faces`, "exactly one face", w.multipleFaces));
    else out.signals.push(sig(G, "Face in selfie", "PASS", `detector ${(selfie.score ?? 0).toFixed(2)}`, "exactly one face", w.noFace));
  }

  // passive liveness (server)
  const lives = [...(selfie ? [selfie] : []), ...bursts].filter((p) => p.faces && p.live !== null).map((p) => p.live!);
  const ls = livenessSig("Passive liveness (server)", lives);
  if (ls) { out.signals.push(ls); out.liveness = mean(lives); }

  // face-swap / deepfake injection (services/faceswap — mock today; same contract for a real model)
  const swapFrames = Object.fromEntries(
    Object.entries(wanted).filter(([k]) => k === "selfie" || k.startsWith("burst")),
  );
  if (Object.keys(swapFrames).length) {
    try {
      const sw = await fswap.analyze("", swapFrames);
      const failAt = cfg.swapFailFrom, warnAt = cfg.swapWarnFrom;
      const val = `swap_score ${sw.swapScore.toFixed(2)} · ${sw.model} · ${sw.mode}` +
        (sw.artifacts.length ? ` · ${sw.artifacts.slice(0, 3).join(", ")}` : "");
      const rule = `swap_score < ${warnAt} pass · ≥ ${failAt} fail (${sw.mode})`;
      let outcome: "PASS" | "WARN" | "FAIL" = "PASS";
      let pts = 0;
      if (sw.injectionLikely || sw.swapScore >= failAt) {
        outcome = "FAIL";
        pts = w.faceSwapFail;
      } else if (sw.swapScore >= warnAt) {
        outcome = "WARN";
        pts = w.faceSwapWarn;
      }
      out.signals.push(sig(G, "Face-swap / deepfake", outcome, val, rule, pts));
    } catch (e) {
      if (!(e instanceof fswap.Unavailable)) throw e;
      out.signals.push(sig(G, "Face-swap / deepfake", "INFO", `unavailable: ${e.message}`.slice(0, 200), "services/faceswap"));
    }
  }

  // burst consistency: every passive frame shows the selfie's face
  if (selfie?.embedding && bursts.length) {
    const sims = bursts.filter((b) => b.embedding).map((b) => dot(selfie.embedding!, b.embedding!));
    const missing = bursts.filter((b) => !b.embedding).length;
    const ok = sims.length > 0 && Math.min(...sims) >= cfg.burstThreshold && missing === 0;
    out.signals.push(sig(G, "Capture consistency", ok ? "PASS" : "WARN",
      sims.length ? `${sims.length}/${bursts.length} frames · min similarity ${Math.min(...sims).toFixed(2)}` : "no face in the frames",
      `all frames same face (≥ ${cfg.burstThreshold})`, w.burstInconsistent));
  }

  // printed portrait vs chip photo (photo substitution on the card)
  if (portrait?.embedding && chip?.embedding) {
    const s = dot(portrait.embedding, chip.embedding), t = cfg.matchThreshold;
    out.signals.push(sig(G, "Printed photo vs chip photo", s >= t ? "PASS" : "FAIL",
      s.toFixed(2) + (s >= t ? "" : " · printed portrait replaced"), `SFace cosine ≥ ${t}`, w.portraitChipMismatch));
  }

  // 1:1 selfie vs reference (issuer-signed chip photo preferred)
  const ref = chip?.embedding ? chip : portrait?.embedding ? portrait : null;
  if (selfie?.embedding && ref) {
    const s = dot(selfie.embedding, ref.embedding!);
    out.reference = ref.kind; out.similarity = s;
    out.signals.push(matchSig("Face match 1:1", s, ref.kind === "chipPhoto" ? "chip photo (DG2)" : "ID portrait"));
  } else if (selfie?.embedding) {
    out.signals.push(sig(G, "Face match 1:1", "INFO", "no face on the document images", "reference: chip photo or ID portrait"));
  }

  // 1:N: the person (face cluster) and the documents it has been used with
  out.hasSelfie = !!selfie?.embedding;
  try {
    const r = await identity(sql, { selfieEmb: out.hasSelfie ? selfie!.embedding : null, portraitEmb: ref?.embedding ?? null, documentNumber });
    out.signals.push(...r.signals);
    out.cluster = r.cluster;
  } catch (e) {
    if (!(e instanceof fc.Unavailable)) throw e;
    out.signals.push(sig(G, "Face identity", "INFO", `1:N unavailable: ${e.message}`.slice(0, 200), "services/face"));
  }

  for (const p of [selfie, portrait, chip]) {
    if (p?.embedding) out.templates.push({ kind: p.kind, galleryKind: p.kind, embedding: p.embedding, liveness: p.live, tags: { document: documentNumber } });
  }
  return out;
}

/** Adds the case's templates to the service gallery and records their ids. */
export async function enroll(sql: Sql, c: { id: number; number: number; session_id: string; created_at: Date; document_number: string }, pending: Pending[]) {
  for (const p of pending) {
    let gid: string;
    try {
      gid = await fc.enroll(c.session_id, p.galleryKind, p.embedding, { ...p.tags, case: String(c.number) }, p.liveness, new Date(c.created_at).toISOString());
    } catch (e) {
      if (e instanceof fc.Unavailable) continue;
      throw e;
    }
    await sql`insert into attest.face_templates (case_id, kind, gallery_id, liveness, document_number)
              values (${c.id}, ${p.kind}, ${gid}, ${p.liveness}, ${c.document_number})
              on conflict (case_id, kind) do update set gallery_id = excluded.gallery_id, liveness = excluded.liveness`;
  }
}

interface TCase { gallery_id: string; case_id: number; number: number; session_id: string; document_number: string; status: string;
  risk_level: string; created_at: Date; face_cluster_id: number | null }

async function templatesFor(sql: Sql, hits: fc.Hit[]): Promise<Map<string, TCase>> {
  if (!hits.length) return new Map();
  const rows = await sql<TCase[]>`
    select t.gallery_id, c.id as case_id, c.number, c.session_id, c.document_number, c.status, c.risk_level, c.created_at, c.face_cluster_id
    from attest.face_templates t join attest.cases c on c.id = t.case_id
    where t.gallery_id in ${sql(hits.map((h) => h.id))}`;
  return new Map(rows.map((r: TCase) => [r.gallery_id, r]));
}

/**
 * 1:N over people, not documents. The live selfie is searched against every earlier LIVE selfie in
 * the gallery (never against document photos) to find the person's face cluster; the cluster then
 * says how many attempts and which documents this face has been used with.
 * Queries by embedding (at intake) or by stored template id (rebuild). Returns signals and cluster id.
 */
export async function identity(sql: Sql, o: {
  selfieEmb?: Float32Array | null; portraitEmb?: Float32Array | null; documentNumber: string;
  before?: Date | null; excludeSubject?: string | null; selfieTemplate?: string | null; portraitTemplate?: string | null;
}): Promise<{ signals: Sig[]; cluster: number | null }> {
  const out: Sig[] = [];
  const doc = o.documentNumber;
  const before = o.before ?? null;
  const common = { before: before ? before.toISOString() : null, exclude_subjects: o.excludeSubject ? [o.excludeSubject] : null };
  let cluster: number | null = null;

  if (o.selfieEmb || o.selfieTemplate) {
    const hits = await fc.search(o.selfieEmb ?? null, o.selfieTemplate ?? null, { kinds: ["selfie"], min_score: cfg.samePersonThreshold, limit: 100, ...common });
    const temps = await templatesFor(sql, hits);
    const best = new Map<number, number>();
    for (const h of hits) {
      const t = temps.get(h.id);
      if (t?.face_cluster_id) best.set(t.face_cluster_id, Math.max(best.get(t.face_cluster_id) ?? -1, h.score));
    }
    if (best.size) cluster = [...best.entries()].sort((a, b) => b[1] - a[1])[0][0];

    let prior: { id: number; number: number; session_id: string; document_number: string; status: string; risk_level: string; created_at: Date; failed: string | null }[] = [];
    if (cluster !== null) {
      prior = (await sql<typeof prior>`
        select c.id, c.number, c.session_id, c.document_number, c.status, c.risk_level, c.created_at,
               (select s.label from attest.signals s where s.case_id = c.id and s.grp = 'FACE' and s.outcome = 'FAIL' order by s.id limit 1) as failed
        from attest.cases c where c.face_cluster_id = ${cluster} order by c.created_at`)
        // deno-lint-ignore no-explicit-any
        .filter((c: any) => (before === null || new Date(c.created_at) < before) && c.session_id !== o.excludeSubject);
    }
    const label = clusterLabel(cluster);
    const docs = [...new Set([...prior.map((c) => c.document_number).filter(Boolean), ...(doc ? [doc] : [])])].sort();
    const others = docs.filter((d) => d !== doc);
    const perDoc = docs.map((d) => `${d} ×${prior.filter((c) => c.document_number === d).length + (d === doc ? 1 : 0)}`).join(", ");
    out.push(sig(G, "Face identity", "INFO",
      cluster !== null ? `${label} · attempt ${prior.length + 1} · ${docs.length} document(s): ${perDoc}` : "new face: first attempt",
      "live selfie vs every earlier live selfie"));
    out.push(sig(G, "Same face, other documents", others.length ? "WARN" : "PASS",
      others.length ? `${label} also tried ` + others.map((d) => `${d} (` + prior.filter((c) => c.document_number === d).map((c) => `#${c.number}`).join(", ") + ")").join(", ")
        : "no other document for this face",
      "one person, one document", w.duplicateFace));
    const bad = prior.filter((c) => c.status === "REJECTED" || c.risk_level === "HIGH" || c.failed);
    if (prior.length) {
      out.push(sig(G, "Repeat attempt", bad.length ? "WARN" : "INFO",
        prior.slice(-4).map((c) => `#${c.number} ${(STATUS_LABEL[c.status] ?? c.status).toLowerCase()}` + (c.failed ? ` (${c.failed.toLowerCase()} failed)` : "")).join(", "),
        "earlier attempts by the same face", w.repeatAttempt));
    }

    // this document before: presented by the same live face, or by someone else?
    if (doc) {
      const h2 = await fc.search(o.selfieEmb ?? null, o.selfieTemplate ?? null, { kinds: ["selfie"], tags_eq: { document: doc }, min_score: -1, limit: 100, ...common });
      const t2 = await templatesFor(sql, h2);
      const byCase = new Map<number, [TCase, number]>();
      for (const h of h2) {
        const t = t2.get(h.id);
        if (t && (!byCase.has(t.case_id) || h.score > byCase.get(t.case_id)![1])) byCase.set(t.case_id, [t, h.score]);
      }
      if (byCase.size) {
        const stranger = [...byCase.values()].some(([, s]) => s < cfg.matchThreshold);
        out.push(sig(G, "Document presented before", stranger ? "FAIL" : "INFO",
          [...byCase.values()].map(([c, s]) => `#${c.number} by ${s < cfg.matchThreshold ? "another person" : "this person"} (${s.toFixed(2)})`).join(", "),
          "a document is presented by one person only", w.documentOtherFace));
      }
    }
  }

  // the card's printed photo on other document numbers (composed / cloned cards)
  if ((o.portraitEmb || o.portraitTemplate) && doc) {
    const h3 = await fc.search(o.portraitEmb ?? null, o.portraitTemplate ?? null, { kinds: ["portrait", "chipPhoto"], tags_ne: { document: doc }, min_score: cfg.searchThreshold, limit: 20, ...common });
    const t3 = await templatesFor(sql, h3);
    const reused = h3.filter((h) => t3.has(h.id)).map((h) => [t3.get(h.id)!, h.score] as const);
    out.push(sig(G, "Document photo reused", reused.length ? "WARN" : "PASS",
      reused.slice(0, 4).map(([c, s]) => `#${c.number} ${c.document_number} (${s.toFixed(2)})`).join(", ") || "photo unique to this document",
      "a document photo belongs to one document", w.portraitReused));
  }
  return { signals: out, cluster };
}

// ---------------------------------------------------------------------- active re-verification

export interface Rv { id: number; case_id: number; number: number; steps: string[]; status: string; expires_at: Date }

/** Creates a pending active-liveness request with a random gesture sequence (unless one is pending). */
export async function issue(sql: Sql, caseId: number, requestedBy: string): Promise<Rv> {
  const [pending] = await sql<Rv[]>`select * from attest.reverifications where case_id = ${caseId} and status = 'PENDING' and expires_at > now() limit 1`;
  if (pending) return pending;
  const a = policy.activeLiveness;
  const pool = [...a.gestures];
  const steps: string[] = [];
  while (steps.length < Math.min(a.steps, a.gestures.length)) {
    const r = crypto.getRandomValues(new Uint32Array(1))[0] % pool.length;
    steps.push(pool.splice(r, 1)[0]);
  }
  const [row] = await sql<Rv[]>`
    insert into attest.reverifications (case_id, number, steps, requested_by, expires_at)
    values (${caseId}, (select coalesce(max(number), 0) + 1 from attest.reverifications where case_id = ${caseId}),
            ${sql.json(steps)}, ${requestedBy}, now() + make_interval(hours => ${a.ttlHours}))
    returning *`;
  return row;
}

/** images: selfie (neutral) + active<n> frames, keys without the rv prefix. */
export async function analyzeActive(sql: Sql, c: { id: number; document_number: string }, rv: Rv, images: Record<string, Uint8Array>,
  gestures: { gesture?: string; frame?: string }[]): Promise<FaceOutcome> {
  const out = outcome();
  const wanted = Object.fromEntries(Object.entries(images).filter(([k]) => k === "selfie" || k.startsWith("active")));
  let probes: Record<string, fc.Probe>;
  try {
    probes = await fc.analyze(wanted, Object.keys(wanted));
  } catch (e) {
    if (!(e instanceof fc.Unavailable)) throw e;
    out.signals.push(sig(G, "Active liveness", "INFO", `face service unavailable: ${e.message}`.slice(0, 200), "services/face"));
    return out;
  }
  const neutral = probes.selfie;
  if (!neutral || !neutral.faces || !neutral.embedding) {
    out.signals.push(sig(G, "Active liveness", "FAIL", "no face in the neutral frame", "face visible", w.gestureFailed));
    return out;
  }

  // each requested gesture: its frame must show the pose change, measured by the service from landmarks
  const frameFor = new Map(gestures.map((g) => [g.gesture, g.frame]));
  const y0 = neutral.yaw ?? 0, r0 = neutral.roll ?? 0;
  let results: { step: string; ok: boolean; v: string; d?: number }[] = [];
  const lives = neutral.live !== null ? [neutral.live] : [];
  const embs: (Float32Array | null)[] = [neutral.embedding];
  for (const step of rv.steps) {
    const key = frameFor.get(step);
    const p = key ? probes[key] : undefined;
    if (!p || !p.faces) { results.push({ step, ok: false, v: "no frame / no face" }); continue; }
    if (p.live !== null) lives.push(p.live);
    embs.push(p.embedding);
    const dy = (p.yaw ?? 0) - y0, dr = (p.roll ?? 0) - r0;
    const sgn = (x: number, d: number) => (x >= 0 ? "+" : "") + x.toFixed(d);
    if (step.startsWith("TURN")) results.push({ step, ok: Math.abs(dy) >= cfg.gestureYaw, v: `yaw Δ ${sgn(dy, 2)}`, d: dy });
    else results.push({ step, ok: Math.abs(dr) >= cfg.gestureRoll, v: `roll Δ ${sgn(dr, 0)}°`, d: dr });
  }
  // opposite gestures must move in opposite directions (a replayed clip rarely matches a random order)
  const dirs = new Map(results.filter((r) => r.ok && r.d !== undefined).map((r) => [r.step, r.d!]));
  for (const [a, b] of [["TURN_LEFT", "TURN_RIGHT"], ["TILT_LEFT", "TILT_RIGHT"]]) {
    if (dirs.has(a) && dirs.has(b) && Math.sign(dirs.get(a)!) === Math.sign(dirs.get(b)!)) {
      results = results.map((r) => ([a, b].includes(r.step) ? { ...r, ok: false, v: r.v + " · same direction as its opposite" } : r));
    }
  }
  const passed = results.every((r) => r.ok);
  out.signals.push(sig(G, "Active liveness gestures", passed ? "PASS" : "FAIL",
    results.map((r) => `${r.step.toLowerCase().replace("_", " ")} ${r.ok ? "✓" : "✗"} (${r.v})`).join(" · "),
    "each random gesture visible in its frame (server-side pose)", w.gestureFailed));

  const ls = livenessSig("Liveness on gesture frames", lives);
  if (ls) { out.signals.push(ls); out.liveness = mean(lives); }
  const consistent = embs.every((e) => e && dot(neutral.embedding!, e) >= cfg.burstThreshold);
  out.signals.push(sig(G, "Same face across gestures", consistent ? "PASS" : "WARN",
    consistent ? "all frames match the neutral frame" : "frames show different faces", `≥ ${cfg.burstThreshold}`, w.burstInconsistent));

  // new selfie vs the first selfie and vs the document reference, against the stored gallery templates
  const names: Record<string, string> = { selfie: "first selfie", chipPhoto: "chip photo (DG2)", portrait: "ID portrait" };
  for (const [kind, label] of [["selfie", "Matches first selfie"], ["chipPhoto", "Matches chip photo"], ["portrait", "Matches ID portrait"]]) {
    const [t] = await sql`select gallery_id from attest.face_templates where case_id = ${c.id} and kind = ${kind} and gallery_id <> '' limit 1`;
    if (!t) continue;
    let s: number;
    try { s = await fc.verify(neutral.embedding, t.gallery_id); } catch (e) { if (e instanceof fc.Unavailable) continue; throw e; }
    out.signals.push(matchSig(label, s, names[kind]));
    if (kind !== "selfie" && out.similarity === null) { out.similarity = s; out.reference = kind; }
  }
  out.templates.push({ kind: `rv${rv.number}_selfie`, galleryKind: "selfie", embedding: neutral.embedding, liveness: neutral.live,
    tags: { document: c.document_number, rv: String(rv.number) } });
  return out;
}
