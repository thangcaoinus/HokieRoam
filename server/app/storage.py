"""Small SQLite job store and immutable per-job files; one application worker."""
import hashlib
import io
import json
import sqlite3
import uuid
import zipfile
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, UnidentifiedImageError


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def image_media(data: bytes) -> str:
    try:
        with Image.open(io.BytesIO(data)) as image:
            if image.format not in {"PNG", "JPEG"}:
                raise ValueError("Use a PNG or JPEG image")
            if image.width * image.height > 30_000_000:
                raise ValueError("Image exceeds 30 megapixels")
            media = "image/png" if image.format == "PNG" else "image/jpeg"
            image.verify()
            return media
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise ValueError("Invalid or oversized PNG/JPEG image") from exc


class JobStore:
    def __init__(self, root: Path):
        self.root = root
        root.mkdir(parents=True, exist_ok=True)
        self.database = root / "jobs.sqlite3"
        with self.connection() as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.executescript("""
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY, request_key TEXT UNIQUE NOT NULL, body TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS submissions (
                    submission_key TEXT PRIMARY KEY, created_at TEXT NOT NULL
                );
            """)

    @contextmanager
    def connection(self):
        connection = sqlite3.connect(self.database, timeout=10)
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def get(self, job_id: str) -> dict | None:
        with self.connection() as connection:
            row = connection.execute("SELECT body FROM jobs WHERE id=?", (job_id,)).fetchone()
        return json.loads(row[0]) if row else None

    def find(self, request_key: str) -> dict | None:
        with self.connection() as connection:
            row = connection.execute(
                "SELECT body FROM jobs WHERE request_key=?", (request_key,)).fetchone()
        return json.loads(row[0]) if row else None

    def all(self) -> list[dict]:
        with self.connection() as connection:
            rows = connection.execute("SELECT body FROM jobs ORDER BY rowid").fetchall()
        return [json.loads(row[0]) for row in rows]

    def create(self, job: dict, request_key: str):
        with self.connection() as connection:
            connection.execute("INSERT INTO jobs VALUES (?, ?, ?)",
                               (job["job_id"], request_key, json.dumps(job, allow_nan=False)))

    def update(self, job_id: str, **fields) -> dict:
        with self.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute("SELECT body FROM jobs WHERE id=?", (job_id,)).fetchone()
            if row is None:
                raise KeyError(job_id)
            job = json.loads(row[0])
            job.update(fields, updated_at=now())
            connection.execute("UPDATE jobs SET body=? WHERE id=?",
                               (json.dumps(job, allow_nan=False), job_id))
        return job

    def reserve_submission(self, key: str, maximum: int):
        with self.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            if connection.execute(
                    "SELECT 1 FROM submissions WHERE submission_key=?", (key,)).fetchone():
                raise ValueError("Submission already reserved; reconcile before resubmitting")
            count = connection.execute("SELECT COUNT(*) FROM submissions").fetchone()[0]
            if count >= maximum:
                raise ValueError("Configured provider-submission cap reached")
            connection.execute("INSERT INTO submissions VALUES (?, ?)", (key, now()))

    def has_submission(self, key: str) -> bool:
        """True once a key is reserved. A reserved key with no recorded task id means the provider
        may already have accepted and billed the request, so the caller must not resubmit."""
        with self.connection() as connection:
            row = connection.execute(
                "SELECT 1 FROM submissions WHERE submission_key=?", (key,)).fetchone()
        return row is not None

    def submissions_used(self) -> int:
        """Rows reserved against PIPELINE_MAX_SUBMISSIONS. Reported by /v1/health, never reset."""
        with self.connection() as connection:
            return connection.execute("SELECT COUNT(*) FROM submissions").fetchone()[0]

    def write(self, job_id: str, name: str, data: bytes):
        directory = self.root / job_id
        directory.mkdir(exist_ok=True)
        temporary = directory / f".{name}.{uuid.uuid4().hex}.partial"
        temporary.write_bytes(data)
        temporary.replace(directory / name)

    def artifact(self, job: dict, name: str) -> Path:
        # Names come only from a server-owned allowlist stored in the job record.
        filename = job["files"].get(name)
        if filename is None:
            raise KeyError(name)
        return self.root / job["job_id"] / filename

    def bundle(self, job: dict) -> bytes:
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for name, filename in job["files"].items():
                archive.writestr(filename, self.artifact(job, name).read_bytes())
            metadata = {key: job[key] for key in (
                "job_id", "kind", "provider", "provider_tasks", "settings", "warnings"
            )}
            metadata["sha256"] = {
                name: hashlib.sha256(self.artifact(job, name).read_bytes()).hexdigest()
                for name in job["files"]
            }
            archive.writestr("generation.json", json.dumps(metadata, indent=2))
            # The manifest is the actual handoff artifact: it carries the placement matrix that
            # the untouched GLB beside it deliberately does not have baked in.
            if job.get("placement"):
                archive.writestr("placement.json", json.dumps(job["placement"], indent=2))
        return output.getvalue()
