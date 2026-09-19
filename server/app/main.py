"""HTTP surface for the Groundtruth pipeline — application assembly.

The contract is frozen in ``schemas.py`` and mirrored in ``web/src/lib/api.ts``; the handlers live
in ``routes.py`` and the orchestration in ``pipeline.py``. This module only wires them together.

The API is asynchronous on purpose: generation takes minutes, so a POST returns a job id promptly
and the client polls. Orchestration is one asyncio task per job in this same process — no worker,
no queue — which is why ``storage.py`` assumes exactly one application worker.

Money-protecting invariants live in ``pipeline.py``; see its docstring before changing it.
``MESHY_API_KEY`` stays server-side and is never exposed under a ``VITE_`` name or in a response.
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import Settings
from app.pipeline import Pipeline
from app.providers import build_provider
from app.routes import router
from app.storage import JobStore

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("groundtruth")

# Settings is frozen and validates PIPELINE_PROVIDER at construction, so a bad value fails the
# process at import rather than on the first request.
settings = Settings()
store = JobStore(settings.data_dir)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # The provider owns an httpx client, so it is built inside the running loop, not at import.
    pipeline = Pipeline(settings, store, build_provider(settings))
    app.state.settings = settings
    app.state.store = store
    app.state.pipeline = pipeline

    log.info("provider=%s submissions_used=%d/%d", settings.provider,
             store.submissions_used(), settings.max_submissions)
    # Re-attach to anything a restart interrupted. This resumes stored provider task ids; it can
    # never start a new paid generation.
    resumed = pipeline.resume_all()
    if resumed:
        log.info("resumed %d interrupted job(s): %s", len(resumed), ", ".join(resumed))
    try:
        yield
    finally:
        await pipeline.shutdown()


app = FastAPI(title="Groundtruth pipeline", version="1.0.0", lifespan=lifespan)

# Without CORS the browser cannot reach this API at all from the Vite dev server.
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Idempotency-Key"],
)
app.include_router(router)
