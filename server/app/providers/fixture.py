"""Explicit synthetic adapter for offline integration. Never claims AI generation."""
import io
import uuid

from PIL import Image
import trimesh

from app.providers.base import ProviderError, Stage, TaskSnapshot


class FixtureProvider:
    name = "fixture"

    async def submit(self, stage: Stage, image: bytes, prompt: str, strength: float) -> str:
        return f"fixture-{stage}-{uuid.uuid4().hex}"

    async def poll(self, stage: Stage, task_id: str) -> TaskSnapshot:
        return TaskSnapshot("succeeded", 100, f"fixture://{stage}")

    async def download(self, url: str) -> bytes:
        if url == "fixture://redesign":
            output = io.BytesIO()
            Image.new("RGB", (64, 64), (145, 90, 45)).save(output, format="PNG")
            return output.getvalue()
        if url == "fixture://reconstruct":
            mesh = trimesh.creation.box(extents=[2, 1, 1])
            # Keep this dependency-free. Face-color export asks trimesh for SciPy,
            # which is deliberately not a runtime dependency of the fixture path.
            return trimesh.Scene(mesh).export(file_type="glb")
        raise ProviderError("Unknown fixture artifact")

    async def close(self):
        pass
