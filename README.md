# DoNotFraud.ai

Zürich Hackathon 2026 — *Fighting Identity Fraud in the Age of AI*.

How can we outsmart deepfakes so digital **onboarding** and **account recovery** stay fraud-resistant *and* frictionless?

This repo is a local lab, not a product yet. One command starts every surface, binds them to your LAN IP, and lets a phone on the same Wi-Fi talk to the laptop.

## Layout

```
apps/mobile     Expo (camera, secure storage, device APIs)
apps/admin      Next.js console for investigators / humans-in-the-loop
packages/shared Shared TypeScript contracts
services/vision FastAPI — liveness / deepfake / injection stub
services/risk   FastAPI — risk fusion stub
supabase/       Local Auth, Postgres, Storage, Edge Functions
```

Swap a stub for a real model without changing the HTTP contract. Add another service next to `vision` / `risk` and hang it off `pnpm dev`.

## Prerequisites

- Node 20.19+ (Expo SDK 57 prefers Node 22.13+; 20 works for this lab)
- pnpm 9
- Docker (for local Supabase)
- [uv](https://docs.astral.sh/uv/) (already the fastest way to run the Python services)
- Expo Go on the phone ([Android](https://play.google.com/store/apps/details?id=host.exp.exponent) / [iOS](https://apps.apple.com/app/expo-go/id982107779))

## Start the lab

```bash
pnpm install
pnpm dev
```

That script:

1. Detects the laptop LAN IP (override with `LAN_IP=192.168.1.20 pnpm dev`)
2. Writes `.env` files so Expo and Next point at that IP
3. Starts local Supabase if Docker is running (otherwise it continues without it)
4. Hot-reloads admin, Expo, vision, and risk — all bound to `0.0.0.0`

Docker is only required for Auth / Postgres / Studio. Start the daemon, then `pnpm supabase:start`.

| Surface | URL |
| --- | --- |
| Admin console | http://localhost:3000 and `http://<lan-ip>:3000` |
| Expo Metro | `http://<lan-ip>:8081` (QR code in the terminal) |
| Supabase API | `http://<lan-ip>:54321` |
| Supabase Studio | http://localhost:54323 |
| Vision | `http://<lan-ip>:8001/health` |
| Risk | `http://<lan-ip>:8002/health` |

Scan the Expo QR code with Expo Go. The **Lab** tab on the phone probes every backend. If those dots go green, the phone can see the laptop.

## Phone on the same Wi-Fi

This is the default path. `pnpm dev` sets `REACT_NATIVE_PACKAGER_HOSTNAME` so Metro advertises the LAN IP, not `localhost`. Android cleartext HTTP and iOS local networking are already enabled for this lab.

If the phone cannot reach the laptop:

1. **Client isolation** — many guest / conference APs block device-to-device traffic. Use a personal hotspot from the laptop, a home router, or USB (below).
2. **Firewall** — allow inbound 3000, 8081, 54321, 8001, 8002 from the LAN.
3. **Wrong NIC** — Tailscale / Docker / VPN addresses are skipped. Force the Wi-Fi IP with `LAN_IP=… pnpm lan && pnpm dev`.

### USB fallback (Android)

```bash
pnpm phone:usb
LAN_IP=127.0.0.1 pnpm lan
```

`adb reverse` maps the phone's localhost to the laptop. Reload Expo Go.

### Expo tunnel (JS bundle only)

```bash
pnpm dev:tunnel
```

Use this when Metro cannot be reached over LAN. APIs still need LAN or USB — a tunnel does not proxy Supabase or the Python services.

## Day-to-day

```bash
pnpm lan                 # rewrite env files after changing networks
pnpm supabase:status
pnpm supabase:stop
pnpm dev:web             # admin + services, no Expo
```

Python services reload on save via uvicorn. Next and Expo already hot-reload. Edge functions:

```bash
pnpm exec supabase functions serve analyze --no-verify-jwt --env-file .env
```

The function calls `host.docker.internal` so it can reach the host-side vision/risk processes.

## Adding another model service

1. Copy `services/vision`
2. Bind `0.0.0.0` and expose `/health`
3. Add a port in `scripts/lan.mjs` and a line in `scripts/dev.mjs`
4. Publish `EXPO_PUBLIC_*` / `NEXT_PUBLIC_*` in `scripts/write-env.mjs`

Keep contracts in `packages/shared`.

## Security note

Local Supabase listens on `0.0.0.0` so the phone can reach it. That is intentional for a trusted hackathon LAN. Do not do this on a public café network. The keys in `.env.example` are the official local demo JWTs — never ship them.
