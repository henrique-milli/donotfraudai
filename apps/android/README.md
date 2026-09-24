# android

Native onboarding app (Kotlin, CameraX, no Compose): scans the front and back of a Swiss ID card or
residence permit, reads the chip when the card has one, takes a passive selfie, attests the device,
and sends everything sealed and signed to the attest API. The applicant only ever sees guidance.

## What it collects

| Group | Signals |
| --- | --- |
| Presentation attack | screen replay vs print vs physical card, moiré, colour copy, photo tampering |
| Document | front title OCR (DE/FR/IT/RM/EN) + MRZ (TD1, ICAO 7-3-1 check digits with OCR repair), card type vs the one the applicant selected |
| Chip | ICAO chip symbol detected on the card (template matching + geometric verification) → chip read **required** when the phone has NFC; PACE → BAC, DG1 vs printed MRZ, SOD hashes, Document Signer signature |
| Device | hardware key attestation (StrongBox / TEE, verified boot, lock state, app identity), root / hooking / emulator / debugger, risk apps, device profile |
| Behaviour | hand-held micro-motion (gyro), time to capture, guidance events |
| Face | passive selfie + burst frames; active liveness gestures when the API asks for them |

Payload: JSON signed by a hardware-attested P-256 key bound to a server challenge, then sealed to the
API's public key (ECDH-ES P-256 → HKDF-SHA256 → AES-256-GCM). Offline, sealed payloads wait in an outbox.

## Presenter vs production

Debug builds have a **presenter** view (toggle on home and on every capture screen) that shows each
check live for a jury or a demo audience. Release builds do not contain it: signals are collected
silently, so an attacker holding the app gets nothing to iterate against.

## Build

JDK 21, Android SDK 35.

```bash
pnpm lan && pnpm supabase:start && pnpm attest:serve      # API up (repo root)
sh scripts/fetch-backend-key.sh                          # pins the sealing key into local.properties
./gradlew :app:installDebug                              # debug → http://127.0.0.1:54321 (pnpm phone:usb)
./gradlew :app:testDebugUnitTest
```

Other targets: `-PattestBackend=http://<lan-ip>:54321/functions/v1/attest/api/v1` (Wi-Fi) or
`https://<ref>.supabase.co/functions/v1/attest/api/v1` (hosted).
