/**
 * Randomized face actions on every session: the server issues the sequence, the phone signs its id, the
 * server re-measures each action from its own face analysis. A fake face service reads pose and scale
 * from bytes planted in each test image, so each action can be performed right or wrong on purpose.
 */
import { assert, assertEquals } from "jsr:@std/assert@1";

// test "JPEG": ff d8 ff | person | yaw+100 (hundredths of an eye distance) | roll+100 (degrees) | face size px
// | image width / 10 (square image)
const img = (person: number, yaw = 0, roll = 0, size = 100, width = 72) =>
  btoa(String.fromCharCode(0xff, 0xd8, 0xff, person, yaw + 100, roll + 100, size, width));
const b64f = (v: Float32Array) => btoa(String.fromCharCode(...new Uint8Array(v.buffer)));

const face = Deno.serve({ port: 0, onListen: () => {} }, async (req) => {
  const p = new URL(req.url).pathname, b = req.method === "POST" ? await req.json() : {};
  if (p === "/v1/analyze") {
    const results = Object.fromEntries(Object.entries(b.images as Record<string, string>).map(([k, v]) => {
      const x = Uint8Array.from(atob(v), (c) => c.charCodeAt(0));
      const e = new Float32Array(128); e[x[3] % 128] = 1;
      return [k, { faces: 1, face: { score: 0.9, yaw: (x[4] - 100) / 100, roll: x[5] - 100, box: [0, 0, x[6], x[6]] }, size: [x[7] * 10, x[7] * 10],
        embedding: b64f(e), liveness: b.liveness.includes(k) ? 0.95 : null }];
    }));
    return Response.json({ results });
  }
  if (p === "/v1/gallery/templates") return Response.json({ id: crypto.randomUUID() });
  if (p === "/v1/gallery/search") return Response.json({ hits: [] });
  return new Response("nope", { status: 404 });
});
Deno.env.set("FACE_SERVICE_URL", `http://127.0.0.1:${face.addr.port}`);
Deno.env.set("ATTEST_IMAGES_IN_DB", "1");

const { generateKey, publicSpki, seal } = await import("../../_shared/envelope.ts");
Deno.env.set("ATTEST_KEYS", JSON.stringify({ t1: await generateKey() }));
Deno.env.set("ATTEST_ACTIVE_KID", "t1");
const { sql } = await import("../../_shared/db.ts");
const intake = await import("../../_shared/intake.ts");
const { issueFaceChallenge, pickSteps } = await import("../../_shared/facecheck.ts");
const { payload } = await import("../tools/fixtures.ts");

/** The frame a genuine user produces for each action. */
const performed: Record<string, [number, number, number]> = {
  TURN_LEFT: [-30, 0, 100], TURN_RIGHT: [30, 0, 100], TILT_LEFT: [0, -20, 100], TILT_RIGHT: [0, 20, 100],
  MOVE_CLOSER: [0, 0, 130], MOVE_FURTHER: [0, 0, 80],
};

let n = 0;
function session(steps: string[], challenge?: string, frames: number[][] = steps.map((s) => performed[s])) {
  const p: any = payload("face-challenge", { holder: ["EVA", "TEST", `Z${String(++n).padStart(7, "0")}`], signals: [], chip: ["UNKNOWN", false] });
  p.face = { mode: "ACTIVE", challenge, gestures: steps.map((g, i) => ({ gesture: g, frame: `active${i + 1}` })) };
  p.images = { selfie: { b64: img(40 + n) } };
  frames.forEach(([y, r, s, wd], i) => (p.images[`active${i + 1}`] = { b64: img(40 + n, y, r, s, wd) }));
  return p;
}
const ingest = async (p: unknown) => {
  const env = await seal({ payload: JSON.stringify(p), sig: null }, await publicSpki("t1"), "t1");
  const { case: c } = await intake.ingest(sql, env, null);
  const rows = await sql`select label, outcome, value from attest.signals where case_id = ${c.id} and grp = 'FACE'`;
  return Object.fromEntries(rows.map((r: { label: string }) => [r.label, r]));
};
const opts = { sanitizeOps: false, sanitizeResources: false };

