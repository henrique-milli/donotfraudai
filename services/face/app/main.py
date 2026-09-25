"""
DoNotFraud face service. Open-source models only (YuNet, SFace, MiniFASNet); no vendor code.

  GET    /health, /healthz                 liveness probe (no auth)
  GET    /v1/info                          models, thresholds, gallery backend
  POST   /v1/analyze                       images → faces, pose, embedding, passive liveness
  POST   /v1/verify                        1:1: two embeddings, or an embedding vs a stored template
  POST   /v1/gallery/templates             enroll an embedding (1:N)
  POST   /v1/gallery/search                1:N search with filters
  DELETE /v1/gallery/subjects/{subject}    erase every template of a subject (right to erasure)

Embeddings travel as base64 float32×128. Images are processed in memory and never stored.
"""
from __future__ import annotations

import base64
import binascii
from functools import lru_cache
from typing import Dict, List, Optional

import numpy as np
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import config
from . import engine as fe
from .gallery import Query, open_gallery

SERVICE = "face"
VERSION = "0.1.0"

app = FastAPI(title="DoNotFraud face", version=VERSION)
# the lab console probes /health from the browser; every other route needs the bearer token
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"])


def auth(authorization: str = Header(default="")):
    if config.TOKEN and authorization != f"Bearer {config.TOKEN}":
        raise HTTPException(401, "invalid token")


def engine() -> fe.Engine:
    e = fe.Engine.get()
    if e is None:
        raise HTTPException(503, "face models not installed")
    return e


@lru_cache(maxsize=1)
def gallery():
    return open_gallery(config.GALLERY_DSN, config.GALLERY_SQLITE)


def _emb(s: str) -> np.ndarray:
    try:
        v = fe.from_b64(s)
    except (ValueError, binascii.Error):
        raise HTTPException(422, "embedding must be base64 of 128 float32")
    return v / (np.linalg.norm(v) + 1e-9)


# ---------------------------------------------------------------------- health

@app.get("/healthz")
def healthz():
    return {"ok": True}


@app.get("/health")
def health():
    from datetime import datetime, timezone

    return {"service": SERVICE, "ok": True, "version": VERSION, "time": datetime.now(timezone.utc).isoformat(),
            "models": fe.Engine.get() is not None}


@app.get("/v1/info", dependencies=[Depends(auth)])
def info():
    e = fe.Engine.get()
    return {
        "models": {"detector": "YuNet 2023mar (MIT)", "embedding": "SFace 2021dec (Apache-2.0)",
                   "antiSpoofing": "MiniFASNetV2 + MiniFASNetV1SE (Apache-2.0)"},
        "ready": e is not None, "liveness": bool(e and e.liveness_available),
        "thresholds": {"match": fe.MATCH_THRESHOLD, "search": fe.SEARCH_THRESHOLD,
                       "livePass": fe.LIVE_PASS, "liveFail": fe.LIVE_FAIL},
        "gallery": "pgvector" if config.GALLERY_DSN else "sqlite",
    }


# ---------------------------------------------------------------------- analysis

class AnalyzeIn(BaseModel):
    images: Dict[str, str] = Field(description="name → base64 JPEG/PNG")
    liveness: List[str] = Field(default_factory=list, description="names to run passive anti-spoofing on")


@app.post("/v1/analyze", dependencies=[Depends(auth)])
def analyze(body: AnalyzeIn):
    e = engine()
    out = {}
    for name, b64 in body.images.items():
        try:
            data = base64.b64decode(b64, validate=True)
        except (binascii.Error, ValueError):
            raise HTTPException(422, f"{name}: not base64")
        if len(data) > config.MAX_IMAGE_BYTES:
            raise HTTPException(413, f"{name}: image too large")
        p = fe.probe(e, name, data, liveness=name in body.liveness)
        out[name] = {
            "faces": p.faces,
            "size": list(p.size) if p.size else None,
            "face": None if p.face is None else {
                "box": [float(x) for x in p.face.box], "landmarks": p.face.landmarks.round(2).tolist(),
                "score": p.face.score, "yaw": fe.Engine.yaw(p.face), "roll": fe.Engine.roll(p.face),
            },
            "embedding": fe.to_b64(p.embedding) if p.embedding is not None else None,
            "liveness": p.live,
        }
    return {"results": out}


class VerifyIn(BaseModel):
    embedding: str
    other: Optional[str] = None
    template: Optional[str] = None


@app.post("/v1/verify", dependencies=[Depends(auth)])
def verify(body: VerifyIn):
    a = _emb(body.embedding)
    if body.other:
        b = _emb(body.other)
    elif body.template:
        b = gallery().get(body.template)
        if b is None:
            raise HTTPException(404, "template not found")
    else:
        raise HTTPException(422, "give other or template")
    score = float(a @ b)
    return {"score": score, "match": score >= fe.MATCH_THRESHOLD, "threshold": fe.MATCH_THRESHOLD}


# ---------------------------------------------------------------------- 1:N gallery

class EnrollIn(BaseModel):
    subject: str = Field(max_length=64)
    kind: str = Field(max_length=32)
    embedding: str
    tags: Dict[str, str] = Field(default_factory=dict)
    liveness: Optional[float] = None
    created_at: Optional[str] = None


@app.post("/v1/gallery/templates", dependencies=[Depends(auth)], status_code=201)
def enroll(body: EnrollIn):
    tid = gallery().enroll(body.subject, body.kind, _emb(body.embedding), body.tags, body.liveness, body.created_at)
    return {"id": tid}


class SearchIn(BaseModel):
    embedding: Optional[str] = None
    template: Optional[str] = Field(default=None, description="search with a stored template instead of an embedding")
    kinds: Optional[List[str]] = None
    tags_eq: Optional[Dict[str, str]] = None
    tags_ne: Optional[Dict[str, str]] = None
    exclude_subjects: Optional[List[str]] = None
    before: Optional[str] = None
    min_score: float = -1.0
    limit: int = Field(default=50, le=500)


@app.post("/v1/gallery/search", dependencies=[Depends(auth)])
def search(body: SearchIn):
    if body.embedding:
        q = _emb(body.embedding)
    elif body.template:
        q = gallery().get(body.template)
        if q is None:
            raise HTTPException(404, "template not found")
    else:
        raise HTTPException(422, "give embedding or template")
    hits = gallery().search(Query(q, body.kinds, body.tags_eq, body.tags_ne,
                                  body.exclude_subjects, body.before, body.min_score, body.limit))
    return {"hits": [h.__dict__ for h in hits]}


@app.delete("/v1/gallery/subjects/{subject}", dependencies=[Depends(auth)])
def erase(subject: str):
    return {"deleted": gallery().delete_subject(subject)}
