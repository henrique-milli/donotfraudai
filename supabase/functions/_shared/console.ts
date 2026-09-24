/**
 * Read models for the analyst console (apps/admin). Everything the console renders is shaped here, so
 * the web app stays a thin client: group rows with capped points, the face panel (1:1, liveness, 1:N
 * cluster, re-verifications), device/chip/capture/network evidence, top risk drivers.
 */
import type { Sql } from "./db.ts";
import { clusterLabel } from "./facecheck.ts";
import { OPEN } from "./intake.ts";
import { scoreLadder } from "./ladder.ts";
import { policy } from "./policy.ts";
import { fired } from "./risk.ts";

const GROUPS: [string, string, string][] = [
  ["PAD", "Presentation attack", "Screen replay, print, moiré, photo tampering"],
  ["FACE", "Face verification", "1:1 match, 1:N search, passive and active liveness"],
  ["CLASSIFICATION", "Document", "Title, MRZ, issuing state, selection"],
  ["CONSISTENCY", "Cross-checks", "Front vs MRZ, validity, age"],
  ["CHIP", "Chip · ICAO 9303", "Symbol, enforcement, passive authentication"],
  ["DEVICE", "Device integrity", "Attestation, boot state, root, risk apps"],
  ["SERVER", "Server verification", "Signature, chain, challenge, history"],
  ["BEHAVIOUR", "Capture behaviour", "Hand-held motion, timing, guidance"],
  ["QUALITY", "Image quality", "Light, focus, glare, fingers"],
];
const RANK: Record<string, number> = { FAIL: 3, WARN: 2, PASS: 1, INFO: 0, SKIPPED: 0 };
const IMAGE_NAMES: Record<string, string> = { front: "Card front", back: "Card back", portrait: "ID portrait", chipPhoto: "Chip photo (DG2)", selfie: "Selfie" };

export function imageLabel(kind: string) {
  const m = /^(?:rv(\d+)_)?(.+)$/.exec(kind)!;
  const base = m[2];
  const name = base.startsWith("burst") ? `Passive frame ${base.slice(5)}` : base.startsWith("active") ? `Gesture frame ${base.slice(6)}` : IMAGE_NAMES[base] ?? base;
  return m[1] ? `Re-verification ${m[1]} · ${name}` : name;
}

export async function listCases(sql: Sql, p: URLSearchParams) {
  const tab = (p.get("tab") ?? "all").toLowerCase();
  const q = (p.get("q") ?? "").trim();
  const level = ["high", "medium", "low"].includes(tab) ? tab.toUpperCase() : null;
  const openOnly = tab !== "all" && p.get("closed") !== "1";
  const like = `%${q}%`;
  const cases = await sql`
    select number, session_id, created_at, document_type, holder_name, document_number, risk_score, risk_level, route, status,
           recommendation, demo_fixture, (select count(*) from attest.reverifications r where r.case_id = c.id and r.status = 'PENDING')::int as pending_rv
    from attest.cases c
    where (${level}::text is null or risk_level = ${level})
      and (${!openOnly} or status = any(${OPEN}))
      and (${q} = '' or holder_name ilike ${like} or session_id ilike ${like} or document_number ilike ${like} or number::text like ${like})
    order by created_at desc limit 100`;
  return { cases, ...(await counts(sql)) };
}

export async function counts(sql: Sql) {
  const byLevel = Object.fromEntries((await sql`select risk_level, count(*)::int n from attest.cases group by 1`).map((r) => [r.risk_level, r.n]));
  const [t] = await sql`select count(*)::int total, count(*) filter (where status = any(${OPEN}))::int open from attest.cases`;
  return { counts: byLevel, total: t.total, open: t.open };
}

export async function stats(sql: Sql) {
  const c = await counts(sql);
  const byStatus = Object.fromEntries((await sql`select status, count(*)::int n from attest.cases group by 1`).map((r) => [r.status, r.n]));
  const [d] = await sql`select count(distinct case_id)::int decided, count(distinct case_id) filter (where followed_recommendation)::int followed from attest.decisions`;
  return { cases: c.total, byLevel: c.counts, byStatus, open: c.open, analystAgreement: d.decided ? Math.round((d.followed / d.decided) * 100) / 100 : null };
}

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

