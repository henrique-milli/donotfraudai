# face

Open-source face service: detection, embeddings, passive liveness, 1:1 verification and the 1:N
gallery. Used by the attest edge function; images are processed in memory and never stored here.

| Job | Model | Licence |
|---|---|---|
| Detection + 5 landmarks | YuNet (OpenCV Zoo) | MIT |
| Embedding (128-d, cosine) | SFace (OpenCV Zoo) | Apache-2.0 |
| Passive anti-spoofing | MiniFASNetV2 + V1SE (minivision Silent-Face-Anti-Spoofing) | Apache-2.0 |

Models are downloaded with pinned SHA-256 and converted to ONNX by `tools/build_face_models.py`
(`pnpm face:models`, or the Dockerfile's builder stage); they are not committed. Runtime is OpenCV DNN, no torch.

## API (bearer token `FACE_SERVICE_TOKEN`; empty = no auth, local only)

| | |
|---|---|
| `GET /health` | lab probe (no auth) |
| `POST /v1/analyze` | `{images: {name: b64}, liveness: [names]}` → faces, box, landmarks, yaw, roll, embedding, liveness |
| `POST /v1/verify` | 1:1: embedding vs embedding, or vs a stored template id |
| `POST /v1/gallery/templates` | enroll `{subject, kind, embedding, tags, created_at}` → id |
| `POST /v1/gallery/search` | 1:N by embedding or template id; filters `kinds`, `tags_eq`, `tags_ne`, `exclude_subjects`, `before`, `min_score` |
| `DELETE /v1/gallery/subjects/{subject}` | erase a subject's templates |

Gallery: Postgres + pgvector (HNSW, cosine) when `FACE_GALLERY_DSN` is set (schema `face`, see
`supabase/migrations`), else SQLite at `FACE_GALLERY_SQLITE`.

```bash
uv run uvicorn app.main:app --port 8003 --reload
uv run pytest -q          # FACE_TEST_PG_DSN=... also runs the gallery tests on pgvector
```
