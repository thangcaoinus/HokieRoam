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
from app.schemas import JobKind, JobView, view_artifact
from app.storage import JobStore, image_media, now

log = logging.getLogger("groundtruth.pipeline")

T = TypeVar("T")

# Which provider stages each job kind runs, in order.
STAGE_ORDER: dict[JobKind, tuple[Stage, ...]] = {
    "pipeline": ("redesign", "reconstruct"),
    "redesign": ("redesign",),
    "reconstruct": ("reconstruct",),
}
# The artifact each stage produces. Presence of this artifact means that step is already done.
STAGE_ARTIFACT: dict[Stage, str] = {"redesign": "concept", "reconstruct": "model"}


def step_key(stage: Stage, index: int) -> str:
    """Per-step key for provider_tasks and submission reservations.

    View 0 keeps the unsuffixed name so jobs created before multi-view resume rather than
    re-submitting - a re-submission is a second charge.
    """
    return stage if index == 0 else f"{stage}_{index + 1}"


def steps(job: dict) -> list[tuple[Stage, int]]:
    """The ordered (stage, view index) work items for a job.

    Redesign runs once per source view, because Meshy's image-to-image styles one image at a time
    and the styled views must stay 1:1 with the photos they came from. Reconstruct then runs once,
    consuming every styled view at once.
    """
    views = sum(1 for name in job["files"] if name.startswith("source"))
    plan: list[tuple[Stage, int]] = []
    for stage in STAGE_ORDER[job["kind"]]:
        if stage == "redesign":
            plan.extend((stage, i) for i in range(views))
        else:
            plan.append((stage, 0))
    return plan
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

    def create(self, *, request_key: str, kind: JobKind, images: list[tuple[bytes, str]],
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
        # Bytes before the row: an orphaned file is harmless, a row pointing at a missing file is
        # not, and a crash between the two must not leave a job that can never be served.
        files: dict[str, str] = {}
        for i, (data, media) in enumerate(images):
            name = view_artifact("source", i)
            filename = f"{name}.png" if media == "image/png" else f"{name}.jpg"
            self.store.write(job_id, filename, data)
            files[name] = filename
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
            "files": files,
            "placement": None,
            "error": None,
            "warnings": [FIXTURE_WARNING] if self.provider.name == "fixture" else [],
            # Goes verbatim into the export bundle's generation.json. Never put a key in here.
            "settings": {
                "prompt": prompt,
                "strength": strength,
                "views": len(images),
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
        log.info("job %s created (kind=%s provider=%s views=%d)", job_id, kind,
                 self.provider.name, len(images))
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
            for stage, index in steps(job):
                job = self.store.get(job_id)
                if job is None or job["status"] in TERMINAL_STATUSES:
                    return
                produced = (view_artifact("concept", index) if stage == "redesign"
                            else STAGE_ARTIFACT[stage])
                if produced in job["files"]:
                    log.info("job %s step %s already delivered; skipping",
                             job_id, step_key(stage, index))
                    continue
                job = await self.run_step(job, stage, index)
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

    def view_names(self, job: dict, kind: str) -> list[str]:
        """Stored artifact names for every view of `kind`, in view order."""
        names = [view_artifact(kind, i) for i in range(self.settings.max_views)]
        return [n for n in names if n in job["files"]]

    async def run_step(self, job: dict, stage: Stage, index: int) -> dict:
        if stage == "redesign":
            # One photo in, one styled view out, so the set stays 1:1 with the source angles.
            names = [view_artifact("source", index)]
        else:
            # Every styled view at once. A kind="reconstruct" job was never redesigned, so its
            # original photos go straight to multi-image-to-3d.
            names = self.view_names(job, "concept") or self.view_names(job, "source")
        images = [self.store.artifact(job, name).read_bytes() for name in names]
        job = await self.ensure_submitted(job, stage, index, images)
        if job["status"] in TERMINAL_STATUSES:
            return job
        return await self.collect(job, stage, index,
                                  job["provider_tasks"][step_key(stage, index)])

    async def ensure_submitted(
        self, job: dict, stage: Stage, index: int, images: list[bytes]
    ) -> dict:
        job_id = job["job_id"]
        task = step_key(stage, index)
        if job["provider_tasks"].get(task):
            log.info("job %s step %s resuming task %s", job_id, task,
                     job["provider_tasks"][task])
            return job

        key = f"{job_id}:{task}"
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
                stage, images, job["settings"]["prompt"], job["settings"]["strength"])
        except SubmissionUnknown as exc:
            # Checked before ProviderError on purpose: SubmissionUnknown is a subclass.
            return self.store.update(job_id, status="submission-unknown", error=str(exc))
        except ProviderError as exc:
            return self.store.update(job_id, status="failed", error=str(exc))

        log.info("job %s step %s submitted as %s (%d view(s))", job_id, task, task_id,
                 len(images))
        return self.store.update(
            job_id, status="running", provider_task_id=task_id,
            provider_tasks={**job["provider_tasks"], task: task_id}, progress=0)

    async def collect(self, job: dict, stage: Stage, index: int, task_id: str) -> dict:
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
        name, filename = self.accept(stage, index, data)
        self.store.write(job_id, filename, data)
        log.info("job %s stored %s (%d bytes)", job_id, name, len(data))
        return self.store.update(
            job_id, files={**job["files"], name: filename}, progress=100,
            provider_task_id=None)

    def accept(self, stage: Stage, index: int, data: bytes) -> tuple[str, str]:
        """Validate a downloaded artifact before storing it.

        A provider is not trusted to return what it promised, and these bytes are later served to
        a browser and parsed by the geometry engine.
        """
        if stage == "redesign":
            if len(data) > self.settings.max_image_bytes:
                raise ValueError("Generated image exceeds the configured size limit")
            media = image_media(data)
            name = view_artifact("concept", index)
            return name, f"{name}.png" if media == "image/png" else f"{name}.jpg"
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