function groupRows(signals: Row[]) {
  const rows: Row[] = [];
  for (const [key, title, sub] of GROUPS) {
    const g = signals.filter((s) => s.grp === key);
    if (!g.length) continue;
    const scored = g.filter((s) => ["PASS", "FAIL", "WARN"].includes(s.outcome));
    const worst = scored.length ? g.reduce((a, s) => (RANK[s.outcome] > RANK[a.outcome] ? s : a)).outcome : "INFO";
    const f = g.filter((s) => fired(s as { outcome: string })).sort((a, b) => b.risk_points - a.risk_points);
    const raw = g.reduce((a, s) => a + s.risk_points, 0);
    const cap = policy.risk.groupCaps[key];
    rows.push({
      key, title, worst, points: cap ? Math.min(raw, cap) : raw, capped: !!(cap && raw > cap), raw,
      headline: scored.length ? `${scored.filter((s) => s.outcome === "PASS").length}/${scored.length} passed` : "recorded",
      detail: f.length ? `${f[0].label}: ${f[0].value}` : sub, open: ["FAIL", "WARN"].includes(worst), signals: g,
    });
  }
  return rows;
}

function evidence(c: Row) {
  const p = c.payload ?? {};
  const prof = p.attestation?.profile ?? {};
  const tel: Record<string, Row> = p.telemetry ?? {};
  const chip = p.chip ?? {};
  const net = prof.network ?? {}, tele = prof.telephony ?? {};
  return [
    { title: "Device", icon: "device", line1: c.device_model || "unknown device",
      line2: `${c.secure_hardware || "no"} attestation · boot ${c.verified_boot || "—"}`, flag: c.verified_boot ? !c.verified_boot.startsWith("Verified") : true },
    { title: "Chip", icon: "chip", line1: c.chip_verified ? "verified" : c.chip_read ? "read" : "not read",
      line2: `${String(chip.expectation || "unknown").toLowerCase()} · ${chip.reason ?? ""}`.slice(0, 60), flag: c.chip_expected === "REQUIRED" && !c.chip_verified },
    { title: "Capture", icon: "camera",
      line1: Object.entries(tel).map(([k, v]) => `${k.toLowerCase()} ${v.seconds ? Math.round(v.seconds * 10) / 10 : "—"} s`).join(" · ") || "—",
      line2: Object.values(tel).filter((v) => v.gyroRms != null).map((v) => `gyro ${Math.round(v.gyroRms * 1000) / 1000}`).join(" · ").slice(0, 60), flag: false },
    { title: "Network", icon: "pin", line1: c.client_ip || "offline upload",
      line2: `${net.vpn ? "VPN · " : ""}SIM ${tele.simCountry || "—"} · net ${tele.networkCountry || "—"}`, flag: !!net.proxy },
  ];
}

