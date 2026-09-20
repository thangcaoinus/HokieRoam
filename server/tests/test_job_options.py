"""Per-job remesh targets survive replay/restart and reach the provider, without paid calls."""
import asyncio
import io
import json
import zipfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from app.config import Settings
from app.pipeline import Pipeline
from app.providers.fixture import FixtureProvider
from app.routes import router
from app.storage import JobStore


class RecordingFixture(FixtureProvider):
    def __init__(self):
        super().__init__()
        self.targets = []
        self.prompts = []

    async def submit(self, stage, images, prompt, strength, *, target_polycount=None):
        self.targets.append((stage, target_polycount))
        self.prompts.append((stage, prompt))
        return await super().submit(stage, images, prompt, strength,
                                    target_polycount=target_polycount)


@pytest.fixture
def api(tmp_path):
    settings = Settings(provider="fixture", data_dir=tmp_path, target_polycount=60000)
    store = JobStore(tmp_path)
    pipeline = Pipeline(settings, store, RecordingFixture())
    pipeline.schedule = lambda _: None
    app = FastAPI()
    app.state.settings = settings
    app.state.store = store
    app.state.pipeline = pipeline
    app.include_router(router)
    image = io.BytesIO()
    Image.new("RGB", (8, 8)).save(image, format="PNG")
    with TestClient(app) as client:
        def create(target=None, key="chosen", prompt="Scorched building"):
            data = {"prompt": prompt, "strength": "0.8", "kind": "pipeline"}
            if target is not None:
                data["target_polycount"] = str(target)
            return client.post("/v1/jobs", data=data,
                               files={"image": ("source.png", image.getvalue(), "image/png")},
                               headers={"Idempotency-Key": key})
        yield client, create, store


def test_selected_target_survives_replay_restart_and_export(api):
    client, create, store = api
    first = create(12000)
    assert first.status_code == 202
    job_id = first.json()["job_id"]
    replay = create(180000)
    assert replay.json()["job_id"] == job_id
    assert replay.json()["target_polycount"] == 12000
    second = create(90000, key="second").json()
    assert second["job_id"] != job_id
    provider = RecordingFixture()
    pipeline = Pipeline(Settings(provider="fixture", data_dir=store.root, target_polycount=30000), store, provider)
    asyncio.run(pipeline.run(job_id))
    asyncio.run(pipeline.run(second["job_id"]))
    assert provider.targets == [("redesign", 12000), ("reconstruct", 12000),
                                ("redesign", 90000), ("reconstruct", 90000)]
    asyncio.run(pipeline.run(job_id))
    assert len(provider.targets) == 4
    assert client.get(f"/v1/jobs/{job_id}").json()["target_polycount"] == 12000
    with zipfile.ZipFile(io.BytesIO(client.get(f"/v1/jobs/{job_id}/export").content)) as archive:
        assert json.loads(archive.read("generation.json"))["settings"]["target_polycount"] == 12000


@pytest.mark.parametrize("target", [99, 300001, "12000.5", "nan"])
def test_invalid_targets_rejected_before_job_creation(api, target):
    _, create, store = api
    assert create(target).status_code == 422
    assert store.all() == []
    assert store.submissions_used() == 0


def test_omitted_target_uses_server_default(api):
    _, create, store = api
    response = create()
    assert response.status_code == 202
    assert response.json()["target_polycount"] == 60000
    assert store.all()[0]["settings"]["target_polycount"] == 60000


@pytest.mark.parametrize("prompt", [" ", "\n\t", "x" * 2001])
def test_invalid_creative_prompt_rejected_before_submission(api, prompt):
    _, create, store = api
    assert create(prompt=prompt).status_code == 422
    assert store.all() == []
    assert store.submissions_used() == 0


def test_creative_prompt_survives_generation_and_export(api):
    client, create, store = api
    prompt = "Terracotta facade, copper fins and rooftop gardens.\nKeep the original windows."
    first = create(prompt=prompt).json()
    replay = create(prompt="Different style").json()
    assert replay["job_id"] == first["job_id"]
    provider = RecordingFixture()
    pipeline = Pipeline(Settings(provider="fixture", data_dir=store.root), store, provider)
    asyncio.run(pipeline.run(first["job_id"]))
    assert provider.prompts == [("redesign", prompt), ("reconstruct", prompt)]
    with zipfile.ZipFile(io.BytesIO(client.get(f"/v1/jobs/{first['job_id']}/export").content)) as archive:
        assert json.loads(archive.read("generation.json"))["settings"]["prompt"] == prompt
