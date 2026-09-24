/**
 * Client for the face microservice (services/face). The API never runs a face model and never stores
 * an embedding: the service analyses images, keeps the 1:N gallery (pgvector) and answers searches;
 * the API keeps only template ids and the policy on top (facecheck.ts).
 *
 *   FACE_SERVICE_URL    e.g. http://host.docker.internal:8003 — empty = face checks unavailable
 *   FACE_SERVICE_TOKEN  shared bearer token
 */
import { b64, unb64 } from "./util.ts";

export class Unavailable extends Error {}

export interface Probe {
  kind: string; faces: number; score: number | null; yaw: number | null; roll: number | null; area: number | null;
  embedding: Float32Array | null; live: number | null;
}

export interface Hit { id: string; score: number; subject?: string; kind?: string; tags?: Record<string, string> }

async function call(method: string, path: string, body?: unknown): Promise<any> {
  const base = (Deno.env.get("FACE_SERVICE_URL") ?? "").replace(/\/$/, "");
  if (!base) throw new Unavailable("FACE_SERVICE_URL not set");
  let r: Response;
  try {
    r = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${Deno.env.get("FACE_SERVICE_TOKEN") ?? ""}` },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    throw new Unavailable(String((e as Error).message ?? e));
  }
  if ([502, 503, 504].includes(r.status)) throw new Unavailable(`face service ${r.status}`);
  if (!r.ok) throw new Error(`face service ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return await r.json();
}

const emb = (s: string | null | undefined) => {
  if (!s) return null;
  const raw = unb64(s);
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
};
const embB64 = (v: Float32Array) => b64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));

export async function analyze(images: Record<string, Uint8Array>, liveness: string[]): Promise<Record<string, Probe>> {
  const res = (await call("POST", "/v1/analyze", {
    images: Object.fromEntries(Object.entries(images).map(([k, v]) => [k, b64(v)])),
    liveness,
  })).results as Record<string, any>;
  const out: Record<string, Probe> = {};
  for (const [k, r] of Object.entries(res)) {
    const f = r.face ?? {};
    out[k] = { kind: k, faces: r.faces, score: f.score ?? null, yaw: f.yaw ?? null, roll: f.roll ?? null,
      area: Array.isArray(f.box) ? f.box[2] * f.box[3] : null,
      embedding: emb(r.embedding), live: r.liveness ?? null };
  }
  return out;
}

export async function enroll(subject: string, kind: string, e: Float32Array, tags: Record<string, string>,
  liveness: number | null, createdAt: string): Promise<string> {
  return (await call("POST", "/v1/gallery/templates", { subject, kind, embedding: embB64(e), tags, liveness, created_at: createdAt })).id;
}

export interface SearchFilters {
  kinds?: string[]; min_score?: number; limit?: number; before?: string | null; exclude_subjects?: string[] | null;
  tags_eq?: Record<string, string>; tags_ne?: Record<string, string>;
}

export async function search(e: Float32Array | null, template: string | null, filters: SearchFilters): Promise<Hit[]> {
  const body: Record<string, unknown> = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== null && v !== undefined));
  if (e) body.embedding = embB64(e); else body.template = template;
  return (await call("POST", "/v1/gallery/search", body)).hits;
}

export async function verify(e: Float32Array, template: string): Promise<number> {
  return Number((await call("POST", "/v1/verify", { embedding: embB64(e), template })).score);
}

export async function erase(subject: string): Promise<number> {
  return Number((await call("DELETE", `/v1/gallery/subjects/${encodeURIComponent(subject)}`)).deleted);
}
