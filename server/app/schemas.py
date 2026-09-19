"""Public v1 contracts. Coordinate arrays here are EAST/NORTH, not frontend x/z."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Polygon2D(Contract):
    exterior: list[tuple[float, float]] = Field(min_length=3, max_length=10000)
    holes: list[list[tuple[float, float]]] = Field(default_factory=list, max_length=100)


class LocalFrame(Contract):
    origin_longitude: float = Field(ge=-180, le=180)
    origin_latitude: float = Field(ge=-90, le=90)
    origin_height_m: float = 0
    convention: Literal["X=east,Y=up,Z=south"] = "X=east,Y=up,Z=south"
    ground_mode: Literal["flat-assumed"] = "flat-assumed"


class Provenance(Contract):
    source: Literal["county-gis", "osm", "user-provided", "synthetic"]
    feature_id: str = Field(min_length=1, max_length=200)
    source_url: str | None = Field(default=None, max_length=2000)
    identity_confirmed: bool = False


class FitRequest(Contract):
    footprint: Polygon2D
    frame: LocalFrame
    provenance: Provenance
    neighbors: list[Polygon2D] | None = Field(default=None, max_length=100)
    up_axis: Literal["Y", "Z"] = "Y"
    unit_scale: float = Field(default=1, gt=0, le=1e6)
    min_iou: float = Field(default=0.85, ge=0, le=1)
    numerical_tolerance_m: float = Field(default=1e-6, gt=0, le=0.01)


class ProjectRequest(Contract):
    polygon: Polygon2D
    source_crs: str = Field(default="EPSG:4326", max_length=100)
    frame: LocalFrame


class FitMetrics(Contract):
    iou: float
    coverage: float
    spill_fraction: float
    spill_area_m2: float
    contained: bool
    neighbor_overlap_m2: float


class FitCandidate(Contract):
    index: int
    yaw_radians: float
    scale: float
    matrix_column_major: list[float] = Field(min_length=16, max_length=16)
    fitted_proxy: Polygon2D
    metrics: FitMetrics


class PlacementManifest(Contract):
    schema_version: Literal[1] = 1
    asset_sha256: str
    applies_to: Literal["unchanged-source-glb-asset-root"] = "unchanged-source-glb-asset-root"
    frame: LocalFrame
    provenance: Provenance
    request: FitRequest
    selected: FitCandidate
    candidates: list[FitCandidate]
    plan_fit: Literal["accepted", "review", "rejected"]
    heading: Literal["ambiguous"] = "ambiguous"
    height: Literal["inferred"] = "inferred"
    proxy: Literal["projected-convex-hull"] = "projected-convex-hull"
    neighbor_check: Literal["performed", "not-provided"]
    source_dimensions_m: tuple[float, float, float]
    fitted_dimensions_m: tuple[float, float, float]
    warnings: list[str]
    world_registration: Literal["not-integrated"] = "not-integrated"


JobKind = Literal["redesign", "reconstruct", "pipeline"]
JobStatus = Literal["queued", "submitting", "running", "succeeded", "failed", "submission-unknown"]


class JobView(Contract):
    schema_version: Literal[1] = 1
    job_id: str
    kind: JobKind
    provider: str
    status: JobStatus
    stage: Literal["redesign", "reconstruct", "fit", "complete"]
    provider_task_id: str | None
    provider_tasks: dict[str, str]
    progress: int | None
    artifacts: dict[str, str]
    placement: PlacementManifest | None
    error: str | None
    warnings: list[str]
    created_at: str
    updated_at: str
