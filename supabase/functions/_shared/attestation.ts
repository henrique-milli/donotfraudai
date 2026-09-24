/**
 * Server-side verification of what the phone claims about itself. The app parses its own key
 * attestation for display; the server trusts only what it can verify:
 *   1. payload signature — ECDSA over the exact payload bytes, by the leaf key of the chain
 *   2. chain — each certificate signed by the next; root compared to pinned Google roots
 *   3. KeyDescription — re-parsed from the leaf certificate (not taken from the payload)
 *   4. challenge — equals the attested challenge; issued here, unexpired, never used before
 *   5. app identity — attested package name / signing certificate
 */
import * as x509 from "npm:@peculiar/x509@1.12.3";
import { p256, p384, p521 } from "npm:@noble/curves@1.9.1/nist";
import { children, int, parse, type Tlv } from "./der.ts";
import { policy } from "./policy.ts";
import type { Sql } from "./db.ts";
import { hex, sha256Hex, unb64, utf8 } from "./util.ts";

x509.cryptoProvider.set(crypto);

const OID = "1.3.6.1.4.1.11129.2.1.17";
const LEVELS: Record<number, string> = { 0: "Software", 1: "TEE", 2: "StrongBox" };
const BOOT: Record<number, string> = { 0: "Verified", 1: "SelfSigned", 2: "Unverified", 3: "Failed" };

export interface KeyDescription {
  attestationVersion: number; securityLevel: string; challenge: Uint8Array;
  deviceLocked: boolean | null; verifiedBoot: string; bootKeySha256: string; osPatchLevel: number | null;
  appPackage: string | null; appSigners: string[];
}

export interface Verification {
  signed: boolean; signatureOk: boolean | null; chainOk: boolean | null; rootPinned: boolean | null;
  challengeOk: boolean | null; challengeStatus: string; appOk: boolean | null; key: KeyDescription | null; errors: string[];
}

export async function parseKeyDescription(leaf: x509.X509Certificate): Promise<KeyDescription | null> {
  const ext = leaf.getExtension(OID);
  if (!ext) return null;
  let raw = new Uint8Array(ext.value);
  let [top] = parse(raw);
  if (top.tag === 0x04 && top.cls === 0) { raw = new Uint8Array(top.value); [top] = parse(raw); } // unwrap OCTET STRING if present
  const seq = children(top);
  const kd: KeyDescription = {
    attestationVersion: int(seq[0]), securityLevel: LEVELS[int(seq[1])] ?? String(int(seq[1])), challenge: seq[4].value,
    deviceLocked: null, verifiedBoot: "unknown", bootKeySha256: "", osPatchLevel: null, appPackage: null, appSigners: [],
  };
  const software = children(seq[6]), hardware = children(seq[7]);
  const find = (lst: Tlv[], tag: number): Tlv | null => {
    const t = lst.find((x) => x.cls === 2 && x.tag === tag);
    return t ? parse(t.value)[0] : null; // explicit tagging: one inner TLV
  };
  const rot = find(hardware, 704);
  if (rot) {
    const f = children(rot);
    kd.bootKeySha256 = await sha256Hex(f[0].value);
    kd.deviceLocked = f[1].value[0] !== 0;
    kd.verifiedBoot = BOOT[int(f[2])] ?? String(int(f[2]));
  }
  const patch = find(hardware, 706) ?? find(software, 706);
  kd.osPatchLevel = patch ? int(patch) : null;
  const app = find(software, 709) ?? find(hardware, 709);
  if (app) {
    try {
      const inner = children(parse(app.value)[0]);
      const infos = children(inner[0]);
      if (infos.length) kd.appPackage = new TextDecoder().decode(children(infos[0])[0].value);
      kd.appSigners = children(inner[1]).map((d) => hex(d.value));
    } catch { /* malformed application id: leave empty */ }
  }
  return kd;
}

/** DER ECDSA signature (what Android produces) → IEEE P1363 r||s (what WebCrypto verifies). */
export function derToP1363(sig: Uint8Array, size = 32): Uint8Array {
  const [seq] = parse(sig);
  const [r, s] = children(seq).map((t) => t.value);
  const out = new Uint8Array(size * 2);
  const put = (v: Uint8Array, off: number) => { const x = v.length > size ? v.subarray(v.length - size) : v; out.set(x, off + size - x.length); };
  put(r, 0); put(s, size);
  return out;
}

// Certificate signatures are checked at the DER level: Android chains mix curves and hashes (a P-384
// intermediate signing with ecdsa-with-SHA256), which WebCrypto's ECDSA does not implement in Deno.
const OIDHEX = {
  ecdsaSha256: "2a8648ce3d040302", ecdsaSha384: "2a8648ce3d040303", ecdsaSha512: "2a8648ce3d040304",
  rsaSha256: "2a864886f70d01010b", rsaSha384: "2a864886f70d01010c", rsaSha512: "2a864886f70d01010d",
  p256: "2a8648ce3d030107", p384: "2b81040022", p521: "2b81040023",
};
const HASH: Record<string, string> = {
  [OIDHEX.ecdsaSha256]: "SHA-256", [OIDHEX.ecdsaSha384]: "SHA-384", [OIDHEX.ecdsaSha512]: "SHA-512",
  [OIDHEX.rsaSha256]: "SHA-256", [OIDHEX.rsaSha384]: "SHA-384", [OIDHEX.rsaSha512]: "SHA-512",
};
const CURVE: Record<string, { verify: (sig: Uint8Array, hash: Uint8Array, pub: Uint8Array, o: object) => boolean; size: number }> = {
  [OIDHEX.p256]: { verify: p256.verify, size: 32 }, [OIDHEX.p384]: { verify: p384.verify, size: 48 }, [OIDHEX.p521]: { verify: p521.verify, size: 66 },
};

