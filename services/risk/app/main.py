from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

SERVICE = "risk"
VERSION = "0.1.0"

app = FastAPI(title="DoNotFraud risk", version=VERSION)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ScoreRequest(BaseModel):
    session_id: str
    purpose: Literal["onboarding", "account_recovery"] = "onboarding"
    liveness_score: float = 0.0
    deepfake_score: float = 0.0
    injection_likely: bool = False
    device: dict[str, Any] = Field(default_factory=dict)


class ScoreResponse(BaseModel):
    score: float
    decision: Literal["allow", "review", "deny"]
    signals: dict[str, Any]
    model: str


def fuse(body: ScoreRequest) -> ScoreResponse:
    score = (
        body.deepfake_score * 0.55
        + (1.0 - body.liveness_score) * 0.3
        + (0.15 if body.injection_likely else 0.0)
    )
    score = max(0.0, min(1.0, score))
    if score >= 0.75:
        decision: Literal["allow", "review", "deny"] = "deny"
    elif score >= 0.35:
        decision = "review"
    else:
        decision = "allow"
    return ScoreResponse(
        score=round(score, 3),
        decision=decision,
        signals={
            "liveness_score": body.liveness_score,
            "deepfake_score": body.deepfake_score,
            "injection_likely": body.injection_likely,
            "purpose": body.purpose,
        },
        model=f"{SERVICE}-stub",
    )


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "service": SERVICE,
        "ok": True,
        "version": VERSION,
        "time": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/v1/score", response_model=ScoreResponse)
def score(body: ScoreRequest) -> ScoreResponse:
    return fuse(body)
