import os
from dataclasses import dataclass, field
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    data_dir: Path = field(default_factory=lambda: Path(os.environ.get(
        "PIPELINE_DATA_DIR", str(Path(__file__).resolve().parents[1] / ".data")
    )))
    provider: str = field(default_factory=lambda: os.getenv("PIPELINE_PROVIDER", "meshy"))
    api_key: str = field(default_factory=lambda: os.getenv("MESHY_API_KEY", ""), repr=False)
    image_model: str = field(default_factory=lambda: os.getenv("MESHY_IMAGE_MODEL", "nano-banana"))
    mesh_model: str = field(default_factory=lambda: os.getenv("MESHY_3D_MODEL", "meshy-6"))
    poll_seconds: float = field(
        default_factory=lambda: float(os.getenv("PIPELINE_POLL_SECONDS", "3")))
    max_submissions: int = field(
        default_factory=lambda: int(os.getenv("PIPELINE_MAX_SUBMISSIONS", "12")))
    compat_timeout: float = field(
        default_factory=lambda: float(os.getenv("PIPELINE_COMPAT_TIMEOUT", "120")))
    # Simulated latency for the fixture provider only; 0 completes instantly. Lets the frontend be
    # built against real progress transitions without spending credits. Ignored by meshy.
    fixture_delay: float = field(
        default_factory=lambda: float(os.getenv("PIPELINE_FIXTURE_DELAY_SECONDS", "0")))
    # Views per job. Meshy's multi-image-to-3d hard-caps at 4 and rejects more, so 4 is the real
    # ceiling, not a preference; this is configurable only so a provider change is one env var.
    max_views: int = field(default_factory=lambda: int(os.getenv("PIPELINE_MAX_VIEWS", "4")))
    # Remesh target. Unset, Meshy returns its raw mesh (our first live run: 1.75M triangles, 62 MB),
    # which is unusable in a browser demo.
    target_polycount: int = field(
        default_factory=lambda: int(os.getenv("MESHY_TARGET_POLYCOUNT", "60000")))
    max_image_bytes: int = 10 * 1024 * 1024
    max_asset_bytes: int = 100 * 1024 * 1024
    cors_origins: tuple[str, ...] = field(default_factory=lambda: tuple(os.getenv(
        "PIPELINE_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",")))

    def __post_init__(self):
        if self.provider not in {"meshy", "fixture"}:
            raise ValueError("PIPELINE_PROVIDER must be meshy or fixture")
        if self.poll_seconds <= 0 or self.max_submissions < 1 or self.compat_timeout <= 0:
            raise ValueError(
                "Polling, submission limit, and compatibility timeout must be positive")
        if self.fixture_delay < 0:
            raise ValueError("PIPELINE_FIXTURE_DELAY_SECONDS cannot be negative")
        if not 1 <= self.max_views <= 4:
            raise ValueError("PIPELINE_MAX_VIEWS must be 1-4; Meshy rejects more than four views")
        if not 100 <= self.target_polycount <= 300_000:
            raise ValueError("MESHY_TARGET_POLYCOUNT must be between 100 and 300000")
