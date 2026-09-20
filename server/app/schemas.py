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
    # Plan overhang the best placement may have outside the footprint before it stops being
    # usable. A real roof eave always spills, so exact containment cannot be the gate.
    # The default is tied to min_iou rather than picked to taste: with a convex proxy the
    # achievable IoU is capped at roughly 1 - spill_fraction, so allowing 15% spill is the
    # same statement as requiring 0.85 IoU. Revisit it when the proxy stops being convex.
    # A tunable product policy (internal/feasibility-plan.md 5.6), not a measurement.
    max_spill_fraction: float = Field(default=0.15, ge=0, le=1)
    # An independently recorded building height, e.g. OSM's `height` tag. Uniform scale ties
    # height to the plan fit, which renders a 20.7 m building at 48 m. When a height is supplied
    # the vertical scale is solved from it instead (internal/feasibility-plan.md 5.4) and the
    # manifest downgrades `height` from "inferred" to "source-record". Never changes the plan fit.
    measured_height_m: float | None = Field(default=None, gt=0, le=1000)
    # How far vertical scale may depart from the proportion-preserving uniform scale before the
    # record is treated as describing something else. Deck p.58 says to PREFER uniform scaling and
    # only ALLOW limited non-uniform scaling; internal/feasibility-plan.md 5.4 proposes 1.15-1.25.
    # A record that disagrees by more than this is reported, never forced: an OSM `height` is
    # often the eaves of the main block while the mesh includes a tower, and forcing it squashes it.
    max_height_correction: float = Field(default=1.25, ge=1, le=4)


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
    # Vertical scale. None means it equals `scale` (proportion-preserving uniform fit); a value
    # means height came from a record rather than the plan fit. Optional so manifests written
    # before measured height existed still parse.
    scale_y: float | None = None
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
    height: Literal["measured", "source-record", "inferred"] = "inferred"
    proxy: Literal["projected-convex-hull"] = "projected-convex-hull"
    neighbor_check: Literal["performed", "not-provided"]
    source_dimensions_m: tuple[float, float, float]
    fitted_dimensions_m: tuple[float, float, float]
    warnings: list[str]
    world_registration: Literal["not-integrated"] = "not-integrated"


JobKind = Literal["redesign", "reconstruct", "pipeline"]
JobStatus = Literal["queued", "submitting", "running", "succeeded", "failed", "submission-unknown"]
# The only artifact names a client may ask for. JobView.artifacts is keyed by these; the internal
# job record maps them to filenames, so a client-supplied name never reaches the filesystem.
#
# Meshy's multi-image-to-3d takes 1-4 views of the same building, so a job carries up to four
# source photos and the four styled concepts derived from them. View 1 is named `source`/`concept`
# without a suffix so single-view clients keep working unchanged.
MAX_VIEWS = 4
ArtifactName = Literal[
    "source", "source_2", "source_3", "source_4",
    "concept", "concept_2", "concept_3", "concept_4",
    "model",
]


def view_artifact(kind: Literal["source", "concept"], index: int) -> str:
    """Artifact name for view `index` (0-based). View 0 keeps the unsuffixed legacy name."""
    return kind if index == 0 else f"{kind}_{index + 1}"


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
    target_polycount: int | None = None
    artifacts: dict[str, str]
    placement: PlacementManifest | None
    error: str | None
    warnings: list[str]
    created_at: str
    updated_at: str


class HealthView(Contract):
    """Liveness probe the frontend uses to switch its honesty chip to 'Pipeline API connected'."""
    schema_version: Literal[1] = 1
    provider: str
    # True only when a real paid provider is configured AND keyed. The fixture adapter is
    # explicitly synthetic, so it reports live=False — never let a fixture read as generation.
    live: bool
    submissions_used: int
