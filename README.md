# DoNotFraud.ai

Zürich Hackathon 2026 — *Fighting Identity Fraud in the Age of AI*.

How can we outsmart deepfakes so digital **onboarding** and **account recovery** stay fraud-resistant *and* frictionless?

An Android onboarding app, a Supabase-hosted risk API, an open-source face service and an analyst console. One command starts the lab, binds it to your LAN IP, and lets a phone on the same Wi-Fi talk to the laptop.

## Layout

```
apps/android    Native Android onboarding app: Swiss ID / residence permit, chip, device attestation, sealed sessions
apps/admin      Next.js L1 fraud-triage console (/triage)
packages/shared Shared TypeScript contracts
services/face   FastAPI — open-source face engine: detection, passive liveness, 1:1, 1:N on pgvector
services/faceswap FastAPI — face-swap / deepfake check (**mock** contract; swap for a real model)
supabase/       Postgres (+pgvector), Storage, the attest Edge Function
```

## The attest pipeline

```
phone ── POST /v1/challenges ─────────────► single-use challenge
phone: hardware-attested key bound to it · scan front/back · chip read when the card has one
phone ── POST /v1/face-challenges ────────► random actions, issued at selfie time (always one head turn)
phone: neutral selfie + one frame per action
phone ── POST /v1/sessions {sealed} ─────► verify signature + attestation chain · face 1:1/1:N/liveness
                                            · faceswap/deepfake · score · route: CONTINUE / MANUAL_REVIEW / BRANCH_VISIT
phone ── POST /v1/sessions/:id/next ─────► NONE | ACTIVE_LIVENESS {random gestures}  (analyst step-up)
analyst ── /triage ──────────────────────► queue · signals · images · recommendation · decision · audit
```

| Piece | Where | Notes |
| --- | --- | --- |
| Capture + on-device signals | `apps/android` | Presentation-attack checks, MRZ/OCR classification, ICAO chip symbol detection, chip read (PACE/BAC, passive authentication), device integrity, key attestation. Payload sealed to the API key (ECDH-ES P-256 + AES-256-GCM) and signed by the attested key |
| API + risk engine | `supabase/functions/attest` | Deno Edge Function. Re-verifies everything the phone claims, rescoring from raw signals; the phone only ever learns its route |
| Face engine | `services/face` | YuNet · SFace · MiniFASNet (MIT / Apache-2.0), OpenCV DNN, no torch at runtime |
| Face-swap / deepfake | `services/faceswap` | **Mock** today (`mode: mock`); stable `POST /v1/analyze` contract for a real detector |
| Data | `supabase/migrations` | Private schemas `attest` (cases, signals, hash-chained audit) and `face` (pgvector HNSW gallery), private bucket `case-images` |
| Console | `apps/admin/src/app/triage` | Queue, case view, face clusters, audit trail; shared analyst token |

Neither private schema is exposed through the Data API; only the edge function reaches them.

## What it stops

| Attack | Impact if missed | What catches it |
| --- | --- | --- |
| **Chip downgrade**: a chipped card, but the attacker skips the chip and goes through the photo-only path | The strong check is optional, so fraud takes the weak one; both end in the same identity | The ICAO chip symbol is detected on the card itself. When it's there and the phone has NFC, the chip read is **required**: DG1 must match the printed MRZ and the issuer's signature must verify. A refused tap is scored and routed, not waved through |
| **Screen replay / print / colour copy** of a real card | Account opened with someone else's document | On-device presentation-attack checks (physical vs screen vs paper, moiré, colourfulness), reported as signals, never silently dropped |
| **Photo substitution** on a genuine card | Impostor's face on a real document | Printed portrait vs the chip's signed DG2 photo; selfie matched 1:1 against the chip photo first |
| **Deepfake / face-swap / replayed selfie** | Face check passed without a live person | **Randomized actions on every selfie**: 3 of turn left/right, tilt left/right, move closer/further, always with one head turn, drawn by the server when the camera opens. The phone signs the challenge id; the server consumes it once and re-measures each action from its own face analysis (yaw, roll, face size vs the neutral selfie). A pre-recorded clip can't know the order. A live swap has to hold up through the turn, which is where these models, trained on frontal faces, lose tracking; every frame must stay the same face. Passive liveness and the **faceswap service** (`services/faceswap`, mock contract today) run on every frame. An analyst can request a second, new sequence |
| **One face, many documents** (mules, synthetic identities) | One fraudster opens many accounts | 1:N over live selfies clusters faces across sessions. The console shows how many documents each face has tried, and flags a document already presented by a different face |
| **Emulator, rooted phone, hooking, injected camera** | Everything above is bypassed at the source | Hardware key attestation (StrongBox/TEE, verified boot, lock state, app identity), re-parsed on the server from the certificate chain. Root, hook, emulator and debugger checks, plus a boot-state consistency check (OS properties vs attested boot) |
| **Tampered or replayed payload** | Forged signals reach the backend | Payload signed by the attested key over a single-use server challenge, sealed with ECDH-ES P-256 + AES-256-GCM. The server rescores from raw signals; the phone's own score is advisory |
| **Oracle probing**: retrying until the checks pass | The attacker learns the thresholds | The phone only learns a route (auto-approve / online review / branch visit), never scores or reasons. Release builds collect silently, and the verbose presenter view is compiled out |

