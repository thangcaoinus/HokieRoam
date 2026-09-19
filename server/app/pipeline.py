"""Job orchestration: one asyncio task per job, inside the web process. No worker, no queue.

The flow per job is: store the source photo -> submit redesign -> poll -> download concept ->
submit reconstruct -> poll -> download GLB -> mark succeeded. Fitting is deliberately NOT part of
this loop; it is an explicit client call so a human can supply the footprint they confirmed.

Four invariants here exist to protect real money and are not refactorable details:

1. The submission key is reserved in SQLite BEFORE the provider is called, and
   ``PIPELINE_MAX_SUBMISSIONS`` is a hard cap.
2. ``SubmissionUnknown`` means the remote task may already have been accepted and billed. The job
   stops in ``submission-unknown`` and a human reconciles it. Nothing here ever auto-retries a
   submit.
3. Resuming after a restart re-attaches to the stored ``provider_task_id``. A stage that already
   has a task id is never submitted again, and a stage that already produced its artifact is
   skipped entirely.
4. Only ``poll`` and ``download`` get bounded backoff, because they are idempotent reads. A
   retried ``submit`` is a second charge.
"""
import asyncio
import logging
import sqlite3
import uuid
from collections.abc import Awaitable, Callable
from typing import TypeVar

from app.config import Settings
from app.geometry.mesh import validate_glb
from app.providers.base import GenerationProvider, ProviderError, Stage, SubmissionUnknown
from app.schemas import JobKind, JobView
from app.storage import JobStore, image_media, now

log = logging.getLogger("groundtruth.pipeline")

T = TypeVar("T")

# Which provider stages each job kind runs, in order.
STAGE_ORDER: dict[JobKind, tuple[Stage, ...]] = {
    "pipeline": ("redesign", "reconstruct"),
    "redesign": ("redesign",),
    "reconstruct": ("reconstruct",),
}
# The artifact each stage produces. Presence of this artifact means the stage is already done.
STAGE_ARTIFACT: dict[Stage, str] = {"redesign": "concept", "reconstruct": "model"}
TERMINAL_STATUSES = frozenset({"succeeded", "failed", "submission-unknown"})

RETRY_ATTEMPTS = 4
MAX_BACKOFF_SECONDS = 8.0

FIXTURE_WARNING = (
    "Fixture provider: the concept image and mesh are explicit synthetic placeholders, "
    "not AI generation."
)


def view(job: dict) -> JobView:
    """Project the internal record onto the public contract.

    ``artifacts`` is {name: url path}. The record's ``files`` map ({name: filename}) never leaves
    the server, so a client can neither learn nor influence a filename on disk.
    """
    return JobView(
        job_id=job["job_id"],
        kind=job["kind"],
        provider=job["provider"],
        status=job["status"],
        stage=job["stage"],
        provider_task_id=job["provider_task_id"],
        provider_tasks=job["provider_tasks"],
        progress=job["progress"],
        artifacts={name: f"/v1/jobs/{job['job_id']}/artifacts/{name}" for name in job["files"]},
        placement=job["placement"],
        error=job["error"],
        warnings=job["warnings"],
        created_at=job["created_at"],
        updated_at=job["updated_at"],
    )


