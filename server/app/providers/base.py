from dataclasses import dataclass
from typing import Literal, Protocol

Stage = Literal["redesign", "reconstruct"]


class ProviderError(Exception):
    """Known rejection or failed remote task; message must not contain secrets."""


class SubmissionUnknown(ProviderError):
    """Remote task may have been accepted. Never automatically resubmit."""


@dataclass(frozen=True)
class TaskSnapshot:
    status: Literal["pending", "running", "succeeded", "failed"]
    progress: int | None = None
    output_url: str | None = None
    error: str | None = None


class GenerationProvider(Protocol):
    name: str

    # `images` is 1-4 views of the same building. Redesign styles one view at a time, so it always
    # receives exactly one; reconstruct receives every styled view at once.
    async def submit(
        self, stage: Stage, images: list[bytes], prompt: str, strength: float
    ) -> str: ...

    async def poll(self, stage: Stage, task_id: str) -> TaskSnapshot: ...

    async def download(self, url: str) -> bytes: ...

    async def close(self) -> None: ...
