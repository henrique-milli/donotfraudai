"""
DoNotFraud faceswap / deepfake injection check (MOCK).

Not a trained detector. Same HTTP contract a real model worker should keep so intake
and the lab can swap implementations without churning callers.

  GET  /health, /healthz
  GET  /v1/info
  POST /v1/analyze   images (+ optional meta.hint) → swap_score, injection_likely, artifacts

Demo hints in meta.hint (case-insensitive substring):
  "swap" | "deepfake" | "fail"  → high swap_score, injection_likely
  otherwise                     → low score (treat as live)

Replace the body of analyze() with a real CV stack; keep the request/response shape.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import os

SERVICE = "faceswap"
VERSION = "0.1.0"
MODE = "mock"
TOKEN = os.environ.get("FACESWAP_SERVICE_TOKEN", "")

app = FastAPI(title="DoNotFraud faceswap (mock)", version=VERSION)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def auth(authorization: str = Header(default="")):
    if TOKEN and authorization != f"Bearer {TOKEN}":
        raise HTTPException(401, "invalid token")


class AnalyzeIn(BaseModel):
    session_id: str = ""
    images: dict[str, str] = Field(default_factory=dict, description="name → base64 JPEG/PNG")
    meta: dict[str, Any] = Field(default_factory=dict)


class AnalyzeOut(BaseModel):
    swap_score: float = Field(ge=0.0, le=1.0, description="higher = more likely face-swap / deepfake")
    injection_likely: bool
    artifacts: list[str]
    model: str
    mode: str = MODE
    frames_scored: int = 0


@app.get("/healthz")
def healthz():
    return {"ok": True}


@app.get("/health")
def health():
    return {
        "service": SERVICE,
        "ok": True,
        "version": VERSION,
        "mode": MODE,
        "time": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/v1/info", dependencies=[Depends(auth)])
def info():
    return {
        "service": SERVICE,
        "mode": MODE,
        "model": f"{SERVICE}-{MODE}",
        "contract": {
            "POST /v1/analyze": {
                "in": ["session_id", "images", "meta?"],
                "out": ["swap_score", "injection_likely", "artifacts", "model", "mode"],
            }
        },
        "note": "Mock: meta.hint containing swap|deepfake|fail forces a positive detection.",
    }


@app.post("/v1/analyze", response_model=AnalyzeOut, dependencies=[Depends(auth)])
def analyze(body: AnalyzeIn) -> AnalyzeOut:
    """Placeholder for a real face-swap / deepfake stack. Keep this contract stable."""
    hint = str(body.meta.get("hint", "")).lower()
    frames = len(body.images)
    if any(k in hint for k in ("swap", "deepfake", "fail")):
        return AnalyzeOut(
            swap_score=0.91,
            injection_likely=True,
            artifacts=["face_swap_residuals", "temporal_inconsistency"],
            model=f"{SERVICE}-{MODE}",
            frames_scored=frames,
        )
    return AnalyzeOut(
        swap_score=0.08,
        injection_likely=False,
        artifacts=[],
        model=f"{SERVICE}-{MODE}",
        frames_scored=frames,
    )