export async function verifyCert(cert: x509.X509Certificate, issuer: x509.X509Certificate): Promise<boolean> {
  try {
    const [outer] = parse(new Uint8Array(cert.rawData));
    const [, tbsEnd] = parse(outer.value);
    const tbs = outer.value.subarray(0, tbsEnd);
    const [, algTlv, sigTlv] = children(outer);
    const alg = hex(children(algTlv)[0].value);
    const sig = sigTlv.value.subarray(1); // BIT STRING: skip the unused-bits byte
    const hash = HASH[alg];
    if (!hash) return false;
    const spki = new Uint8Array(issuer.publicKey.rawData);
    if (alg.startsWith("2a8648ce3d0403")) {
      const [algId, bits] = children(parse(spki)[0]);
      const curve = CURVE[hex(children(algId)[1]?.value ?? new Uint8Array())];
      if (!curve) return false;
      const digest = new Uint8Array(await crypto.subtle.digest(hash, new Uint8Array(tbs)));
      return curve.verify(derToP1363(sig, curve.size), digest, bits.value.subarray(1), { prehash: false, lowS: false });
    }
    const key = await crypto.subtle.importKey("spki", spki, { name: "RSASSA-PKCS1-v1_5", hash }, false, ["verify"]);
    return await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, new Uint8Array(sig), new Uint8Array(tbs));
  } catch {
    return false;
  }
}

let pinned: string[] | null = null;
async function googleRoots(): Promise<string[]> {
  if (pinned) return pinned;
  const pem = policy.attestation.googleRootsPem;
  pinned = pem ? await Promise.all(pem.split(/(?=-----BEGIN CERTIFICATE-----)/).filter((p) => p.includes("BEGIN"))
    .map(async (p) => await sha256Hex(new Uint8Array(new x509.X509Certificate(p).publicKey.rawData)))) : [];
  return pinned;
}

// deno-lint-ignore no-explicit-any
export async function verify(sql: Sql, body: { payload: string; sig: string | null }, payload: any): Promise<Verification> {
  const v: Verification = { signed: false, signatureOk: null, chainOk: null, rootPinned: null, challengeOk: null,
    challengeStatus: "absent", appOk: null, key: null, errors: [] };
  const att = payload.attestation ?? {};
  const ka = att.keyAttestation ?? {};
  let chain: x509.X509Certificate[] = [];
  try {
    chain = (ka.chain ?? []).map((c: string) => new x509.X509Certificate(unb64(c)));
  } catch (e) { v.errors.push(`chain unreadable: ${(e as Error).name}`); }

  // 1. signature over the exact payload bytes
  v.signed = !!body.sig;
  if (body.sig && chain.length) {
    try {
      const key = await chain[0].publicKey.export({ name: "ECDSA", namedCurve: "P-256" }, ["verify"]);
      v.signatureOk = await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        key,
        new Uint8Array(derToP1363(unb64(body.sig))),
        utf8.encode(body.payload),
      );
    } catch { v.signatureOk = false; }
  } else if (body.sig) {
    v.signatureOk = false; v.errors.push("signature present but no certificate chain");
  }

  // 2. chain + 3. key description
  if (chain.length) {
    let ok = chain.length >= 2;
    for (let i = 0; i + 1 < chain.length; i++) ok = ok && await verifyCert(chain[i], chain[i + 1]);
    v.chainOk = ok;
    const roots = await googleRoots();
    if (roots.length) v.rootPinned = roots.includes(await sha256Hex(new Uint8Array(chain[chain.length - 1].publicKey.rawData)));
    try { v.key = await parseKeyDescription(chain[0]); } catch (e) { v.errors.push(`key description unreadable: ${(e as Error).name}`); }
  }

  // 4. challenge
  const claimed: string | undefined = att.challenge;
  if (v.key && claimed) {
    const same = unb64(claimed).length === v.key.challenge.length && unb64(claimed).every((b, i) => b === v.key!.challenge[i]);
    if (!same) { v.challengeOk = false; v.challengeStatus = "mismatch"; }
    else {
      const [ch] = await sql`select id, expires_at, used_at from attest.challenges where value = ${claimed}`;
      if (!ch) { v.challengeStatus = "local"; v.challengeOk = !policy.challenge.requireServerIssued; }
      else if (ch.used_at) { v.challengeOk = false; v.challengeStatus = "replayed"; }
      else if (new Date(ch.expires_at) < new Date()) { v.challengeOk = false; v.challengeStatus = "expired"; }
      else {
        await sql`update attest.challenges set used_at = now() where id = ${ch.id}`;
        v.challengeOk = true; v.challengeStatus = "server-issued";
      }
    }
  }

  // 5. app identity
  if (v.key?.appPackage) {
    const a = policy.attestation;
    v.appOk = a.trustedAppPackages.includes(v.key.appPackage) &&
      (!a.trustedAppSigners.length || v.key.appSigners.some((s) => a.trustedAppSigners.includes(s)));
  }
  return v;
}
