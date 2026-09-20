"""Does the placement engine work for an ordinary building, or only for our demo building?

Twelve real OpenStreetMap footprints (tests/fixtures/osm_footprints.json) are extruded into
generator-style meshes with a known yaw, normalisation scale and offset, so the correct answer
is known: a sound engine recovers IoU ~ 1.0. Two variants are built per footprint --

  clean      exact extrusion of the footprint
  realistic  + a 4 m paving apron and a 1 m roof overhang, which is what an image-to-3D
             provider actually returns

-- because the gap between them measures how much the conservative projected-hull proxy costs.

These assertions are deliberately two-sided. Requiring near-convex footprints to be accepted
stops the engine regressing; requiring concave footprints to be *refused* stops a future change
from passing this file by loosening a threshold. Convexity, not size, is what the convex-hull
proxy can and cannot handle: it caps achievable IoU at roughly the footprint's area/hull ratio.
"""

import json
import math
from pathlib import Path

import numpy as np
import pytest
import trimesh
from shapely.geometry import Polygon

from app.geometry.fit import fit_glb
from app.schemas import FitRequest, LocalFrame, Polygon2D, Provenance

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "osm_footprints.json").read_text())
FOOTPRINTS = FIXTURE["footprints"]
NEAR_CONVEX = 0.88      # the proxy can represent these
CONCAVE = 0.70          # the proxy provably cannot; refusing them is the correct answer


def _walls(ring, y0, y1, vertices, faces):
    """Quad strip per edge. Walls alone fix the plan silhouette, and avoiding a roof keeps
    this independent of a polygon triangulation library (none is installed)."""
    base = len(vertices)
    for index in range(len(ring) - 1):
        a, b = ring[index], ring[index + 1]
        # Plan is (East, North) = (x, -z), so North maps to -z when building the mesh.
        vertices += [[a[0], y0, -a[1]], [b[0], y0, -b[1]], [b[0], y1, -b[1]], [a[0], y1, -a[1]]]
        k = base + 4 * index
        faces += [[k, k + 1, k + 2], [k, k + 2, k + 3]]


def building_glb(polygon: Polygon, *, apron_m: float, overhang_m: float, yaw_deg: float,
                 offset: tuple[float, float, float]) -> bytes:
    """Extrude a footprint, then hand it back the way a generator would: arbitrary yaw,
    centred, normalised to ~2 units, at an arbitrary offset. The engine must undo all of it."""
    height = max(6.0, math.sqrt(polygon.area) * 0.35)
    vertices: list[list[float]] = []
    faces: list[list[int]] = []
    _walls(list(polygon.exterior.coords), 0.0, height, vertices, faces)
    if overhang_m:
        eave = polygon.buffer(overhang_m).simplify(0.2)
        if eave.geom_type == "Polygon":
            _walls(list(eave.exterior.coords), height, height + 0.6, vertices, faces)
    if apron_m:
        paving = polygon.buffer(apron_m).simplify(0.3)
        if paving.geom_type == "Polygon":
            _walls(list(paving.exterior.coords), 0.0, 0.18, vertices, faces)

    v = np.array(vertices, float)
    angle = math.radians(yaw_deg)
    cos, sin = math.cos(angle), math.sin(angle)
    v = v @ np.array([[cos, 0, sin], [0, 1, 0], [-sin, 0, cos]]).T
    v = v - (v.min(axis=0) + v.max(axis=0)) / 2
    v = v * (2.0 / np.ptp(v, axis=0).max())
    return trimesh.Trimesh(vertices=v + np.array(offset), faces=np.array(faces),
                           process=False).export(file_type="glb")


def fit_request(ring) -> FitRequest:
    return FitRequest(
        footprint=Polygon2D(exterior=[tuple(p) for p in ring], holes=[]),
        frame=LocalFrame(origin_longitude=-80.4270, origin_latitude=37.2220),
        provenance=Provenance(source="osm", feature_id="fixture", identity_confirmed=True),
        neighbors=[],
    )


def place(entry, *, apron_m=0.0, overhang_m=0.0, yaw_deg=61.0, offset=(2.0, -1.5, 3.0)):
    polygon = Polygon(entry["ring"])
    glb = building_glb(polygon, apron_m=apron_m, overhang_m=overhang_m, yaw_deg=yaw_deg,
                       offset=offset)
    return fit_glb(glb, fit_request(entry["ring"]))


def ids(entries):
    return [f"way{e['id']}-{e['convexity']:.2f}" for e in entries]


NEAR_CONVEX_CASES = [e for e in FOOTPRINTS if e["convexity"] >= NEAR_CONVEX]
CONCAVE_CASES = [e for e in FOOTPRINTS if e["convexity"] <= CONCAVE]


def test_the_fixture_spans_both_regimes():
    """A one-sided fixture would let either assertion below pass vacuously."""
    assert len(NEAR_CONVEX_CASES) >= 5
    assert len(CONCAVE_CASES) >= 3


@pytest.mark.parametrize("entry", NEAR_CONVEX_CASES, ids=ids(NEAR_CONVEX_CASES))
def test_near_convex_footprints_are_recovered_from_a_clean_mesh(entry):
    manifest = place(entry)
    assert manifest.plan_fit == "accepted"
    assert manifest.selected.metrics.iou >= 0.85
    assert manifest.selected.metrics.coverage >= 0.95


@pytest.mark.parametrize("entry", NEAR_CONVEX_CASES, ids=ids(NEAR_CONVEX_CASES))
def test_an_apron_and_a_roof_overhang_do_not_break_a_near_convex_fit(entry):
    """A provider mesh carries paving and eaves. They cost IoU because the proxy is a hull,
    but must not make the placement unusable."""
    manifest = place(entry, apron_m=4.0, overhang_m=1.0)
    assert manifest.plan_fit in {"accepted", "review"}
    assert manifest.selected.metrics.iou >= 0.75
    assert manifest.selected.metrics.coverage >= 0.75


