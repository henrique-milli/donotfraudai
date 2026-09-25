"""
Open-source face engine: detection, 1:1 verification, 1:N search and passive liveness.

  detection + 5 landmarks   YuNet (OpenCV Zoo, MIT)
  embedding (128-d)         SFace (OpenCV Zoo, Apache-2.0), cosine similarity
  passive anti-spoofing     MiniFASNetV2 + MiniFASNetV1SE (minivision Silent-Face-Anti-Spoofing,
                            Apache-2.0), converted to ONNX by tools/build_face_models.py

Everything runs on OpenCV's DNN module, no torch at runtime. Models load lazily, once per process,
from $FACE_MODEL_DIR (tools/build_face_models.py).
"""
from __future__ import annotations

import logging
import os
import threading
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

log = logging.getLogger("face")

# SFace operating points (OpenCV Zoo reference: cosine ≥ 0.363 = same identity on LFW)
MATCH_THRESHOLD = 0.363
# stricter for 1:N, where one comparison runs against every enrolled face
SEARCH_THRESHOLD = 0.50
# MiniFASNet: mean "real" probability over the frames of a capture
LIVE_PASS = 0.70
LIVE_FAIL = 0.20


def _model_dir() -> Path:
    from .config import MODEL_DIR

    return MODEL_DIR


@dataclass
class Face:
    box: tuple[float, float, float, float]      # x, y, w, h
    landmarks: np.ndarray                       # 5×2: right eye, left eye, nose, mouth right, mouth left
    score: float
    raw: np.ndarray = field(repr=False)         # YuNet row, needed by SFace alignCrop


