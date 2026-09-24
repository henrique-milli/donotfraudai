/**
 * Where case images live.
 *   Supabase Storage (private bucket `case-images`) when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are
 *   set (always the case inside Supabase Edge Functions); images are only ever streamed through the
 *   authenticated analyst API. Otherwise the database row itself (local mode, plain Postgres).
 */
const url = () => (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
const key = () => Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const bucket = () => Deno.env.get("ATTEST_IMAGE_BUCKET") ?? "case-images";

export const enabled = () => Deno.env.get("ATTEST_IMAGES_IN_DB") !== "1" && !!(url() && key());

function req(method: string, k: string, data?: Uint8Array, mime?: string) {
  const headers: Record<string, string> = { authorization: `Bearer ${key()}`, apikey: key() };
  if (data) Object.assign(headers, { "content-type": mime ?? "application/octet-stream", "x-upsert": "true" });
  return fetch(`${url()}/storage/v1/object/${bucket()}/${k}`, { method, headers, body: data, signal: AbortSignal.timeout(30_000) });
}

export async function put(k: string, data: Uint8Array, mime: string) {
  const r = await req("POST", k, data, mime);
  if (!r.ok) throw new Error(`storage put ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

export async function get(k: string): Promise<Uint8Array> {
  const r = await req("GET", k);
  if (!r.ok) throw new Error(`storage get ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

export async function remove(k: string) {
  const r = await req("DELETE", k);
  if (!r.ok && r.status !== 404) throw new Error(`storage delete ${r.status}`);
}