@pytest.mark.parametrize("entry", CONCAVE_CASES, ids=ids(CONCAVE_CASES))
def test_concave_footprints_are_refused_rather_than_forced(entry):
    """The convex-hull proxy caps IoU near the area/hull ratio, so these cannot be honestly
    placed. Accepting one would mean a threshold was loosened, not that the engine improved."""
    manifest = place(entry)
    assert manifest.plan_fit != "accepted"
    assert manifest.selected.metrics.iou <= entry["convexity"] + 0.05


@pytest.mark.parametrize("yaw_deg", [0.0, 23.0, 45.0, 137.0, 300.0])
def test_a_perfect_fit_is_not_rejected_by_floating_point_noise(yaw_deg):
    """Containment was once the validity gate, evaluated with an exact topological predicate
    at 1e-6 m. The transform chain's own noise is ~1e-5 m2 of spill, so 4 of 12 geometrically
    perfect fits were rejected at random. Selection must not be at the mercy of that.
    """
    square = next(e for e in FOOTPRINTS if e["convexity"] >= 0.999)
    manifest = place(square, yaw_deg=yaw_deg, offset=(2.7, -1.1, -2.2))
    assert manifest.selected.metrics.iou > 0.999
    assert manifest.plan_fit == "accepted"


def test_spill_bounds_acceptance_but_never_hides_the_best_placement():
    """A candidate that spills too much makes the result unusable; it must not cause a worse,
    under-filled candidate to be reported in its place."""
    worst = min(FOOTPRINTS, key=lambda e: e["convexity"])
    manifest = place(worst)
    best = max(c.metrics.iou for c in manifest.candidates)
    assert manifest.selected.metrics.iou == pytest.approx(best)
    assert manifest.plan_fit == "rejected"


def test_uniform_scale_alone_renders_the_wrong_height():
    """Tying height to the plan scale is proportion-preserving but inherits the plan fit's error.
    Burruss is 20.7 m in OSM and comes out at roughly twice that from the plan fit alone."""
    entry = max(FOOTPRINTS, key=lambda e: e["area_m2"])
    manifest = place(entry)
    assert manifest.height == "inferred"
    assert manifest.selected.scale_y is None
    assert manifest.fitted_dimensions_m[1] == pytest.approx(
        manifest.source_dimensions_m[1] * manifest.selected.scale)


def test_a_recorded_height_sets_vertical_scale_without_touching_the_plan_fit():
    entry = max(FOOTPRINTS, key=lambda e: e["area_m2"])
    polygon = Polygon(entry["ring"])
    glb = building_glb(polygon, apron_m=0.0, overhang_m=0.0, yaw_deg=61.0, offset=(2.0, -1.5, 3.0))
    plain = fit_glb(glb, fit_request(entry["ring"]))
    request = fit_request(entry["ring"]).model_copy(update={"measured_height_m": 20.7})
    measured = fit_glb(glb, request)

    assert measured.height == "source-record"
    assert measured.fitted_dimensions_m[1] == pytest.approx(20.7, rel=1e-6)
    # The plan fit is a horizontal question; a height record must not move it.
    assert measured.selected.metrics.iou == pytest.approx(plain.selected.metrics.iou)
    assert measured.selected.scale == pytest.approx(plain.selected.scale)
    assert measured.fitted_dimensions_m[0] == pytest.approx(plain.fitted_dimensions_m[0])
    assert any("came from the footprint record" in w for w in measured.warnings)


def test_a_wildly_disagreeing_height_is_reported_not_forced():
    """A recorded height and a generated mesh often measure different things — OSM's `height` is
    typically the main eaves, while the mesh includes towers. Forcing it squashed Burruss by 2.34x.
    Proportions win; the disagreement becomes a warning."""
    entry = max(FOOTPRINTS, key=lambda e: e["area_m2"])
    polygon = Polygon(entry["ring"])
    glb = building_glb(polygon, apron_m=0.0, overhang_m=0.0, yaw_deg=61.0, offset=(2.0, -1.5, 3.0))
    plain = fit_glb(glb, fit_request(entry["ring"]))
    uniform_height = plain.fitted_dimensions_m[1]

    request = fit_request(entry["ring"]).model_copy(
        update={"measured_height_m": uniform_height / 3})
    manifest = fit_glb(glb, request)

    assert manifest.height == "inferred"
    assert manifest.selected.scale_y is None
    # Proportions preserved: height still follows the plan scale, not the record.
    assert manifest.fitted_dimensions_m[1] == pytest.approx(uniform_height)
    assert manifest.selected.metrics.iou == pytest.approx(plain.selected.metrics.iou)
    assert any("disagrees with the proportion-preserving fit" in w for w in manifest.warnings)


def test_a_height_within_the_bound_is_still_applied():
    entry = max(FOOTPRINTS, key=lambda e: e["area_m2"])
    polygon = Polygon(entry["ring"])
    glb = building_glb(polygon, apron_m=0.0, overhang_m=0.0, yaw_deg=61.0, offset=(2.0, -1.5, 3.0))
    uniform_height = fit_glb(glb, fit_request(entry["ring"])).fitted_dimensions_m[1]

    request = fit_request(entry["ring"]).model_copy(
        update={"measured_height_m": uniform_height * 1.1})
    manifest = fit_glb(glb, request)
    assert manifest.height == "source-record"
    assert manifest.fitted_dimensions_m[1] == pytest.approx(uniform_height * 1.1)