The analyst sees the evidence, a rule-based recommendation with "why not approve / why not reject", and a decision bar. Every step is written to a hash-chained, append-only audit trail.

## How it was validated

- **Real hardware (Pixel 6)**: sessions ingested end to end through the first (Python) version of this backend. The Deno port was then checked against the same material: an envelope sealed by the Python code opens, and the device's 4-certificate StrongBox chain verifies with the same KeyDescription. The unlocked bootloader is reported from the attested boot state, and root is detected despite a hidden Magisk. Repeated onboarding attempts by the same person (four sessions) were linked into one face cluster.
- **Chip symbol detector**: tested on one card design only (4 captures). The symbol scores 0.31–0.71, the same card with the symbol removed scores ≤ 0.20, and the back side ≤ 0.04. The threshold is 0.25. More card designs are needed before this number means much.
- **Face engine**: SFace match threshold 0.363 (the model's published operating point). On the public Silent-Face samples, a real face shown on a tablet matches the person (0.59) but fails liveness (0.002).
- **Automated**: API tests on a throwaway pgvector Postgres (`pnpm attest:test`): routing of six attack scenarios, audit chain tamper detection, 1:N linking, analyst decisions, and mixed-curve attestation chains. Face service tests, and Android unit tests for the MRZ, classifier, attestation and envelope code.
- **Demo data**: `pnpm attest:seed` cases are **synthetic** and flagged as such in the console.

## Where training data would help

Every risk weight today is **hand-set**, not learned. With labelled internal sessions (confirmed fraud vs good customers), you would:

1. Fit the signal weights and the LOW/MEDIUM/HIGH cut-offs to hit a target error rate (ISO/IEC 30107-3 APCER/BPCER) instead of guessing them.
2. Retrain passive liveness and screen-vs-print on the real capture devices and card designs, where the published models are weakest.
3. Calibrate the 1:N same-person threshold on the real population, so clusters don't merge look-alikes.
4. Learn the capture-behaviour signals (hand-held motion, timing) from real sessions, where they are currently heuristics.

The per-session signals are already stored in a form a model can train on (`attest.signals`, one row per signal, with the analyst's decision as the label).

## Prerequisites

- Node 20.19+
- pnpm 9
- Docker (for local Supabase and the face models build)
- [uv](https://docs.astral.sh/uv/) (already the fastest way to run the Python services)
- [Deno 2](https://deno.com) for the attest tools (`pnpm attest:seed`); the function itself runs in Supabase's edge runtime
- For `apps/android`: JDK 21, Android SDK 35 — see [apps/android](apps/android/README.md)

## Start the lab

```bash
pnpm install
pnpm face:models        # once: downloads + converts the open-source face models (Docker)
pnpm dev
pnpm attest:serve       # second terminal: edge functions with the attest secrets
```

`pnpm dev`:

1. Detects the laptop LAN IP (override with `LAN_IP=192.168.1.20 pnpm dev`)
2. Writes `.env` files so the console points at that IP, and creates `supabase/functions/.env` once (sealing key + analyst token, printed on creation)
3. Starts local Supabase if Docker is running (otherwise it continues without it)
4. Hot-reloads the console and the face service, both bound to `0.0.0.0`

Docker is only required for Auth / Postgres / Studio. Start the daemon, then `pnpm supabase:start`.

| Surface | URL |
| --- | --- |
| Fraud triage console | http://localhost:3000/triage (sign in with `ANALYST_TOKEN` from `supabase/functions/.env`) |
| Supabase API | `http://<lan-ip>:54321` |
| Attest API | `http://<lan-ip>:54321/functions/v1/attest` |
| Supabase Studio | http://localhost:54323 |
| Face | `http://<lan-ip>:8003/health` |
| Faceswap (mock) | `http://<lan-ip>:8004/health` |

Empty queue? `pnpm attest:seed` pushes six synthetic, clearly flagged sessions (screen replay, chip downgrade, emulator, rooted phone, B/W copy, clean chip read) through the real intake path.

### Without the Supabase CLI

```bash
docker compose --profile standalone up -d    # face + pgvector Postgres + the attest API on :8000 (ATTEST_API_PORT=… to move it)
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54399/postgres pnpm attest:seed
```

Same migrations, same function code (plain Deno), images kept in Postgres instead of Storage. Point the Android app at it with `-PattestBackend=http://<lan-ip>:8000/api/v1`.

## Phone on the same Wi-Fi

Build the app against the laptop: `./gradlew :app:installDebug -PattestBackend=http://<lan-ip>:54321/functions/v1/attest/api/v1` (see [apps/android](apps/android/README.md)). Debug builds allow cleartext HTTP; release builds are TLS-only.

If the phone cannot reach the laptop:

1. **Client isolation** — many guest / conference APs block device-to-device traffic. Use a personal hotspot from the laptop, a home router, or USB (below).
2. **Firewall** — allow inbound 3000 and 54321 from the LAN.
3. **Wrong NIC** — Tailscale / Docker / VPN addresses are skipped. Force the Wi-Fi IP with `LAN_IP=… pnpm lan && pnpm dev`.

### USB fallback

```bash
pnpm phone:usb
```

`adb reverse` maps the phone's `localhost:54321` to the laptop. The debug build targets `127.0.0.1:54321` by default, so it works over USB as is.

## Day-to-day

```bash
pnpm lan                 # rewrite env files after changing networks
pnpm supabase:status
pnpm supabase:stop
pnpm attest:test         # API tests against a throwaway pgvector Postgres (Docker)
```

The face service reloads on save via uvicorn, the console via Next. `pnpm attest:serve` runs the edge function; it reaches the host-side face service through `host.docker.internal`.

## Deploy

Supabase runs the data layer and the API; the face service is a container anywhere.

```bash
supabase link --project-ref <ref>
supabase db push                                         # attest + face schemas, pgvector gallery, bucket
supabase secrets set --env-file supabase/functions/.env  # with FACE_SERVICE_URL/TOKEN of the hosted face service
supabase functions deploy attest --no-verify-jwt
```

| Piece | Where | Configuration |
| --- | --- | --- |
| attest API | Supabase Edge Functions | `ATTEST_KEYS`, `ATTEST_ACTIVE_KID`, `ANALYST_TOKEN`, `ANALYST_ORIGIN`, `FACE_SERVICE_URL`, `FACE_SERVICE_TOKEN` (DB and Storage credentials are injected by Supabase) |
| Face service | any container host (`services/face/Dockerfile`) | `FACE_SERVICE_TOKEN`, `FACE_GALLERY_DSN` = the project's Postgres connection string (gallery in schema `face`) |
| Console | Vercel or any Next host (`apps/admin`) | `NEXT_PUBLIC_ATTEST_API_URL=https://<ref>.supabase.co/functions/v1/attest` |
| Android app | `./gradlew assembleRelease -PattestBackend=https://<ref>.supabase.co/functions/v1/attest/api/v1` | pin the sealing key first: `pnpm android:key https://<ref>.supabase.co/functions/v1/attest` |

## Adding another model service

1. Copy `services/face` (FastAPI, `uv`, `/health`)
2. Bind `0.0.0.0`, add a port in `scripts/lan.mjs` and a line in `scripts/dev.mjs`
3. Call it from `supabase/functions/_shared` and keep the contract in `packages/shared`

## Security note

Local Supabase listens on `0.0.0.0` so the phone can reach it. That is intentional for a trusted hackathon LAN. Do not do this on a public café network.

The attest secrets (`supabase/functions/.env`) are generated per machine and never committed. The triage console uses one shared analyst token — fine for a demo, not for production (use Supabase Auth with per-analyst accounts). Applicant-facing responses carry only a route, never scores or reasons, so the phone cannot be used as an oracle to tune an attack.
