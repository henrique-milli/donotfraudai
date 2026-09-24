"""All configuration comes from the environment (12-factor), so the same image runs locally and in the cloud."""
import os
from pathlib import Path

MODEL_DIR = Path(os.environ.get("FACE_MODEL_DIR") or Path(__file__).resolve().parent.parent / "face_models")
# Bearer token the backend must present. Empty = no auth (local development only).
TOKEN = os.environ.get("FACE_SERVICE_TOKEN", "")
# Gallery: Postgres with pgvector (e.g. Supabase) when a DSN is set, else a local SQLite file.
GALLERY_DSN = os.environ.get("FACE_GALLERY_DSN", "")
GALLERY_SQLITE = os.environ.get("FACE_GALLERY_SQLITE") or str(Path(__file__).resolve().parent.parent / "data" / "gallery.sqlite3")
MAX_IMAGE_BYTES = int(os.environ.get("FACE_MAX_IMAGE_BYTES", str(4 * 1024 * 1024)))
