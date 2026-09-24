from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

SERVICE = "vision"
VERSION = "0.1.0"

app = FastAPI(title="DoNotFraud vision", version=VERSION)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class AnalyzeRequest(BaseModel):
    session_id: str
    kind: str = Field(description="selfie | id_document")
    meta: dict[str, Any] = Field(default_factory=dict)


class AnalyzeResponse(BaseModel):
    liveness_score: float
    deepfake_score: float
    injection_likely: bool
    artifacts: list[str]
    model: str


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "service": SERVICE,
        "ok": True,
        "version": VERSION,
        "time": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/v1/analyze", response_model=AnalyzeResponse)
def analyze(body: AnalyzeRequest) -> AnalyzeResponse:
    """Placeholder for a real CV / deepfake stack.

    Swap this body for ONNX, a GPU worker, or an external model API.
    Keep the contract so mobile + admin do not churn.
    """
    hint = str(body.meta.get("hint", "")).lower()
    if "fail" in hint:
        return AnalyzeResponse(
            liveness_score=0.12,
            deepfake_score=0.91,
            injection_likely=True,
            artifacts=["replay_moiré", "face_swap_residuals"],
            model=f"{SERVICE}-stub",
        )
    return AnalyzeResponse(
        liveness_score=0.88,
        deepfake_score=0.07,
        injection_likely=False,
        artifacts=[],
        model=f"{SERVICE}-stub",
    )
