/**
 * Client for the faceswap / deepfake microservice (services/faceswap).
 *
 *   FACESWAP_SERVICE_URL    e.g. http://host.docker.internal:8004 — empty = check skipped (INFO)
 *   FACESWAP_SERVICE_TOKEN  shared bearer token
 *
 * Contract (mock today; real model should keep the same shape):
 *   POST /v1/analyze { session_id, images: {name→b64}, meta? }
 *     → { swap_score, injection_likely, artifacts, model, mode }
 */
import { b64 } from "./util.ts";

export class Unavailable extends Error {}

export interface SwapResult {
  swapScore: number;
  injectionLikely: boolean;
  artifacts: string[];
  model: string;
  mode: string;
  framesScored: number;
}

export async function analyze(
  sessionId: string,
  images: Record<string, Uint8Array>,
  meta: Record<string, unknown> = {},
): Promise<SwapResult> {
  const base = (Deno.env.get("FACESWAP_SERVICE_URL") ?? "").replace(/\/$/, "");
  if (!base) throw new Unavailable("FACESWAP_SERVICE_URL not set");
  let r: Response;
  try {
    r = await fetch(base + "/v1/analyze", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${Deno.env.get("FACESWAP_SERVICE_TOKEN") ?? ""}`,
      },
      body: JSON.stringify({
        session_id: sessionId,
        images: Object.fromEntries(Object.entries(images).map(([k, v]) => [k, b64(v)])),
        meta,
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    throw new Unavailable(String((e as Error).message ?? e));
  }
  if ([502, 503, 504].includes(r.status)) throw new Unavailable(`faceswap service ${r.status}`);
  if (!r.ok) throw new Error(`faceswap service ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  return {
    swapScore: Number(j.swap_score ?? 0),
    injectionLikely: !!j.injection_likely,
    artifacts: Array.isArray(j.artifacts) ? j.artifacts.map(String) : [],
    model: String(j.model ?? "faceswap"),
    mode: String(j.mode ?? "unknown"),
    framesScored: Number(j.frames_scored ?? 0) | 0,
  };
}
