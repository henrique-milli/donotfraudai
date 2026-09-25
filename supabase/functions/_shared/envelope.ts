/**
 * Session envelopes sealed by the app (core/Envelope.kt), opened with WebCrypto:
 *   ECDH(P-256, backend key, ephemeral key) → HKDF-SHA256(salt = 32 zero bytes, info = "attest/payload/v1")
 *   → AES-256-GCM(iv, AAD = "attest|v1|<kid>")
 *
 * Keys: ATTEST_KEYS = {"<kid>": "<PKCS#8 base64>"}, ATTEST_ACTIVE_KID = the kid the app pins.
 * On Supabase these are Edge Function secrets; locally, environment variables (deno task keygen).
 */
import { b64, fromUtf8, unb64, utf8 } from "./util.ts";

export const ALG = "ECDH-ES-P256+HKDF-SHA256+A256GCM";
const INFO = utf8.encode("attest/payload/v1");
const EC = { name: "ECDH", namedCurve: "P-256" } as const;

export class EnvelopeError extends Error {}

export interface Envelope { v: number; alg: string; kid: string; session?: string; epk: string; iv: string; ct: string }

function keys(): Record<string, string> {
  try { return JSON.parse(Deno.env.get("ATTEST_KEYS") ?? "{}"); } catch { return {}; }
}
export const activeKid = () => Deno.env.get("ATTEST_ACTIVE_KID") ?? Object.keys(keys())[0] ?? "";

const privCache = new Map<string, CryptoKey>();
async function privateKey(kid: string): Promise<CryptoKey> {
  const pk = keys()[kid];
  if (!pk) throw new EnvelopeError(`unknown key id ${JSON.stringify(kid)}`);
  if (!privCache.has(kid)) privCache.set(kid, await crypto.subtle.importKey("pkcs8", unb64(pk), EC, true, ["deriveBits"]));
  return privCache.get(kid)!;
}

/** The active public key as SPKI base64 (what the app pins). */
export async function publicSpki(kid = activeKid()): Promise<string> {
  const jwk = await crypto.subtle.exportKey("jwk", await privateKey(kid));
  delete jwk.d;
  jwk.key_ops = [];
  const pub = await crypto.subtle.importKey("jwk", jwk, EC, true, []);
  return b64(new Uint8Array(await crypto.subtle.exportKey("spki", pub)));
}

async function aesKey(shared: ArrayBuffer, usage: KeyUsage) {
  const ikm = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: INFO }, ikm,
    { name: "AES-GCM", length: 256 }, false, [usage]);
}

export async function openEnvelope(env: Envelope): Promise<{ payload: string; sig: string | null }> {
  try {
    if (env.v !== 1 || env.alg !== ALG) throw new EnvelopeError(`unsupported envelope v=${env.v} alg=${env.alg}`);
    const epk = await crypto.subtle.importKey("spki", unb64(env.epk), EC, false, []);
    const shared = await crypto.subtle.deriveBits({ name: "ECDH", public: epk }, await privateKey(env.kid), 256);
    const key = await aesKey(shared, "decrypt");
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: unb64(env.iv), additionalData: utf8.encode(`attest|v1|${env.kid}`), tagLength: 128 },
      key, unb64(env.ct));
    return JSON.parse(fromUtf8.decode(plain));
  } catch (e) {
    if (e instanceof EnvelopeError) throw e;
    throw new EnvelopeError(`cannot open envelope: ${(e as Error).name}`);
  }
}

/** Test / fixture helper: exactly what the app does. */
export async function seal(body: unknown, spkiB64: string, kid: string): Promise<Envelope> {
  const recipient = await crypto.subtle.importKey("spki", unb64(spkiB64), EC, false, []);
  const eph = await crypto.subtle.generateKey(EC, true, ["deriveBits"]) as CryptoKeyPair;
  const shared = await crypto.subtle.deriveBits({ name: "ECDH", public: recipient }, eph.privateKey, 256);
  const key = await aesKey(shared, "encrypt");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: utf8.encode(`attest|v1|${kid}`), tagLength: 128 },
    key, utf8.encode(JSON.stringify(body)));
  const epk = new Uint8Array(await crypto.subtle.exportKey("spki", eph.publicKey));
  return { v: 1, alg: ALG, kid, session: (body as { session?: string })?.session ?? "", epk: b64(epk), iv: b64(iv), ct: b64(new Uint8Array(ct)) };
}

/** New P-256 sealing key as PKCS#8 base64 (deno task keygen). */
export async function generateKey(): Promise<string> {
  const k = await crypto.subtle.generateKey(EC, true, ["deriveBits"]) as CryptoKeyPair;
  return b64(new Uint8Array(await crypto.subtle.exportKey("pkcs8", k.privateKey)));
}
