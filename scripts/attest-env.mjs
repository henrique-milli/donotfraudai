#!/usr/bin/env node
// Creates supabase/functions/.env (git-ignored) once: the payload-sealing key the phone pins, and the
// analyst console token. Never overwrites an existing file — rotating the key means re-pinning the app.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { webcrypto as crypto } from "node:crypto";
import { PORTS } from "./lan.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dest = join(root, "supabase", "functions", ".env");

if (existsSync(dest)) {
  const cur = readFileSync(dest, "utf8");
  if (!cur.includes("FACESWAP_SERVICE_URL=")) {
    appendFileSync(
      dest,
      `FACESWAP_SERVICE_URL=http://host.docker.internal:${PORTS.faceswap}\nFACESWAP_SERVICE_TOKEN=\n`,
    );
    console.log(`appended FACESWAP_SERVICE_URL to ${dest}`);
  } else if (process.argv.includes("--verbose")) {
    console.log(`kept ${dest}`);
  }
} else {
  const k = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const pkcs8 = Buffer.from(await crypto.subtle.exportKey("pkcs8", k.privateKey)).toString("base64");
  const kid = `k${new Date().toISOString().slice(0, 10).replaceAll("-", "")}`;
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("base64url");
  writeFileSync(
    dest,
    `# Secrets for the attest edge function (local). Hosted: \`supabase secrets set --env-file ...\`.
ATTEST_KEYS={"${kid}":"${pkcs8}"}
ATTEST_ACTIVE_KID=${kid}
ANALYST_TOKEN=${token}
FACE_SERVICE_URL=http://host.docker.internal:${PORTS.face}
FACE_SERVICE_TOKEN=
FACESWAP_SERVICE_URL=http://host.docker.internal:${PORTS.faceswap}
FACESWAP_SERVICE_TOKEN=
`,
    { mode: 0o600 },
  );
  console.log(`created ${dest}\n  analyst token: ${token}   (console sign-in)`);
}
