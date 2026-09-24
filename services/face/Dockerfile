# --- stage 1: open-source face models (pinned SHA-256; anti-spoofing converted to ONNX with torch)
FROM python:3.12-slim AS face-models
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu "torch>=2.2,<2.6" \
 && pip install --no-cache-dir "onnx>=1.15"
COPY tools/build_face_models.py /build_face_models.py
RUN python /build_face_models.py /models

# --- stage 2: runtime (no torch: OpenCV DNN runs the ONNX models)
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy \
    FACE_MODEL_DIR=/app/face_models FACE_GALLERY_SQLITE=/data/gallery.sqlite3
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY app ./app
RUN mkdir -p /data && useradd -r -m -u 10002 face && chown -R face /data
COPY --from=face-models /models /app/face_models
USER face
EXPOSE 8003
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8003/health')"
CMD ["/app/.venv/bin/uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8003", "--workers", "2"]
