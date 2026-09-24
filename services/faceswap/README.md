# Mock face-swap / deepfake check. Swap the analyze body for a real model; keep /v1/analyze.
#
#   uv run --directory services/faceswap uvicorn app.main:app --host 0.0.0.0 --port 8004
#
# Contract: POST /v1/analyze { session_id, images, meta? } →
#   { swap_score, injection_likely, artifacts, model, mode: "mock" }
#
# Demo: meta.hint containing "swap", "deepfake", or "fail" forces a positive detection.
