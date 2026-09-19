"""Provider adapters implement base.GenerationProvider; routes never parse vendor JSON."""
from app.config import Settings
from app.providers.base import GenerationProvider
from app.providers.fixture import FixtureProvider
from app.providers.meshy import MeshyProvider


def build_provider(settings: Settings) -> GenerationProvider:
    """The single place a provider is chosen. Settings already validated the name."""
    if settings.provider == "fixture":
        return FixtureProvider(settings.fixture_delay)
    return MeshyProvider(settings)