class Engine:
    _lock = threading.Lock()
    _instance: "Engine | None" = None

    def __init__(self, d: Path):
        import cv2

        self.cv2 = cv2
        self.detector = cv2.FaceDetectorYN.create(str(d / "yunet.onnx"), "", (320, 320), 0.7, 0.3, 5000)
        self.recognizer = cv2.FaceRecognizerSF.create(str(d / "sface.onnx"), "")
        fas = [(d / "MiniFASNetV2.onnx", 2.7), (d / "MiniFASNetV1SE.onnx", 4.0)]
        self.anti_spoof = [(cv2.dnn.readNetFromONNX(str(p)), s) for p, s in fas if p.exists()]

    @classmethod
    def get(cls) -> "Engine | None":
        """None when the model files are not installed."""
        with cls._lock:
            if cls._instance is None:
                d = _model_dir()
                if not ((d / "yunet.onnx").exists() and (d / "sface.onnx").exists()):
                    log.warning("face engine unavailable: no models in %s (run tools/build_face_models.py)", d)
                    return None
                cls._instance = cls(d)
            return cls._instance

    @property
    def liveness_available(self) -> bool:
        return bool(self.anti_spoof)

    # ------------------------------------------------------------------ primitives

    def decode(self, data: bytes) -> np.ndarray | None:
        img = self.cv2.imdecode(np.frombuffer(data, np.uint8), self.cv2.IMREAD_COLOR)
        return img if img is not None and img.size else None

    def detect(self, img: np.ndarray) -> list[Face]:
        h, w = img.shape[:2]
        # small inputs (ID portraits) detect better upscaled; big ones are fine as they are
        scale = 320.0 / max(h, w) if max(h, w) < 320 else 1.0
        work = self.cv2.resize(img, (int(w * scale), int(h * scale))) if scale != 1.0 else img
        self.detector.setInputSize((work.shape[1], work.shape[0]))
        _, rows = self.detector.detect(work)
        faces = []
        for r in rows if rows is not None else []:
            r = r.copy()
            r[:14] /= scale
            faces.append(Face(tuple(r[:4]), r[4:14].reshape(5, 2), float(r[14]), r))
        return sorted(faces, key=lambda f: -f.box[2] * f.box[3])

    def embed(self, img: np.ndarray, face: Face) -> np.ndarray:
        aligned = self.recognizer.alignCrop(img, face.raw)
        v = self.recognizer.feature(aligned).flatten().astype(np.float32)
        return v / (np.linalg.norm(v) + 1e-9)

    @staticmethod
    def similarity(a: np.ndarray, b: np.ndarray) -> float:
        return float(np.dot(a, b))

    def liveness(self, img: np.ndarray, face: Face) -> float | None:
        """Probability the face is a live person (not print / screen / mask), or None if unavailable."""
        if not self.anti_spoof:
            return None
        total = np.zeros(3)
        for net, scale in self.anti_spoof:
            x = self._fas_crop(img, face.box, scale).astype(np.float32).transpose(2, 0, 1)[None]
            net.setInput(x)
            o = net.forward()[0]
            e = np.exp(o - o.max())
            total += e / e.sum()
        return float(total[1] / len(self.anti_spoof))  # class 1 = real

    def _fas_crop(self, img, box, scale, out=80):
        """Silent-Face crop: box scaled around its centre, shifted to stay inside the image."""
        H, W = img.shape[:2]
        x, y, w, h = box
        scale = min((H - 1) / h, (W - 1) / w, scale)
        nw, nh = w * scale, h * scale
        cx, cy = x + w / 2, y + h / 2
        x1, y1 = max(0, cx - nw / 2), max(0, cy - nh / 2)
        x2, y2 = min(W - 1, cx + nw / 2), min(H - 1, cy + nh / 2)
        if x1 == 0:
            x2 = nw
        if y1 == 0:
            y2 = nh
        if x2 == W - 1:
            x1 = W - 1 - nw
        if y2 == H - 1:
            y1 = H - 1 - nh
        return self.cv2.resize(img[int(y1):int(y2) + 1, int(x1):int(x2) + 1], (out, out))

    @staticmethod
    def yaw(face: Face) -> float:
        """Signed head turn from landmarks: nose offset from the eye midpoint, in eye distances.
        Positive = nose towards the image's right side."""
        re, le, nose = face.landmarks[0], face.landmarks[1], face.landmarks[2]
        eye_d = np.linalg.norm(le - re) + 1e-6
        return float((nose[0] - (re[0] + le[0]) / 2) / eye_d)

    @staticmethod
    def roll(face: Face) -> float:
        """Head tilt in degrees from the eye line."""
        re, le = face.landmarks[0], face.landmarks[1]
        return float(np.degrees(np.arctan2(le[1] - re[1], le[0] - re[0])))


# ---------------------------------------------------------------------- analysis of one capture

@dataclass
class Probe:
    """One image analysed: the largest face, its embedding and liveness."""
    kind: str
    faces: int
    face: Face | None = None
    embedding: np.ndarray | None = None
    live: float | None = None
    size: tuple[int, int] | None = None        # decoded image width, height


def probe(engine: Engine, kind: str, data: bytes, liveness: bool = False) -> Probe:
    img = engine.decode(data)
    if img is None:
        return Probe(kind, 0)
    size = (int(img.shape[1]), int(img.shape[0]))
    faces = engine.detect(img)
    if not faces:
        return Probe(kind, 0, size=size)
    f = faces[0]
    return Probe(kind, len(faces), f, engine.embed(img, f), engine.liveness(img, f) if liveness else None, size)


def to_b64(v: np.ndarray) -> str:
    import base64

    return base64.b64encode(v.astype(np.float32).tobytes()).decode()


def from_b64(s: str) -> np.ndarray:
    import base64

    v = np.frombuffer(base64.b64decode(s), dtype=np.float32)
    if v.shape != (128,):
        raise ValueError("embedding must be 128 float32 values")
    return v


def to_bytes(v: np.ndarray) -> bytes:
    return v.astype(np.float32).tobytes()


def from_bytes(b: bytes) -> np.ndarray:
    return np.frombuffer(bytes(b), dtype=np.float32)