export async function caseDetail(sql: Sql, number: number) {
  const [c] = await sql`select * from attest.cases where number = ${number}`;
  if (!c) return null;
  const [signals, images, decisions, rvs, auditRows] = await Promise.all([
    sql`select grp, side, label, outcome, value, rule, risk_points, source from attest.signals where case_id = ${c.id} order by id`,
    sql`select kind, mime, width, height, sha256 from attest.case_images where case_id = ${c.id} order by id`,
    sql`select action, note, analyst, followed_recommendation, created_at from attest.decisions where case_id = ${c.id} order by created_at desc`,
    sql`select number, steps, requested_by, status, created_at, expires_at, completed_at, result from attest.reverifications where case_id = ${c.id} order by number desc`,
    sql`select id, at, actor, kind, data, hash from attest.audit_events where case_id = ${c.id} order by id`,
  ]);
  const img = Object.fromEntries(images.map((i) => [i.kind, { ...i, label: imageLabel(i.kind), url: `/analyst/cases/${number}/images/${i.kind}` }]));

  // face panel: selfie next to its reference, scores, 1:N result and re-verification history
  const fs = Object.fromEntries(signals.filter((s) => s.grp === "FACE" && s.source === "SERVER").map((s) => [s.label, s]));
  const attempts = c.face_cluster_id
    ? await sql`select number, document_number, status, risk_level, created_at from attest.cases where face_cluster_id = ${c.face_cluster_id} order by created_at`
    : [];
  const earlier = attempts.filter((a) => new Date(a.created_at) < new Date(c.created_at));
  const scores = [...String(fs["Document presented before"]?.value ?? "").matchAll(/by this person \((-?[0-9.]+)\)/g)].map((m) => Number(m[1]));
  const hits = fs["Same face, other documents"];
  const otherDocs = hits?.outcome === "WARN";
  const label = clusterLabel(c.face_cluster_id);
  const facePanel = {
    cluster: label, attempts, documents: [...new Set(attempts.map((a) => a.document_number).filter(Boolean))].sort(),
    search: {
      state: otherDocs ? "multi" : earlier.length ? "seen" : "new",
      title: otherDocs ? "same face, other documents" : earlier.length ? `matched ${earlier.length} earlier session${earlier.length === 1 ? "" : "s"}` : "new face",
      detail: otherDocs ? hits.value : earlier.length
        ? (scores.length ? `${label} · best similarity ${Math.max(...scores).toFixed(2)} · same document each time` : `${label} · same document each time`)
        : "no earlier live selfie matches this face",
    },
    selfie: img.selfie ?? null, reference: c.face_reference ? img[c.face_reference] ?? null : null,
    frames: Object.keys(img).sort().filter((k) => /^(burst|active)\d$/.test(k)).map((k) => img[k]),
    similarity: c.face_similarity, liveness: c.liveness_score,
    signals: fs,
    reverifications: rvs.map((r) => ({
      ...r, selfie: img[`rv${r.number}_selfie`] ?? null,
      frames: Object.keys(img).sort().filter((k) => k.startsWith(`rv${r.number}_active`)).map((k) => img[k]),
      signals: signals.filter((s) => s.source === `RV${r.number}`),
    })),
  };
  const order = ["selfie", "portrait", "chipPhoto", "front", "back"].filter((k) => img[k]).map((k) => img[k]);
  const { payload: _p, resume_token_hash: _t, id: _id, ...pub } = c;
  const ladder = scoreLadder(signals as any, {
    chipVerified: !!c.chip_verified,
    chipExpected: c.chip_expected ?? "",
    documentNumber: c.document_number ?? "",
  });
  return {
    case: { ...pub, face_cluster: label },
    ladder: {
      confidence: ladder.confidence,
      score: ladder.score,
      level: ladder.level,
      route: ladder.route,
      steps: ladder.steps,
      agent: ladder.agent ?? null,
    },
    groups: groupRows(signals), evidence: evidence(c), face: facePanel, images: order, allImages: Object.values(img),
    portrait: img.chipPhoto ?? img.portrait ?? null, decisions, audit: auditRows,
    drivers: signals.filter((s) => s.risk_points > 0).sort((a, b) => b.risk_points - a.risk_points).slice(0, 5),
    actions: [["APPROVE", "Approve"], ["REQUEST_VERIFICATION", "Request verification"], ["ESCALATE", "Escalate"], ["REJECT", "Reject"]],
  };
}

export async function faces(sql: Sql) {
  const rows = await sql`
    select f.id, count(distinct c.id)::int n_cases, count(distinct nullif(c.document_number, ''))::int n_docs, max(c.created_at) last,
           json_agg(json_build_object('number', c.number, 'document_number', c.document_number, 'status', c.status,
                    'risk_level', c.risk_level, 'created_at', c.created_at,
                    'has_selfie', exists(select 1 from attest.case_images i where i.case_id = c.id and i.kind = 'selfie'))
                    order by c.created_at) cases
    from attest.face_clusters f join attest.cases c on c.face_cluster_id = f.id
    group by f.id order by n_docs desc, n_cases desc, last desc limit 200`;
  return {
    clusters: rows.map((r) => ({
      label: clusterLabel(r.id), cases: r.cases, nCases: r.n_cases, nDocs: r.n_docs, last: r.last,
      documents: [...new Set((r.cases as Row[]).map((x) => x.document_number).filter(Boolean))].sort(),
      selfieCase: [...(r.cases as Row[])].reverse().find((x) => x.has_selfie)?.number ?? null,
    })),
    ...(await counts(sql)),
  };
}

export async function auditLog(sql: Sql) {
  return await sql`select e.id, e.at, e.actor, e.kind, e.data, e.prev_hash, e.hash, e.case_number
                   from attest.audit_events e order by e.id desc limit 300`;
}

export async function image(sql: Sql, number: number, kind: string) {
  const [i] = await sql`select i.mime, i.data, i.storage_key from attest.case_images i join attest.cases c on c.id = i.case_id
                        where c.number = ${number} and i.kind = ${kind}`;
  return i ?? null;
}
