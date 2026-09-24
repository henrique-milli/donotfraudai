import base64
import os
from pathlib import Path

import numpy as np
import pytest

from app import engine as fe
from app.gallery import PgGallery, Query, SqliteGallery


def unit(seed):
    v = np.random.default_rng(seed).standard_normal(128).astype(np.float32)
    return v / np.linalg.norm(v)


def near(v, eps, seed):
    w = v + eps * unit(seed)
    return (w / np.linalg.norm(w)).astype(np.float32)


def _galleries(tmp_path):
    out = [SqliteGallery(str(tmp_path / "g.sqlite3"))]
    dsn = os.environ.get("FACE_TEST_PG_DSN")
    if dsn:
        g = PgGallery(dsn)
        with g._conn() as c:
            c.execute("truncate face.templates")
        out.append(g)
    return out


def test_gallery_search_filters(tmp_path):
    alice, bob = unit(1), unit(2)
    for g in _galleries(tmp_path):
        a1 = g.enroll("s1", "selfie", alice, {"document": "DOC-A"}, 0.99, "2026-01-01T00:00:00+00:00")
        g.enroll("s2", "selfie", near(alice, 0.3, 9), {"document": "DOC-B"}, 0.98, "2026-01-02T00:00:00+00:00")
        g.enroll("s3", "selfie", bob, {"document": "DOC-C"}, 0.97, "2026-01-03T00:00:00+00:00")
        g.enroll("s1", "portrait", alice, {"document": "DOC-A"})

        hits = g.search(Query(alice, kinds=["selfie"], min_score=0.5))
        assert [h.subject for h in hits] == ["s1", "s2"], type(g).__name__
        assert hits[0].score == pytest.approx(1.0, abs=1e-4)
        assert [h.subject for h in g.search(Query(alice, kinds=["selfie"], tags_ne={"document": "DOC-A"}, min_score=0.5))] == ["s2"]
        assert [h.subject for h in g.search(Query(alice, tags_eq={"document": "DOC-A"}))] == ["s1", "s1"]
        assert [h.subject for h in g.search(Query(alice, kinds=["selfie"], before="2026-01-02T00:00:00+00:00"))] == ["s1"]
        assert [h.subject for h in g.search(Query(alice, kinds=["selfie"], exclude_subjects=["s1"], min_score=0.5))] == ["s2"]
        assert np.allclose(g.get(a1), alice, atol=1e-5)
        assert g.delete_subject("s1") == 2
        assert g.get(a1) is None


@pytest.fixture
def client(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from app import config, main

    monkeypatch.setattr(config, "TOKEN", "t0k")
    monkeypatch.setattr(config, "GALLERY_DSN", "")
    monkeypatch.setattr(config, "GALLERY_SQLITE", str(tmp_path / "api.sqlite3"))
    main.gallery.cache_clear()
    return TestClient(main.app)


def test_auth_and_gallery_api(client):
    assert client.get("/healthz").status_code == 200
    assert client.get("/v1/info").status_code == 401
    h = {"Authorization": "Bearer t0k"}
    e = fe.to_b64(unit(5))
    tid = client.post("/v1/gallery/templates", json={"subject": "S", "kind": "selfie", "embedding": e, "tags": {"document": "D"}}, headers=h).json()["id"]
    hits = client.post("/v1/gallery/search", json={"embedding": e, "kinds": ["selfie"]}, headers=h).json()["hits"]
    assert hits[0]["id"] == tid and hits[0]["score"] > 0.999
    assert client.post("/v1/verify", json={"embedding": e, "template": tid}, headers=h).json()["match"] is True
    assert client.post("/v1/verify", json={"embedding": "AAAA"}, headers=h).status_code == 422
    assert client.delete("/v1/gallery/subjects/S", headers=h).json() == {"deleted": 1}


SAMPLES = Path(os.environ.get("FACE_SAMPLES", "/nonexistent"))


@pytest.mark.skipif(fe.Engine.get() is None or not SAMPLES.is_dir(), reason="needs models + FACE_SAMPLES")
def test_analyze_real_models(client):
    h = {"Authorization": "Bearer t0k"}
    imgs = {n: base64.b64encode((SAMPLES / f"image_{n}.jpg").read_bytes()).decode() for n in ["T1", "F2"]}
    r = client.post("/v1/analyze", json={"images": imgs, "liveness": ["T1", "F2"]}, headers=h).json()["results"]
    assert r["T1"]["faces"] == 1 and r["T1"]["liveness"] > 0.9
    assert r["F2"]["liveness"] < 0.2  # same woman shown on a tablet
    v = client.post("/v1/verify", json={"embedding": r["T1"]["embedding"], "other": r["F2"]["embedding"]}, headers=h).json()
    assert v["match"] is True
