from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["ok"] is True
    assert r.json()["mode"] == "mock"


def test_analyze_clean():
    r = client.post("/v1/analyze", json={"session_id": "t", "images": {"selfie": "AAAA"}, "meta": {}})
    assert r.status_code == 200
    body = r.json()
    assert body["injection_likely"] is False
    assert body["swap_score"] < 0.5
    assert body["mode"] == "mock"


def test_analyze_swap_hint():
    r = client.post(
        "/v1/analyze",
        json={"session_id": "t", "images": {"selfie": "AAAA"}, "meta": {"hint": "face-swap"}},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["injection_likely"] is True
    assert body["swap_score"] >= 0.75
    assert "face_swap_residuals" in body["artifacts"]
