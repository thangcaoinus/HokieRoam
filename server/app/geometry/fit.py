import hashlib
import math

import numpy as np
import trimesh
from shapely.geometry import MultiPoint, Polygon
from shapely.validation import explain_validity

from app.geometry.frames import normalization, translation, yaw
from app.geometry.mesh import asset_vertices
from app.schemas import FitCandidate, FitMetrics, FitRequest, PlacementManifest, Polygon2D


def polygon(value: Polygon2D) -> Polygon:
    result = Polygon(value.exterior, value.holes)
    if not result.is_valid or result.is_empty or result.area <= 1e-12:
        raise ValueError(f"Invalid footprint: {explain_validity(result)}")
    return result


def obb(shape: Polygon):
    rectangle = shape.minimum_rotated_rectangle
    if not isinstance(rectangle, Polygon) or rectangle.area <= 1e-12:
        raise ValueError("Degenerate footprint or mesh projection")
    corners = np.array(rectangle.exterior.coords)[:4]
    edges = np.roll(corners, -1, axis=0) - corners
    lengths = np.linalg.norm(edges, axis=1)
    edge = edges[int(np.argmax(lengths))]
    angle = (math.atan2(edge[1], edge[0]) + math.pi/2) % math.pi - math.pi/2
    return np.array(rectangle.centroid.coords[0]), angle, max(lengths), min(lengths)


