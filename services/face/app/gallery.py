"""
1:N gallery of face templates (128-d SFace embeddings, L2-normalised).

  PgGallery      Postgres + pgvector (Supabase): cosine search on an HNSW index, in the `face` schema
  SqliteGallery  local file, brute-force numpy search (development, tests, small deployments)

A template belongs to a `subject` (the caller's reference, e.g. a session id), has a `kind`
(selfie / portrait / chipPhoto) and free `tags` (e.g. {"document": "C1234567"}). Only embeddings are
stored, never images.
"""
from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

DIM = 128


@dataclass
class Hit:
    id: str
    subject: str
    kind: str
    tags: dict
    score: float
    created_at: str


@dataclass
class Query:
    embedding: np.ndarray
    kinds: list[str] | None = None
    tags_eq: dict | None = None
    tags_ne: dict | None = None
    exclude_subjects: list[str] | None = None
    before: str | None = None          # ISO timestamp: only templates enrolled strictly before
    min_score: float = -1.0
    limit: int = 50


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class SqliteGallery:
    def __init__(self, path: str):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.lock = threading.Lock()
        self.db.execute("""create table if not exists templates (
            id text primary key, subject text not null, kind text not null, tags text not null,
            embedding blob not null, liveness real, created_at text not null)""")
        self.db.execute("create index if not exists templates_subject on templates(subject)")
        self.db.commit()

    def enroll(self, subject, kind, emb, tags, liveness=None, created_at=None) -> str:
        tid = str(uuid.uuid4())
        with self.lock:
            self.db.execute("insert into templates values (?,?,?,?,?,?,?)",
                            (tid, subject, kind, json.dumps(tags or {}), emb.astype(np.float32).tobytes(), liveness, created_at or _now()))
            self.db.commit()
        return tid

    def get(self, tid) -> np.ndarray | None:
        with self.lock:
            row = self.db.execute("select embedding from templates where id = ?", (tid,)).fetchone()
        return np.frombuffer(row[0], dtype=np.float32) if row else None

    def delete_subject(self, subject) -> int:
        with self.lock:
            n = self.db.execute("delete from templates where subject = ?", (subject,)).rowcount
            self.db.commit()
        return n

    def search(self, q: Query) -> list[Hit]:
        with self.lock:
            rows = self.db.execute("select id, subject, kind, tags, embedding, created_at from templates").fetchall()
        cand = []
        for tid, subject, kind, tags, emb, created in rows:
            tags = json.loads(tags)
            if q.kinds and kind not in q.kinds:
                continue
            if q.exclude_subjects and subject in q.exclude_subjects:
                continue
            if q.before and created >= q.before:
                continue
            if q.tags_eq and any(tags.get(k) != v for k, v in q.tags_eq.items()):
                continue
            if q.tags_ne and any(tags.get(k) == v for k, v in q.tags_ne.items()):
                continue
            cand.append((tid, subject, kind, tags, np.frombuffer(emb, dtype=np.float32), created))
        if not cand:
            return []
        scores = np.stack([c[4] for c in cand]) @ q.embedding
        order = np.argsort(-scores)
        return [Hit(cand[i][0], cand[i][1], cand[i][2], cand[i][3], float(scores[i]), cand[i][5])
                for i in order[: q.limit] if scores[i] >= q.min_score]


class PgGallery:
    """Postgres + pgvector. Schema created by supabase/migrations (face.templates); ensured here too."""

    def __init__(self, dsn: str):
        import psycopg

        self.psycopg = psycopg
        self.dsn = dsn
        with self._conn() as c:
            c.execute("create extension if not exists vector")
            c.execute("create schema if not exists face")
            c.execute(f"""create table if not exists face.templates (
                id uuid primary key, subject text not null, kind text not null, tags jsonb not null default '{{}}',
                embedding vector({DIM}) not null, liveness real, created_at timestamptz not null default now())""")
            c.execute("create index if not exists templates_subject on face.templates(subject)")
            c.execute("create index if not exists templates_embedding on face.templates using hnsw (embedding vector_cosine_ops)")

    def _conn(self):
        return self.psycopg.connect(self.dsn, autocommit=True)

    @staticmethod
    def _vec(v: np.ndarray) -> str:
        return "[" + ",".join(f"{x:.7f}" for x in v.astype(np.float32)) + "]"

    def enroll(self, subject, kind, emb, tags, liveness=None, created_at=None) -> str:
        tid = str(uuid.uuid4())
        with self._conn() as c:
            c.execute("insert into face.templates (id, subject, kind, tags, embedding, liveness, created_at) "
                      "values (%s, %s, %s, %s::jsonb, %s::vector, %s, coalesce(%s::timestamptz, now()))",
                      (tid, subject, kind, json.dumps(tags or {}), self._vec(emb), liveness, created_at))
        return tid

    def get(self, tid) -> np.ndarray | None:
        with self._conn() as c:
            row = c.execute("select embedding::text from face.templates where id = %s", (tid,)).fetchone()
        return np.array(json.loads(row[0]), dtype=np.float32) if row else None

    def delete_subject(self, subject) -> int:
        with self._conn() as c:
            return c.execute("delete from face.templates where subject = %s", (subject,)).rowcount

    def search(self, q: Query) -> list[Hit]:
        where, args = [], []
        if q.kinds:
            where.append("kind = any(%s)"); args.append(q.kinds)
        if q.exclude_subjects:
            where.append("not (subject = any(%s))"); args.append(q.exclude_subjects)
        if q.before:
            where.append("created_at < %s::timestamptz"); args.append(q.before)
        for k, v in (q.tags_eq or {}).items():
            where.append("tags->>%s = %s"); args += [k, str(v)]
        for k, v in (q.tags_ne or {}).items():
            where.append("coalesce(tags->>%s, '') <> %s"); args += [k, str(v)]
        vec = self._vec(q.embedding)
        sql = ("select id::text, subject, kind, tags, 1 - (embedding <=> %s::vector) as score, created_at "
               "from face.templates" + (" where " + " and ".join(where) if where else "") +
               " order by embedding <=> %s::vector limit %s")
        with self._conn() as c:
            rows = c.execute(sql, [vec, *args, vec, q.limit]).fetchall()
        return [Hit(r[0], r[1], r[2], r[3], float(r[4]), r[5].isoformat()) for r in rows if float(r[4]) >= q.min_score]


def open_gallery(dsn: str, sqlite_path: str):
    return PgGallery(dsn) if dsn else SqliteGallery(sqlite_path)
