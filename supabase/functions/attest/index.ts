/**
 * Attest API — one Supabase Edge Function (Deno). Runs unchanged on Supabase and locally
 * (`deno task serve`, plain Postgres + pgvector; see supabase/functions/attest/README.md).
 *
 * Device-facing (no auth; the payload itself is sealed and signed):
 *   GET  /v1/keys                    active envelope public key (the app pins it at build time)
 *   POST /v1/challenges              fresh single-use attestation challenge
 *   POST /v1/sessions                sealed session → {session, route}; never the reasons
 *   POST /v1/sessions/:id/next       {token} → NONE | ACTIVE_LIVENESS {steps}
 * Analyst-facing (header `x-analyst-token: $ANALYST_TOKEN`, `x-analyst: <name>` for the audit trail):
 *   GET  /analyst/cases?tab=&q=      queue      GET /analyst/cases/:n   case (signals, face, evidence, audit)
 *   POST /analyst/cases/:n/decision  {action, note}
 *   GET  /analyst/cases/:n/images/:kind         GET /analyst/faces   GET /analyst/audit   GET /analyst/stats
 *
 * Accepted prefixes, so the same app build works on both: /functions/v1/attest, /attest, /api.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import * as blob from "../_shared/blobstore.ts";
import * as views from "../_shared/console.ts";
import { sql } from "../_shared/db.ts";
import { activeKid, ALG, publicSpki } from "../_shared/envelope.ts";
import * as intake from "../_shared/intake.ts";
import { policy } from "../_shared/policy.ts";
import { verifyChain } from "../_shared/audit.ts";
import { utf8 } from "../_shared/util.ts";

const CORS = {
  "access-control-allow-origin": Deno.env.get("ANALYST_ORIGIN") ?? "*",
  "access-control-allow-headers": "content-type, x-analyst-token, x-analyst, authorization, apikey, x-client-info",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json", "cache-control": "no-store" } });

function route(url: URL) {
  let p = url.pathname.replace(/\/+$/, "");
  for (const pre of ["/functions/v1", "/attest", "/api"]) if (p.startsWith(pre + "/") || p === pre) p = p.slice(pre.length);
  return p || "/";
}

const clientIp = (req: Request) => (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;

function analystOk(req: Request) {
  const want = Deno.env.get("ANALYST_TOKEN") ?? "";
  const got = req.headers.get("x-analyst-token") ?? "";
  if (want.length < 16) return false; // refuse to run the console with a missing or trivial token
  const a = utf8.encode(want), b = utf8.encode(got);
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.min(a.length, b.length); i++) d |= a[i] ^ b[i];
  return d === 0;
}

async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const url = new URL(req.url);
  const p = route(url);
  let m: RegExpExecArray | null;

  // ------------------------------------------------------------ device-facing
  if (p === "/v1/health" || p === "/health") return json({ service: "attest-api", ok: true, time: new Date().toISOString() });
  if (p === "/v1/keys" && req.method === "GET") return json({ kid: activeKid(), spki: await publicSpki(), alg: "P-256", envelope: ALG });
  if (p === "/v1/challenges" && req.method === "POST") {
    const ttl = policy.challenge.ttlSeconds;
    return json({ challenge: await intake.issueChallenge(sql, ttl, clientIp(req)), expiresIn: ttl }, 201);
  }
  if (p === "/v1/sessions" && req.method === "POST") {
    const env = await req.json().catch(() => null);
    if (!env || typeof env !== "object" || typeof env.ct !== "string" || env.ct.length > 16_000_000) return json({ error: "bad request" }, 400);
    try {
      const r = await intake.ingest(sql, env, clientIp(req));
      return json({ session: r.case.session_id, route: r.case.route }, r.created ? 201 : 200);
    } catch (e) {
      if (e instanceof intake.IntakeError) return json({ error: "envelope rejected" }, 400);
      throw e;
    }
  }
  if ((m = /^\/v1\/sessions\/([A-Za-z0-9_-]{1,32})\/next$/.exec(p)) && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const c = await intake.caseForToken(sql, m[1], String(body?.token ?? ""));
    if (!c) return json({ error: "not found" }, 404);
    const [rv] = await sql`select number, steps, expires_at from attest.reverifications
                           where case_id = ${c.id} and status = 'PENDING' and expires_at > now() limit 1`;
    return json(rv ? { action: "ACTIVE_LIVENESS", reverification: rv.number, steps: rv.steps, expiresAt: new Date(rv.expires_at).toISOString() } : { action: "NONE" });
  }

  // ------------------------------------------------------------ analyst-facing
  if (p.startsWith("/analyst/")) {
    if (!analystOk(req)) return json({ error: "unauthorized" }, 401);
    const analyst = (req.headers.get("x-analyst") ?? "analyst").replace(/[^\w .@-]/g, "").slice(0, 64) || "analyst";
    if (p === "/analyst/cases") return json(await views.listCases(sql, url.searchParams));
    if (p === "/analyst/stats") return json(await views.stats(sql));
    if (p === "/analyst/faces") return json(await views.faces(sql));
    if (p === "/analyst/audit") return json({ chain: await verifyChain(sql), events: await views.auditLog(sql) });
    if ((m = /^\/analyst\/cases\/(\d+)$/.exec(p))) {
      const d = await views.caseDetail(sql, Number(m[1]));
      return d ? json(d) : json({ error: "not found" }, 404);
    }
    if ((m = /^\/analyst\/cases\/(\d+)\/decision$/.exec(p)) && req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      try {
        const d = await intake.decide(sql, Number(m[1]), analyst, String(b.action ?? ""), String(b.note ?? ""));
        return d ? json(d, 201) : json({ error: "not found" }, 404);
      } catch (e) {
        if (e instanceof RangeError) return json({ error: e.message }, 400);
        throw e;
      }
    }
    if ((m = /^\/analyst\/cases\/(\d+)\/images\/([A-Za-z0-9_]{1,24})$/.exec(p))) {
      const i = await views.image(sql, Number(m[1]), m[2]);
      if (!i) return json({ error: "not found" }, 404);
      const bytes: Uint8Array = i.storage_key ? await blob.get(i.storage_key) : i.data;
      return new Response(bytes, { headers: { ...CORS, "content-type": i.mime, "cache-control": "private, max-age=300", "x-content-type-options": "nosniff" } });
    }
  }
  return json({ error: "not found" }, 404);
}

Deno.serve(async (req) => {
  try {
    return await handle(req);
  } catch (e) {
    console.error(e);
    return json({ error: "internal error" }, 500);
  }
});
