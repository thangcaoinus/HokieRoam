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
        matrix = (translation(target_center[0], 0, -target_center[1]) @ yaw(beta)
                  @ np.diag([scale, scale, scale, 1]) @ k)
        candidates.append(FitCandidate(
            index=index, yaw_radians=beta - source_angle, scale=scale,
            matrix_column_major=matrix.flatten(order="F").tolist(),
            fitted_proxy=Polygon2D(exterior=placed_points.tolist()), metrics=metrics,
        ))
    valid = [c for c in candidates if c.metrics.contained and c.metrics.neighbor_overlap_m2 <= 1e-9]
    selected = max(valid or candidates, key=lambda c: (round(c.metrics.iou, 12), -c.index))
    accepted = bool(valid) and selected.metrics.iou >= request.min_iou
    status = "accepted" if accepted else "review" if valid else "rejected"
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
    if not valid:
        warnings.append("OBB fit fails actual containment or overlaps a supplied neighbor.")
    elif not accepted:
        warnings.append("Uniform placement underfills the target; inspect aspect mismatch.")
    return PlacementManifest(
        asset_sha256=hashlib.sha256(data).hexdigest(), frame=request.frame,
        provenance=request.provenance, request=request, selected=selected, candidates=candidates,
        plan_fit=status,
        neighbor_check="performed" if request.neighbors is not None else "not-provided",
        source_dimensions_m=tuple(source_dimensions),
        fitted_dimensions_m=tuple(source_dimensions * selected.scale), warnings=warnings,
    )
