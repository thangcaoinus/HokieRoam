"""HTTP handlers for the frozen v1 contract (work-split.md P0).

Routes validate, delegate, and project. They never parse vendor JSON — that lives behind the
GenerationProvider protocol — and they never touch the filesystem by a client-supplied name.
"""
import asyncio
from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    Header,
    HTTPException,
    Request,
    Response,
    UploadFile,
)
from fastapi.responses import FileResponse

from app.config import Settings
from app.geometry.fit import fit_glb
from app.pipeline import TERMINAL_STATUSES, Pipeline, view
from app.schemas import (
    ArtifactName,
    FitRequest,
    HealthView,
    JobKind,
    JobView,
    PlacementManifest,
)
from app.storage import JobStore, image_media

router = APIRouter(prefix="/v1")

MEDIA_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".glb": "model/gltf-binary"}


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_store(request: Request) -> JobStore:
    return request.app.state.store


def get_pipeline(request: Request) -> Pipeline:
    return request.app.state.pipeline


SettingsDep = Annotated[Settings, Depends(get_settings)]
StoreDep = Annotated[JobStore, Depends(get_store)]
PipelineDep = Annotated[Pipeline, Depends(get_pipeline)]


def require_job(store: JobStore, job_id: str) -> dict:
    job = store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="No such job")
    return job


@router.get("/health", response_model=HealthView)
def health(settings: SettingsDep, store: StoreDep) -> HealthView:
    """Connectivity probe behind the frontend's 'Pipeline API connected' chip.

    ``live`` is False for the fixture provider even though the server is up: the fixture adapter
    emits explicit placeholders and must never read as an AI generation.
    """
    return HealthView(
        provider=settings.provider,
        live=settings.provider == "meshy" and bool(settings.api_key),
        submissions_used=store.submissions_used(),
    )


@router.post("/jobs", response_model=JobView, status_code=202)
async def create_job(
    settings: SettingsDep,
    pipeline: PipelineDep,
    image: Annotated[UploadFile, File(description="Source building photo, PNG or JPEG")],
    prompt: Annotated[str, Form(min_length=1, max_length=2000)],
    strength: Annotated[float, Form(ge=0, le=1)],
    idempotency_key: Annotated[str, Header(alias="Idempotency-Key", min_length=1, max_length=200)],
    kind: Annotated[JobKind, Form()] = "pipeline",
) -> JobView:
    """Accept a source photo and start generation. Returns 202 at once, never the asset.

    ``Idempotency-Key`` becomes the storage ``request_key``, which is UNIQUE: repeating a request
    with the same key returns the same job rather than paying for a second generation.
    """
    # Read one byte past the cap so an oversized upload is rejected without buffering all of it.
    data = await image.read(settings.max_image_bytes + 1)
    if len(data) > settings.max_image_bytes:
        raise HTTPException(status_code=413, detail="Source image exceeds the configured limit")
    try:
        media = image_media(data)
    except ValueError as exc:
        raise HTTPException(status_code=415, detail=str(exc)) from exc

    job = pipeline.create(request_key=idempotency_key, kind=kind, image=data, media=media,
                          prompt=prompt, strength=strength)
    if job["status"] not in TERMINAL_STATUSES:
        pipeline.schedule(job["job_id"])
    return view(job)


@router.get("/jobs", response_model=list[JobView])
def list_jobs(store: StoreDep) -> list[JobView]:
    """Every job this server knows about, oldest first."""
    return [view(job) for job in store.all()]


@router.get("/jobs/{job_id}", response_model=JobView)
def get_job(job_id: str, store: StoreDep) -> JobView:
    """The poll endpoint. Reports the job's real stage, status and progress.

    Reading a job never starts work: an interrupted job is resumed at startup, from its stored
    provider task id, not by anyone polling it.
    """
    return view(require_job(store, job_id))


@router.get("/jobs/{job_id}/artifacts/{name}", response_model=None)
def get_artifact(job_id: str, name: ArtifactName, store: StoreDep) -> FileResponse:
    """Raw bytes for one stored artifact: the source photo, the concept image, or the GLB.

    ``name`` is a Literal, so anything else is rejected with 422 before this runs, and
    ``store.artifact`` still resolves it through the job record's server-owned ``files`` map. A
    client-supplied string never reaches the filesystem.
    """
    job = require_job(store, job_id)
    try:
        path = store.artifact(job, name)
    except KeyError as exc:
        raise HTTPException(
            status_code=404, detail=f"This job has no {name} artifact yet") from exc
    if not path.is_file():
        raise HTTPException(status_code=404, detail=f"The {name} artifact is missing from storage")
    return FileResponse(path, media_type=MEDIA_TYPES.get(path.suffix, "application/octet-stream"))


@router.post("/jobs/{job_id}/fit", response_model=PlacementManifest)
async def fit_job(job_id: str, fit_request: FitRequest, store: StoreDep) -> PlacementManifest:
    """Snap this job's generated mesh onto the authoritative footprint.

    Coordinates in ``FitRequest`` are plan metres, EAST/NORTH — not the frontend's scene x/z.
    The manifest that comes back carries the matrix, every candidate, the metrics, and the
    accepted/review/rejected outcome. The stored GLB is never modified.
    """
    job = require_job(store, job_id)
    if "model" not in job["files"]:
        raise HTTPException(status_code=409, detail="This job has no generated model to fit yet")
    data = store.artifact(job, "model").read_bytes()
    try:
        # Shapely and trimesh are CPU-bound; keep them off the loop so job polling stays live.
        manifest = await asyncio.to_thread(fit_glb, data, fit_request)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    store.update(job_id, placement=manifest.model_dump(mode="json"), stage="complete")
    return manifest


@router.get("/jobs/{job_id}/export", response_model=None)
async def export_job(job_id: str, store: StoreDep) -> Response:
    """Zip bundle: the unchanged artifacts, their sha256s, generation provenance, and — once a fit
    has run — the placement manifest.

    This is the sponsor handoff artifact. The GLB inside is the generated asset untouched; the
    placement lives in the manifest matrix, so nothing ever applies the transform twice.
    """
    job = require_job(store, job_id)
    if not job["files"]:
        raise HTTPException(status_code=409, detail="This job has no artifacts to export")
    data = await asyncio.to_thread(store.bundle, job)
    return Response(
        content=data,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="groundtruth-{job_id}.zip"'},
    )