class Pipeline:
    def __init__(self, settings: Settings, store: JobStore, provider: GenerationProvider):
        self.settings = settings
        self.store = store
        self.provider = provider
        self.tasks: dict[str, asyncio.Task] = {}

    # -- creation ---------------------------------------------------------------------------

    def create(self, *, request_key: str, kind: JobKind, image: bytes, media: str,
               prompt: str, strength: float) -> dict:
        """Persist a new job, or return the existing one for a repeated Idempotency-Key.

        On a replay the uploaded body is deliberately ignored. Returning the original job is the
        entire point of the key: a retried POST must never become a second paid generation.
        """
        existing = self.store.find(request_key)
        if existing is not None:
            log.info("job %s replayed from idempotency key", existing["job_id"])
            return existing

        job_id = uuid.uuid4().hex
        filename = "source.png" if media == "image/png" else "source.jpg"
        # Bytes before the row: an orphaned file is harmless, a row pointing at a missing file is
        # not, and a crash between the two must not leave a job that can never be served.
        self.store.write(job_id, filename, image)
        timestamp = now()
        job = {
            "job_id": job_id,
            "kind": kind,
            "provider": self.provider.name,
            "status": "queued",
            "stage": STAGE_ORDER[kind][0],
            "provider_task_id": None,
            "provider_tasks": {},
            "progress": None,
            "files": {"source": filename},
            "placement": None,
            "error": None,
            "warnings": [FIXTURE_WARNING] if self.provider.name == "fixture" else [],
            # Goes verbatim into the export bundle's generation.json. Never put a key in here.
            "settings": {
                "prompt": prompt,
                "strength": strength,
                "provider": self.provider.name,
                "image_model": self.settings.image_model,
                "mesh_model": self.settings.mesh_model,
            },
            "created_at": timestamp,
            "updated_at": timestamp,
        }
        try:
            self.store.create(job, request_key)
        except sqlite3.IntegrityError:
            # Lost a race on the same key; the winner's job is the one that counts.
            return self.store.find(request_key) or job
        log.info("job %s created (kind=%s provider=%s)", job_id, kind, self.provider.name)
        return job

    # -- scheduling -------------------------------------------------------------------------

    def schedule(self, job_id: str) -> None:
        task = self.tasks.get(job_id)
        if task is not None and not task.done():
            return
        self.tasks[job_id] = asyncio.create_task(self.run(job_id), name=f"job:{job_id}")

    def resume_all(self) -> list[str]:
        """Re-attach to jobs a restart interrupted.

        This cannot start a new generation: ``run`` skips any stage whose artifact already exists
        and ``ensure_submitted`` returns early for any stage that already has a task id.
        """
        resumed = []
        for job in self.store.all():
            if job["status"] in TERMINAL_STATUSES:
                continue
            self.schedule(job["job_id"])
            resumed.append(job["job_id"])
        return resumed

    async def shutdown(self) -> None:
        for task in list(self.tasks.values()):
            task.cancel()
        await asyncio.gather(*self.tasks.values(), return_exceptions=True)
        self.tasks.clear()
        await self.provider.close()

    # -- the loop ---------------------------------------------------------------------------

    async def run(self, job_id: str) -> None:
        try:
            job = self.store.get(job_id)
            if job is None:
                return
            for stage in STAGE_ORDER[job["kind"]]:
                job = self.store.get(job_id)
                if job is None or job["status"] in TERMINAL_STATUSES:
                    return
                if STAGE_ARTIFACT[stage] in job["files"]:
                    log.info("job %s stage %s already delivered; skipping", job_id, stage)
                    continue
                job = await self.run_stage(job, stage)
                if job["status"] in TERMINAL_STATUSES:
                    return
            # Generation is finished. A job that produced a mesh is now waiting on an explicit
            # fit call; one that only produced an image has nothing left to do.
            final_stage = "fit" if "model" in job["files"] else "complete"
            self.store.update(job_id, status="succeeded", stage=final_stage, progress=100,
                              provider_task_id=None)
            log.info("job %s succeeded", job_id)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            log.exception("job %s failed", job_id)
            self.store.update(job_id, status="failed", error=f"{type(exc).__name__}: {exc}")
        finally:
            self.tasks.pop(job_id, None)

    async def run_stage(self, job: dict, stage: Stage) -> dict:
        # Reconstruct prefers the redesigned concept. A kind="reconstruct" job has none, so the
        # original photo goes straight to image-to-3D.
        name = "concept" if stage == "reconstruct" and "concept" in job["files"] else "source"
        image = self.store.artifact(job, name).read_bytes()
        job = await self.ensure_submitted(job, stage, image)
        if job["status"] in TERMINAL_STATUSES:
            return job
        return await self.collect(job, stage, job["provider_tasks"][stage])

    async def ensure_submitted(self, job: dict, stage: Stage, image: bytes) -> dict:
        job_id = job["job_id"]
        if job["provider_tasks"].get(stage):
            log.info("job %s stage %s resuming task %s", job_id, stage,
                     job["provider_tasks"][stage])
            return job

        key = f"{job_id}:{stage}"
        if self.store.has_submission(key):
            # We reserved this key on an earlier run and never recorded a task id, so the provider
            # may have accepted and billed the request before the process died. Resubmitting could
            # pay twice; a human checks the provider account instead.
            return self.store.update(
                job_id, status="submission-unknown",
                error="Submission was reserved but no task id was recorded. Reconcile this job "
                      "in the provider account before retrying.")
        try:
            self.store.reserve_submission(key, self.settings.max_submissions)
        except ValueError as exc:
            return self.store.update(job_id, status="failed", error=str(exc))

        job = self.store.update(job_id, status="submitting", stage=stage)
        try:
            task_id = await self.provider.submit(
                stage, image, job["settings"]["prompt"], job["settings"]["strength"])
        except SubmissionUnknown as exc:
            # Checked before ProviderError on purpose: SubmissionUnknown is a subclass.
            return self.store.update(job_id, status="submission-unknown", error=str(exc))
        except ProviderError as exc:
            return self.store.update(job_id, status="failed", error=str(exc))

        log.info("job %s stage %s submitted as %s", job_id, stage, task_id)
        return self.store.update(
            job_id, status="running", provider_task_id=task_id,
            provider_tasks={**job["provider_tasks"], stage: task_id}, progress=0)

    async def collect(self, job: dict, stage: Stage, task_id: str) -> dict:
        """Poll one remote task to completion, then download and store what it produced."""
        job_id = job["job_id"]
        while True:
            snapshot = await self.retrying(lambda: self.provider.poll(stage, task_id))
            if snapshot.progress is not None and snapshot.progress != job["progress"]:
                job = self.store.update(job_id, progress=snapshot.progress)
            if snapshot.status == "failed":
                return self.store.update(
                    job_id, status="failed",
                    error=snapshot.error or f"Remote {stage} task failed")
            if snapshot.status == "succeeded":
                break
            await asyncio.sleep(self.settings.poll_seconds)

        if not snapshot.output_url:
            return self.store.update(
                job_id, status="failed",
                error=f"Remote {stage} task reported success without an artifact")

        data = await self.retrying(lambda: self.provider.download(snapshot.output_url))
        name, filename = self.accept(stage, data)
        self.store.write(job_id, filename, data)
        log.info("job %s stored %s (%d bytes)", job_id, name, len(data))
        return self.store.update(
            job_id, files={**job["files"], name: filename}, progress=100,
            provider_task_id=None)

    def accept(self, stage: Stage, data: bytes) -> tuple[str, str]:
        """Validate a downloaded artifact before storing it.

        A provider is not trusted to return what it promised, and these bytes are later served to
        a browser and parsed by the geometry engine.
        """
        if stage == "redesign":
            if len(data) > self.settings.max_image_bytes:
                raise ValueError("Generated image exceeds the configured size limit")
            media = image_media(data)
            return "concept", "concept.png" if media == "image/png" else "concept.jpg"
        if len(data) > self.settings.max_asset_bytes:
            raise ValueError("Generated asset exceeds the configured size limit")
        validate_glb(data)
        return "model", "model.glb"

    async def retrying(self, operation: Callable[[], Awaitable[T]]) -> T:
        """Bounded backoff for idempotent reads only — never for submit.

        A ProviderError is a decided answer (rejection, unknown status, bad artifact), not a blip,
        so it propagates immediately rather than hammering the provider.
        """
        delay = 1.0
        for remaining in reversed(range(RETRY_ATTEMPTS)):
            try:
                return await operation()
            except ProviderError:
                raise
            except Exception:
                if not remaining:
                    raise
                log.warning("transient provider error; retrying in %.1fs", delay)
                await asyncio.sleep(delay)
                delay = min(delay * 2, MAX_BACKOFF_SECONDS)
        raise RuntimeError("unreachable")
