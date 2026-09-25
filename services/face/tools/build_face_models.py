#!/usr/bin/env python3
"""
Fetches and prepares the open-source face models used by the face engine. Model files are never
committed; they are built into the Docker image (builder stage) or into ./face_models for local dev.

  python tools/build_face_models.py [OUT_DIR]      # needs: opencv-python-headless; torch + onnx for the
                                                   # anti-spoofing conversion

| file                 | source                                                   | licence    |
|----------------------|----------------------------------------------------------|------------|
| yunet.onnx           | OpenCV Zoo, face_detection_yunet_2023mar                 | MIT        |
| sface.onnx           | OpenCV Zoo, face_recognition_sface_2021dec               | Apache-2.0 |
| MiniFASNetV2.onnx    | minivision-ai/Silent-Face-Anti-Spoofing, 2.7_80x80       | Apache-2.0 |
| MiniFASNetV1SE.onnx  | minivision-ai/Silent-Face-Anti-Spoofing, 4_0_0_80x80     | Apache-2.0 |

Every download is pinned by SHA-256: if upstream changes a file the build fails instead of
silently shipping a different model.
"""
import hashlib
import sys
import tempfile
import urllib.request
from pathlib import Path

ZOO = "https://github.com/opencv/opencv_zoo/raw/main/models"
FAS = "https://github.com/minivision-ai/Silent-Face-Anti-Spoofing/raw/master"
FILES = {
    "yunet.onnx": (f"{ZOO}/face_detection_yunet/face_detection_yunet_2023mar.onnx",
                   "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"),
    "sface.onnx": (f"{ZOO}/face_recognition_sface/face_recognition_sface_2021dec.onnx",
                   "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79"),
}
FAS_SOURCES = {
    "MiniFASNet.py": (f"{FAS}/src/model_lib/MiniFASNet.py",
                      "e498c4ec5e1ddfaba62b941a126c19d65aa564999f3309661fe43ee8bf38acd7"),
    "MiniFASNetV2.pth": (f"{FAS}/resources/anti_spoof_models/2.7_80x80_MiniFASNetV2.pth",
                         "a5eb02e1843f19b5386b953cc4c9f011c3f985d0ee2bb9819eea9a142099bec0"),
    "MiniFASNetV1SE.pth": (f"{FAS}/resources/anti_spoof_models/4_0_0_80x80_MiniFASNetV1SE.pth",
                           "84ee1d37d96894d5e82de5a57df044ef80a58be2b218b5ed7cdfd875ec2f5990"),
}


def fetch(url: str, sha: str, dest: Path):
    if dest.exists() and hashlib.sha256(dest.read_bytes()).hexdigest() == sha:
        return
    data = urllib.request.urlopen(url, timeout=120).read()
    got = hashlib.sha256(data).hexdigest()
    if got != sha:
        raise SystemExit(f"checksum mismatch for {url}: {got}")
    dest.write_bytes(data)
    print(f"fetched {dest.name} ({len(data) // 1024} KB)")


def convert_fas(out: Path):
    try:
        import torch
    except ImportError:
        print("torch not installed: skipping anti-spoofing conversion (passive liveness disabled)")
        return
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        for name, (url, sha) in FAS_SOURCES.items():
            fetch(url, sha, tmp / name)
        sys.path.insert(0, str(tmp))
        from MiniFASNet import MiniFASNetV1SE, MiniFASNetV2

        for cls, name in [(MiniFASNetV2, "MiniFASNetV2"), (MiniFASNetV1SE, "MiniFASNetV1SE")]:
            m = cls(conv6_kernel=(5, 5))
            sd = torch.load(tmp / f"{name}.pth", map_location="cpu", weights_only=True)
            m.load_state_dict({k[7:] if k.startswith("module.") else k: v for k, v in sd.items()})
            m.eval()
            torch.onnx.export(m, torch.zeros(1, 3, 80, 80), str(out / f"{name}.onnx"),
                              input_names=["input"], output_names=["logits"], opset_version=11)
            print(f"converted {name}.onnx")


def main():
    out = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "face_models")
    out.mkdir(parents=True, exist_ok=True)
    for name, (url, sha) in FILES.items():
        fetch(url, sha, out / name)
    convert_fas(out)


if __name__ == "__main__":
    main()
