"""Explicit synthetic adapter for offline integration. Never claims AI generation."""
import io
import time
import uuid

import trimesh
from PIL import Image

from app.providers.base import ProviderError, Stage, TaskSnapshot


class FixtureProvider:
    """Deterministic stand-in for a real generator, for development without credits.

    What it emits is an obvious placeholder — a flat colour swatch and an untextured box — so it can
    never be mistaken on screen for a generated building.

    ``delay_seconds`` simulates generation latency so the rest of the system can be developed
    against real queued -> running -> progress -> succeeded transitions instead of instant
    completion. The submit time is encoded in the task id rather than held in memory, so progress
    survives a server restart exactly the way a real provider's would. Default 0 = instant.
    """

    name = "fixture"

    def __init__(self, delay_seconds: float = 0.0):
        self.delay_seconds = max(0.0, delay_seconds)

    async def submit(
        self, stage: Stage, images: list[bytes], prompt: str, strength: float,
        *, target_polycount: int | None = None
    ) -> str:
        if not images:
            raise ProviderError("At least one source image is required")
        return f"fixture-{stage}-{time.time():.3f}-{uuid.uuid4().hex[:8]}"

    async def poll(self, stage: Stage, task_id: str) -> TaskSnapshot:
        parts = task_id.split("-")
        if parts[0] != "fixture" or len(parts) not in (3, 4):
            raise ProviderError("Unrecognised fixture task id")
        if len(parts) == 3:
            # Legacy id from before the submit time was encoded; samples/sample-input.json records
            # two of them. There is no timestamp to measure, so report it complete rather than
            # reject a cached sample.
            return TaskSnapshot("succeeded", 100, f"fixture://{stage}")
        try:
            submitted = float(parts[2])
        except ValueError as exc:
            raise ProviderError("Unrecognised fixture task id") from exc
        elapsed = time.time() - submitted
        if self.delay_seconds <= 0 or elapsed >= self.delay_seconds:
            return TaskSnapshot("succeeded", 100, f"fixture://{stage}")
        fraction = elapsed / self.delay_seconds
        return TaskSnapshot("running" if fraction > 0.1 else "pending", int(fraction * 100))

    async def download(self, url: str) -> bytes:
        if url == "fixture://redesign":
            output = io.BytesIO()
            Image.new("RGB", (64, 64), (145, 90, 45)).save(output, format="PNG")
            return output.getvalue()
        if url == "fixture://reconstruct":
            mesh = trimesh.creation.box(extents=[2, 1, 1])
            # Keep this dependency-free: face_colors makes trimesh convert face -> vertex
            # colours during GLB export, which asks for SciPy. vertex_colors reaches the same
            # brown placeholder box that samples/README.md describes without that dependency.
            mesh.visual.vertex_colors = [145, 90, 45, 255]
            return trimesh.Scene(mesh).export(file_type="glb")
        raise ProviderError("Unknown fixture artifact")

    async def close(self):
        pass