def fit_glb(data: bytes, request: FitRequest) -> PlacementManifest:
    target = polygon(request.footprint)
    neighbors = [polygon(p) for p in request.neighbors or []]
    original = asset_vertices(data)
    n = normalization(request.up_axis, request.unit_scale)
    vertices = trimesh.transform_points(original, n)
    proxy = MultiPoint(vertices[:, [0, 2]] * [1, -1]).convex_hull
    if not isinstance(proxy, Polygon):
        raise ValueError("Mesh has no usable horizontal area")
    source_center, source_angle, _, _ = obb(proxy)
    target_center, target_angle, target_length, target_width = obb(target)
    base = float(vertices[:, 1].min())
    k = yaw(-source_angle) @ translation(-source_center[0], -base, source_center[1]) @ n
    canonical = trimesh.transform_points(original, k)
    source_dimensions = np.ptp(canonical, axis=0)
    if min(source_dimensions) <= 1e-9:
        raise ValueError("Mesh must have nonzero width, height, and depth")
    q = np.array(MultiPoint(canonical[:, [0, 2]] * [1, -1]).convex_hull.exterior.coords)
    # Vertical scale is independent of the plan fit. Without a recorded height it follows the
    # uniform plan scale, which is proportion-preserving but inherits the plan fit's error.
    # A recorded height is applied only when it stays near the uniform scale: beyond that the two
    # are measuring different things (an OSM `height` is typically the main eaves, while a
    # generated mesh includes towers and roof forms), and forcing it visibly squashes the model.
    def vertical_scale(plan_scale: float) -> float | None:
        """Vertical scale from a recorded height, or None to keep uniform proportions."""
        if not request.measured_height_m:
            return None
        proposed = request.measured_height_m / source_dimensions[1]
        limit = request.max_height_correction
        return proposed if 1 / limit <= proposed / plan_scale <= limit else None

    candidates = []
    for index in range(4):
        beta = target_angle + index * math.pi / 2
        c, s = math.cos(beta), math.sin(beta)
        rotated = q @ np.array([[c, s], [-s, c]])
        ct, st = math.cos(target_angle), math.sin(target_angle)
        in_target_axes = rotated @ np.array([[ct, -st], [st, ct]])
        spans = np.ptp(in_target_axes, axis=0)
        scale = float(min(target_length / spans[0], target_width / spans[1]))
        placed_points = rotated * scale + target_center
        placed = Polygon(placed_points)
        intersection = placed.intersection(target).area
        spill = placed.difference(target).area
        overlap = sum(placed.intersection(neighbor).area for neighbor in neighbors)
        metrics = FitMetrics(
            iou=intersection / placed.union(target).area,
            coverage=intersection / target.area,
            spill_fraction=spill / placed.area, spill_area_m2=spill,
            contained=target.buffer(request.numerical_tolerance_m).covers(placed),
            neighbor_overlap_m2=overlap,
        )
        scale_y = vertical_scale(scale)
        matrix = (translation(target_center[0], 0, -target_center[1]) @ yaw(beta)
                  @ np.diag([scale, scale_y or scale, scale, 1]) @ k)
        candidates.append(FitCandidate(
            index=index, yaw_radians=beta - source_angle, scale=scale, scale_y=scale_y,
            matrix_column_major=matrix.flatten(order="F").tolist(),
            fitted_proxy=Polygon2D(exterior=placed_points.tolist()), metrics=metrics,
        ))
    # Containment is a *reported metric*, never the validity gate. `covers` is an exact
    # topological predicate, so a single vertex a nanometre outside fails it however good the
    # fit is -- and this transform chain's own floating-point noise is ~1e-5 m2 of spill,
    # ten times the 1e-6 m default tolerance. Gating on it rejected 4 of 12 geometrically
    # perfect fits (IoU 99.99999%) at random. Gate on bounded spill area instead, which is
    # what feasibility-plan.md 5.5 actually asks for.
    # Neighbour overlap is a hard physical constraint -- a building cannot occupy another
    # building -- so it filters what may be selected. Spill does not: it decides whether the
    # best placement is good enough, never which placement is reported. Filtering on spill
    # too makes the engine silently return a worse, under-filled candidate rather than say
    # the honest best fit is unusable.
    feasible = [c for c in candidates if c.metrics.neighbor_overlap_m2 <= 1e-9]
    selected = max(feasible or candidates, key=lambda c: (round(c.metrics.iou, 12), -c.index))
    placeable = (selected.metrics.spill_fraction <= request.max_spill_fraction
                 and selected.metrics.neighbor_overlap_m2 <= 1e-9)
    accepted = placeable and selected.metrics.iou >= request.min_iou
    status = "accepted" if accepted else "review" if placeable else "rejected"
    warnings = [
        "Projected hull is a conservative proxy, not a measured wall footprint.",
        "Facade heading is unverified; height is inferred and terrain is flat-assumed.",
    ]
    if not request.provenance.identity_confirmed:
        warnings.append("Building identity is not confirmed.")
        if status == "accepted":
            status = "review"
    if request.neighbors is None:
        warnings.append("Neighbor collision check was not supplied.")
    if not placeable:
        warnings.append(
            f"Best placement spills {selected.metrics.spill_fraction:.0%} of its plan area outside "
            f"the footprint (limit {request.max_spill_fraction:.0%}), or overlaps a neighbor."
        )
    elif not accepted:
        warnings.append("Uniform placement underfills the target; inspect aspect mismatch.")
    if request.measured_height_m and selected.scale_y:
        ratio = selected.scale_y / selected.scale
        warnings.append(
            f"Height {request.measured_height_m:.1f} m came from the footprint record, not the "
            f"mesh; vertical scale differs from the plan scale by {ratio:.2f}x."
        )
    elif request.measured_height_m:
        uniform = source_dimensions[1] * selected.scale
        warnings.append(
            f"Recorded height {request.measured_height_m:.1f} m disagrees with the proportion-"
            f"preserving fit ({uniform:.1f} m) by more than {request.max_height_correction:.2f}x, "
            "so proportions were kept and the record was not applied. A recorded height is often "
            "the main eaves while the mesh includes a tower; these measure different things."
        )
    if not selected.metrics.contained:
        warnings.append(
            f"Placement is not strictly contained: {selected.metrics.spill_area_m2:.2f} m2 "
            "of plan area falls outside the footprint."
        )
    return PlacementManifest(
        asset_sha256=hashlib.sha256(data).hexdigest(), frame=request.frame,
        provenance=request.provenance, request=request, selected=selected, candidates=candidates,
        plan_fit=status,
        neighbor_check="performed" if request.neighbors is not None else "not-provided",
        height="source-record" if selected.scale_y else "inferred",
        source_dimensions_m=tuple(source_dimensions),
        fitted_dimensions_m=tuple(
            source_dimensions * [selected.scale, selected.scale_y or selected.scale, selected.scale]
        ),
        warnings=warnings,
    )
