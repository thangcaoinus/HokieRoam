"""Meshy API adapter. Live requests are opt-in through server configuration.

Contract references (verified September 19, 2026):
https://docs.meshy.ai/en/api/image-to-image
https://docs.meshy.ai/en/api/image-to-3d
"""
import base64
from urllib.parse import quote, urlparse

import httpx

from app.config import Settings
from app.providers.base import ProviderError, Stage, SubmissionUnknown, TaskSnapshot

# Reconstruct uses multi-image-to-3d, which accepts 1-4 views of the same object and therefore
# covers the single-view case too. One photo yields a flat facade with no depth; several views from
# different angles are what give the mesh an actual back and sides.
ENDPOINTS = {"redesign": "image-to-image", "reconstruct": "multi-image-to-3d"}


class MeshyProvider:
    name = "meshy"

    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None):
        self.settings = settings
        # Auth is per API request. Signed artifact URLs never receive the bearer token.
        self.client = client or httpx.AsyncClient(timeout=30, follow_redirects=False)

    def headers(self):
        return {"Authorization": f"Bearer {self.settings.api_key}"}

    @staticmethod
    def data_uri(image: bytes) -> str:
        media = "image/png" if image.startswith(b"\x89PNG") else "image/jpeg"
        return f"data:{media};base64,{base64.b64encode(image).decode()}"

    async def submit(
        self, stage: Stage, images: list[bytes], prompt: str, strength: float,
        *, target_polycount: int | None = None
    ) -> str:
        if not self.settings.api_key:
            raise ProviderError("Set MESHY_API_KEY on the backend to enable generation")
        if not images:
            raise ProviderError("At least one source image is required")
        if len(images) > self.settings.max_views:
            # Meshy rejects more than four; fail here rather than let it burn a round trip.
            raise ProviderError(
                f"multi-image-to-3d accepts at most {self.settings.max_views} views")
        uris = [self.data_uri(image) for image in images]
        if stage == "redesign":
            # One view at a time: the styled result must stay 1:1 with the photo it came from,
            # so the reconstruct stage can feed Meshy a consistent set of angles.
            # Meshy has no numeric strength parameter: preserve the user's intent in text.
            payload = {
                "ai_model": self.settings.image_model,
                "reference_image_urls": uris[:1],
                "prompt": (
                    f"{prompt}\nRequested style intensity: {strength:.2f}/1. "
                    "Preserve building silhouette, perspective, and visible structural layout."
                ),
            }
        else:
            payload = {
                # 1-4 views of the same building. One view produces a flat facade with no depth.
                "image_urls": uris, "ai_model": self.settings.mesh_model,
                "should_texture": True, "enable_pbr": True,
                "texture_resolution": "2k", "target_formats": ["glb"],
                # Without this Meshy returns its raw mesh - our first run was 1.75M triangles and
                # 62 MB, far too heavy to load in a browser demo.
                "should_remesh": True, "target_polycount": target_polycount if target_polycount is not None else self.settings.target_polycount,
            }
        try:
            response = await self.client.post(
                f"https://api.meshy.ai/openapi/v1/{ENDPOINTS[stage]}",
                headers=self.headers(), json=payload,
            )
        except httpx.RequestError as exc:
            raise SubmissionUnknown(
                "Submission interrupted; inspect Meshy before retrying") from exc
        if response.status_code >= 500:
            raise SubmissionUnknown("Meshy server error during submission; acceptance is unknown")
        if response.is_error:
            raise ProviderError(f"Meshy rejected submission (HTTP {response.status_code})")
        try:
            task_id = response.json()["result"]
            if not isinstance(task_id, str) or not task_id or len(task_id) > 200:
                raise ValueError("Invalid task id")
            return task_id
        except (ValueError, KeyError, TypeError) as exc:
            raise SubmissionUnknown(
                "Meshy response omitted a task ID; reconcile in provider account") from exc

    async def poll(self, stage: Stage, task_id: str) -> TaskSnapshot:
        response = await self.client.get(
            f"https://api.meshy.ai/openapi/v1/{ENDPOINTS[stage]}/{quote(task_id, safe='')}",
            headers=self.headers(),
        )
        response.raise_for_status()
        body = response.json()
        raw_status = body.get("status")
        states = {"PENDING": "pending", "IN_PROGRESS": "running", "SUCCEEDED": "succeeded",
                  "FAILED": "failed", "CANCELED": "failed"}
        if raw_status not in states:
            raise ProviderError("Unknown Meshy task status")
        url = None
        if raw_status == "SUCCEEDED":
            if stage == "redesign":
                urls = body.get("image_urls") or []
                url = urls[0] if urls else None
            else:
                url = (body.get("model_urls") or {}).get("glb")
            if not isinstance(url, str) or not url:
                raise ProviderError("Successful Meshy task has no expected artifact")
        progress = body.get("progress")
        progress = min(100, max(0, int(progress))) if isinstance(progress, (int, float)) else None
        return TaskSnapshot(
            status=states[raw_status], progress=progress, output_url=url,
            error=("Remote generation failed or was cancelled"
                   if states[raw_status] == "failed" else None),
        )

    async def download(self, url: str) -> bytes:
        parsed = urlparse(url)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
            raise ProviderError("Provider returned an invalid artifact URL")
        chunks = []
        size = 0
        async with self.client.stream("GET", url, timeout=60) as response:
            response.raise_for_status()
            async for chunk in response.aiter_bytes():
                size += len(chunk)
                if size > self.settings.max_asset_bytes:
                    raise ProviderError("Provider artifact exceeds the configured download limit")
                chunks.append(chunk)
        return b"".join(chunks)

    async def close(self):
        await self.client.aclose()
