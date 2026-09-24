# attest — onboarding API (Supabase Edge Function)

Intake of sealed onboarding sessions, server-side verification, risk scoring, active-liveness
step-up and the analyst API behind `/triage`. Deno; runs on Supabase or standalone.

## Routes

| | Auth | |
| --- | --- | --- |
| `GET /v1/keys` | — | active sealing public key (SPKI) the app pins |
| `POST /v1/challenges` | — | single-use attestation challenge (15 min) |
| `POST /v1/sessions` | sealed payload | `{session, route}` — never the reasons |
| `POST /v1/sessions/:id/next` | resume token | `NONE` or `ACTIVE_LIVENESS` with random gestures |
| `GET /analyst/cases`, `/cases/:n`, `/faces`, `/audit`, `/stats` | `x-analyst-token` | console read models |
| `POST /analyst/cases/:n/decision` | `x-analyst-token` | `APPROVE` / `REQUEST_VERIFICATION` / `ESCALATE` / `REJECT` |
| `GET /analyst/cases/:n/images/:kind` | `x-analyst-token` | image bytes (Storage or DB) |

The prefixes `/functions/v1`, `/attest` and `/api` are stripped, so `…/functions/v1/attest/api/v1/sessions`
and `localhost:8000/api/v1/sessions` hit the same route.

## What the server checks

1. **Envelope** — ECDH-ES P-256 → HKDF-SHA256 → AES-256-GCM, AAD bound to the key id.
2. **Signature** — ECDSA over the exact payload bytes by the leaf of the Android key-attestation chain.
3. **Chain + KeyDescription** — each certificate signed by the next, optional Google root pinning,
   security level, verified boot, lock state and the attested challenge re-parsed from the certificate.
4. **Challenge** — issued here, unexpired, single use.
5. **App identity** — attested package name and signing certificate.
6. **History** — document previously rejected, identities per attested device.
7. **Face** — via `services/face`: one face, passive liveness over selfie + burst, 1:1 against the chip
   photo (else the printed portrait), printed vs chip photo, 1:N face clusters across documents.

Score = per-group capped sum of fired risk points; any FAIL in a hard-stop group → HIGH.
LOW → continue, MEDIUM → active liveness, HIGH → manual review. Policy values: `_shared/policy.ts`.
Every step is appended to a SHA-256 hash chain (`attest.audit_events`, append-only by trigger).

## Secrets

| | |
| --- | --- |
| `ATTEST_KEYS` | `{"<kid>": "<PKCS#8 base64>"}` — several keys allowed for rotation |
| `ATTEST_ACTIVE_KID` | key served by `/v1/keys` |
| `ANALYST_TOKEN` | console token (≥ 16 chars; shorter disables the analyst API) |
| `ANALYST_ORIGIN` | CORS origin of the console (default `*`) |
| `FACE_SERVICE_URL`, `FACE_SERVICE_TOKEN` | face service |
| `DATABASE_URL` | only outside Supabase (inside, `SUPABASE_DB_URL` is used) |
| `ATTEST_IMAGES_IN_DB=1` | keep images in Postgres instead of Storage |

`pnpm lan` writes a fresh `supabase/functions/.env` once; `deno task keygen` prints a new key.

## Tasks

```bash
deno task serve                  # standalone on :8000 (needs DATABASE_URL)
deno task seed-demo              # six synthetic, flagged sessions through the real intake
deno task verify-audit           # walk the hash chain, exit 1 if broken
deno task rebuild-face-clusters  # recompute 1:N identities from the face gallery
bash tests/run.sh                # tests on a throwaway pgvector container
```
