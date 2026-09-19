import io
import json
import struct

import numpy as np
import trimesh


def validate_glb(data: bytes) -> dict:
    if len(data) < 20 or data[:4] != b"glTF":
        raise ValueError("Expected a binary glTF (.glb) asset")
    _, version, length = struct.unpack_from("<4sII", data)
    if version != 2 or length != len(data):
        raise ValueError("Invalid GLB version or length")
    chunk_length, chunk_type = struct.unpack_from("<II", data, 12)
    if chunk_type != 0x4E4F534A or 20 + chunk_length > len(data):
        raise ValueError("GLB must start with a complete JSON chunk")
    try:
        document = json.loads(data[20:20+chunk_length])
    except (ValueError, UnicodeDecodeError) as exc:
        raise ValueError("Invalid GLB JSON") from exc
    if not isinstance(document, dict):
        raise ValueError("Invalid GLB document")
    if document.get("animations") or document.get("skins"):
        raise ValueError("Only static, unskinned building GLBs are supported")
    for item in document.get("buffers", []) + document.get("images", []):
        uri = item.get("uri", "")
        if uri and not uri.startswith("data:"):
            raise ValueError("GLB must embed all buffers and textures")
    return document


def asset_vertices(data: bytes) -> np.ndarray:
    validate_glb(data)
    try:
        scene = trimesh.load_scene(io.BytesIO(data), file_type="glb", process=False)
        parts = []
        total = 0
        for node in scene.graph.nodes_geometry:
            transform, geometry_name = scene.graph[node]
            geometry = scene.geometry[geometry_name]
            if not isinstance(geometry, trimesh.Trimesh) or not len(geometry.faces):
                continue
            total += len(geometry.vertices)
            if total > 2_000_000:
                raise ValueError("Asset exceeds the 2 million measured-vertex limit")
            parts.append(trimesh.transform_points(geometry.vertices, transform))
        if not parts:
            raise ValueError("GLB contains no triangle meshes")
        vertices = np.concatenate(parts)
        if not np.isfinite(vertices).all():
            raise ValueError("Asset contains non-finite geometry")
        return vertices
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError("Cannot decode this GLB; use a static uncompressed GLB") from exc