Deno.test({ name: "sequences are random, distinct, and always include a head turn", ...opts, fn: () => {
  const seen = new Set<string>();
  for (let i = 0; i < 300; i++) {
    const s = pickSteps(["TURN_LEFT", "TURN_RIGHT", "TILT_LEFT", "TILT_RIGHT", "MOVE_CLOSER", "MOVE_FURTHER"], 3, ["TURN_LEFT", "TURN_RIGHT"]);
    assertEquals(new Set(s).size, 3);
    assert(s.some((g) => g.startsWith("TURN")));
    seen.add(s.join(","));
  }
  assert(seen.size > 40, `only ${seen.size} distinct sequences`);
} });

Deno.test({ name: "performed as issued → challenge and actions pass", ...opts, fn: async () => {
  const ch = await issueFaceChallenge(sql, null);
  const f = await ingest(session(ch.steps, ch.id));
  assertEquals(f["Face challenge"].outcome, "PASS");
  assertEquals(f["Active liveness gestures"].outcome, "PASS", f["Active liveness gestures"].value);
  assertEquals(f["Same face across actions"].outcome, "PASS");
} });

Deno.test({ name: "closer / further judged on face size relative to the image, not pixels", ...opts, fn: async () => {
  // the app sends the selfie at 720 px and action frames at 480 px: a real ×1.3 move closer is only
  // ×0.58 in raw pixels (the Pixel 6 bug), and must still pass
  const steps = ["TURN_LEFT", "MOVE_CLOSER", "MOVE_FURTHER"];
  const [row] = await sql`insert into attest.face_challenges (id, steps, expires_at) values ('res-mix', ${sql.json(steps)}, now() + interval '3 minutes') returning id`;
  const f = await ingest(session(steps, row.id, [[-30, 0, 67, 48], [0, 0, 76, 48], [0, 0, 62, 48]]));
  assertEquals(f["Active liveness gestures"].outcome, "PASS", f["Active liveness gestures"].value);
} });

Deno.test({ name: "replayed capture (challenge reused) fails", ...opts, fn: async () => {
  const ch = await issueFaceChallenge(sql, null);
  await ingest(session(ch.steps, ch.id));
  const f = await ingest(session(ch.steps, ch.id));
  assertEquals(f["Face challenge"].outcome, "FAIL");
  assert(f["Face challenge"].value.includes("already used"));
} });

Deno.test({ name: "a different sequence than issued fails (pre-recorded clip)", ...opts, fn: async () => {
  const ch = await issueFaceChallenge(sql, null);
  const f = await ingest(session([...ch.steps].reverse(), ch.id));
  assertEquals(f["Face challenge"].outcome, "FAIL");
} });

Deno.test({ name: "claimed but not performed, or wrong direction → actions fail", ...opts, fn: async () => {
  const ch = await issueFaceChallenge(sql, null);
  const still = await ingest(session(ch.steps, ch.id, ch.steps.map(() => [0, 0, 100])));
  assertEquals(still["Active liveness gestures"].outcome, "FAIL");

  const both = ["TURN_LEFT", "TURN_RIGHT", "TILT_LEFT"];
  const ch2 = await sql`insert into attest.face_challenges (id, steps, expires_at) values ('fixed-both', ${sql.json(both)}, now() + interval '3 minutes') returning id`;
  const same = await ingest(session(both, ch2[0].id, [[-30, 0, 100], [-30, 0, 100], [0, -20, 100]]));
  assertEquals(same["Active liveness gestures"].outcome, "FAIL");
  assert(same["Active liveness gestures"].value.includes("same direction"));
} });

Deno.test({ name: "passive-only capture is flagged; unknown challenge fails", ...opts, fn: async () => {
  const p: any = session([]);
  delete p.face;
  const passive = await ingest(p);
  assertEquals(passive["Face challenge"].outcome, "WARN");
  const forged = await ingest(session(["TURN_LEFT"], "not-issued-here"));
  assertEquals(forged["Face challenge"].outcome, "FAIL");
  await sql.end();
  await face.shutdown();
} });
