"""Regression checks for the server-owned placement transform.

The input GLBs deliberately use scene-graph transforms: measuring only raw mesh
vertices would make all of these tests pass for the wrong reason.
"""

import numpy as np
import trimesh
from shapely.geometry import Polygon

from app.geometry.fit import fit_glb
from app.geometry.mesh import asset_vertices
from app.schemas import FitRequest, LocalFrame, Polygon2D, Provenance


def request(exterior, *, holes=None, min_iou=0.85):
    return FitRequest(
        footprint=Polygon2D(exterior=exterior, holes=holes or []),
        frame=LocalFrame(origin_longitude=-80.4, origin_latitude=37.2),
        provenance=Provenance(source="synthetic", feature_id="fixture", identity_confirmed=True),
        neighbors=[],
        min_iou=min_iou,
    )


def nested_box_glb(*, extents=(4.0, 2.0, 8.0), translation=(7.0, 3.0, -5.0)):
    """Create a box beneath both a translated parent and rotated child node."""
    scene = trimesh.Scene()
    scene.graph.update(
        frame_to="parent", matrix=trimesh.transformations.translation_matrix(translation)
    )
    scene.add_geometry(
        trimesh.creation.box(extents=extents),
        node_name="box",
        parent_node_name="parent",
        transform=trimesh.transformations.rotation_matrix(np.pi / 2, [0, 1, 0]),
    )
    return scene.export(file_type="glb")


def matrix(candidate):
    return np.array(candidate.matrix_column_major).reshape((4, 4), order="F")


def plan_polygon(vertices):
    # The manifest plan convention is (East, North) = (scene.x, -scene.z).
    return Polygon(vertices[:, [0, 2]] * [1, -1]).convex_hull


def test_nested_node_transforms_are_measured_grounded_and_scaled():
    data = nested_box_glb()
    manifest = fit_glb(data, request([(-8, -4), (8, -4), (8, 4), (-8, 4)]))

    assert manifest.plan_fit == "accepted"
    assert manifest.selected.metrics.iou == 1.0
    placed = trimesh.transform_points(asset_vertices(data), matrix(manifest.selected))
    assert np.isclose(placed[:, 1].min(), 0.0)
    # The source's 8 x 4 plan becomes the 16 x 8 target, despite nested transforms.
    assert np.allclose(np.ptp(placed[:, [0, 2]], axis=0), [16.0, 8.0])


def test_aspect_mismatch_underfills_instead_of_stretching():
    data = nested_box_glb(extents=(4.0, 2.0, 4.0))
    manifest = fit_glb(data, request([(-10, -2), (10, -2), (10, 2), (-10, 2)]))

    selected = manifest.selected
    assert selected.metrics.contained
    assert selected.metrics.spill_area_m2 == 0.0
    assert selected.metrics.coverage < 0.25
    assert manifest.plan_fit == "review"
    # A single scale factor is the contract; a 20 x 4 target must visibly underfill.
    assert manifest.fitted_dimensions_m[0] == manifest.fitted_dimensions_m[2]


def test_concave_and_holed_targets_are_not_accepted_from_their_obbs():
    data = nested_box_glb(extents=(4.0, 2.0, 4.0))
    concave = [(0, 0), (8, 0), (8, 3), (3, 3), (3, 8), (0, 8)]
    holed = [(0, 0), (8, 0), (8, 8), (0, 8)]
    hole = [(2, 2), (6, 2), (6, 6), (2, 6)]

    assert fit_glb(data, request(concave)).plan_fit != "accepted"
    assert fit_glb(data, request(holed, holes=[hole])).plan_fit != "accepted"


def test_export_reload_applies_the_placement_matrix_exactly_once():
    data = nested_box_glb(translation=(23.0, 6.0, -17.0))
    target = [(40, 10), (56, 10), (56, 18), (40, 18)]
    manifest = fit_glb(data, request(target))
    transform = matrix(manifest.selected)

    # Reloading the unchanged source asset and applying the serialized matrix
    # recreates the fitted proxy. Applying it twice must not be part of reload.
    once = trimesh.transform_points(asset_vertices(data), transform)
    twice = trimesh.transform_points(once, transform)
    expected = Polygon(manifest.selected.fitted_proxy.exterior)
    assert plan_polygon(once).symmetric_difference(expected).area < 1e-8
    assert plan_polygon(twice).symmetric_difference(expected).area > 1.0
