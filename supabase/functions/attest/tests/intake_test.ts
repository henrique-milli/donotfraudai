/**
 * End-to-end intake against a real Postgres (DATABASE_URL, migrations applied) and a fake face service:
 * sealing, routing, audit chain, 1:N linking of one face across two documents, analyst decisions.
 * Run: supabase/functions/attest/tests/run.sh (throwaway pgvector container) or `deno task test`.
 */
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";

// fake face service: one face per image, embedding = one-hot of the image's first "person" byte
const gallery: { id: string; subject: string; kind: string; tags: Record<string, string>; e: number[]; created_at: string }[] = [];
const embOf = (bytes: Uint8Array) => { const v = new Float32Array(128); v[bytes[3] % 128] = 1; return v; };
const b64f = (v: Float32Array) => btoa(String.fromCharCode(...new Uint8Array(v.buffer)));
const unb64f = (s: string) => new Float32Array(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer);
const face = Deno.serve({ port: 0, onListen: () => {} }, async (req) => {
  const p = new URL(req.url).pathname, b = req.method === "POST" ? await req.json() : {};
  if (p === "/v1/analyze") {
    const results = Object.fromEntries(Object.entries(b.images as Record<string, string>).map(([k, v]) => {
      const bytes = Uint8Array.from(atob(v), (c) => c.charCodeAt(0));
      return [k, { faces: 1, face: { score: 0.9, yaw: 0, roll: 0 }, embedding: b64f(embOf(bytes)), liveness: b.liveness.includes(k) ? 0.95 : null }];
    }));
    return Response.json({ results });
  }
  if (p === "/v1/gallery/templates") {
    const id = crypto.randomUUID();
    gallery.push({ id, subject: b.subject, kind: b.kind, tags: b.tags, e: [...unb64f(b.embedding)], created_at: b.created_at });
    return Response.json({ id });
  }
  if (p === "/v1/gallery/search") {
    const q = b.embedding ? [...unb64f(b.embedding)] : gallery.find((g) => g.id === b.template)!.e;
    const hits = gallery.filter((g) => (!b.kinds || b.kinds.includes(g.kind)) && !(b.exclude_subjects ?? []).includes(g.subject) &&
      Object.entries(b.tags_eq ?? {}).every(([k, v]) => g.tags[k] === v) && Object.entries(b.tags_ne ?? {}).every(([k, v]) => g.tags[k] !== v))
      .map((g) => ({ id: g.id, score: g.e.reduce((a, x, i) => a + x * q[i], 0) })).filter((h) => h.score >= (b.min_score ?? 0));
    return Response.json({ hits });
  }
  return new Response("nope", { status: 404 });
});
Deno.env.set("FACE_SERVICE_URL", `http://127.0.0.1:${face.addr.port}`);
Deno.env.set("ATTEST_IMAGES_IN_DB", "1");

const { generateKey, publicSpki, seal, openEnvelope } = await import("../../_shared/envelope.ts");
Deno.env.set("ATTEST_KEYS", JSON.stringify({ t1: await generateKey() }));
Deno.env.set("ATTEST_ACTIVE_KID", "t1");
const { sql } = await import("../../_shared/db.ts");
const intake = await import("../../_shared/intake.ts");
const { verifyChain } = await import("../../_shared/audit.ts");
const { payload, SCENARIOS } = await import("../tools/fixtures.ts");

// a JPEG header followed by a "person" byte
const jpeg = (person: number) => btoa(String.fromCharCode(0xff, 0xd8, 0xff, person, 1, 2, 3));
const sealed = async (p: unknown) => seal({ payload: JSON.stringify(p), sig: null }, await publicSpki("t1"), "t1");
const opts = { sanitizeOps: false, sanitizeResources: false };

Deno.test({ name: "envelope round trip", ...opts, fn: async () => {
  const env = await sealed({ hello: "zürich" });
  assertEquals(JSON.parse((await openEnvelope(env)).payload), { hello: "zürich" });
  await assertRejects(() => openEnvelope({ ...env, kid: "nope" }));
} });

Deno.test({ name: "intake routes the demo scenarios and keeps the audit chain intact", ...opts, fn: async () => {
  await sql`truncate attest.cases, attest.face_clusters, attest.challenges restart identity cascade`;
  await sql`alter table attest.audit_events disable trigger audit_append_only`;
  await sql`delete from attest.audit_events`;
  await sql`alter table attest.audit_events enable trigger audit_append_only`;
  const routes: Record<string, string> = {};
  for (const [title, spec] of SCENARIOS) routes[title] = (await intake.ingest(sql, await sealed(payload(title, spec)), "203.0.113.10", true)).case.risk_level;
  assertEquals(routes["Screen replay of an ID"], "HIGH");
  assertEquals(routes["Emulator with injected camera"], "HIGH");
  assert(routes["Clean chipped ID, chip verified"] !== "HIGH");
  // auto routes: HIGH → BRANCH_VISIT (no auto-deny); MEDIUM → MANUAL_REVIEW
  const [replay] = await sql`select route, status from attest.cases where demo_fixture and risk_level = 'HIGH' limit 1`;
  assertEquals(replay.route, "BRANCH_VISIT");
  assertEquals(replay.status, "BRANCH_INVITED");
  assert((await verifyChain(sql)).ok);
  await assertRejects(() => sql`update attest.audit_events set actor = 'mallory' where id = 1`);
  await assertRejects(() => intake.ingest(sql, { v: 1, alg: "x", kid: "t1", epk: "", iv: "", ct: "" } as any, null), intake.IntakeError);
} });

Deno.test({ name: "1:N links one face across two documents; decisions are audited", ...opts, fn: async () => {
  const mk = (doc: string, person: number) => {
    const p: any = payload("face", { holder: ["EVA", "TEST", doc], signals: [], chip: ["UNKNOWN", false] });
    p.images = { selfie: { b64: jpeg(person) }, portrait: { b64: jpeg(person) } };
    p.resumeToken = "tok-" + doc;
    return p;
  };
  const a = await intake.ingest(sql, await sealed(mk("X1111111", 7)), null);
  const b = await intake.ingest(sql, await sealed(mk("X2222222", 7)), null);
  const [ca] = await sql`select face_cluster_id from attest.cases where id = ${a.case.id}`;
  const [cb] = await sql`select face_cluster_id from attest.cases where id = ${b.case.id}`;
  assert(ca.face_cluster_id && ca.face_cluster_id === cb.face_cluster_id, "same face, same cluster");
  const [dup] = await sql`select outcome, value from attest.signals where case_id = ${b.case.id} and label = 'Same face, other documents'`;
  assertEquals(dup.outcome, "WARN");
  assert(dup.value.includes("X1111111"));

  const d = await intake.decide(sql, b.case.number, "tester", "REQUEST_VERIFICATION", "check");
  assertEquals(d?.action, "REQUEST_VERIFICATION");
  const c = await intake.caseForToken(sql, b.case.session_id, "tok-X2222222");
  assert(c);
  assertEquals(await intake.caseForToken(sql, b.case.session_id, "wrong"), null);
  const [rv] = await sql`select status, steps from attest.reverifications where case_id = ${b.case.id}`;
  assertEquals(rv.status, "PENDING");
  assertEquals(rv.steps.length, 2);
  assert((await verifyChain(sql)).ok);
  await sql.end();
  await face.shutdown();
} });
