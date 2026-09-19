"""Contract checks for the Meshy adapter, driven against a mocked transport.

These do NOT prove the live Meshy API matches: only a real, paid call does that, and as of writing
`meshy.py` has never executed one. What they do prove is that the adapter's parsing and control flow
behave, and they cover the branches the fixture provider can never reach - above all the ones that
decide whether a failure may already have been billed.

The money rule these encode: a decisive rejection (4xx) is `ProviderError` and is safe. Anything
ambiguous - 5xx, a dropped connection, a response with no task id - is `SubmissionUnknown`, which
the pipeline treats as terminal and never retries.
"""
import asyncio
import json

import httpx
import pytest

from app.config import Settings
from app.providers.base import ProviderError, SubmissionUnknown
from app.providers.meshy import MeshyProvider

PNG = b"\x89PNG\r\n\x1a\n" + b"fake"
JPEG = b"\xff\xd8\xff" + b"fake"


def provider(handler, **overrides):
    """A MeshyProvider whose HTTP goes to `handler` instead of the network."""
    defaults = {"provider": "meshy", "api_key": "test-key",
                "image_model": "nano-banana", "mesh_model": "meshy-6"}
    settings = Settings(**{**defaults, **overrides})
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return MeshyProvider(settings, client=client)


def recorder(*responses):
    """Return (handler, calls); the handler replays `responses` in order and records requests."""
    calls = []
    queue = list(responses)

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        result = queue.pop(0) if len(queue) > 1 else queue[0]
        if isinstance(result, Exception):
            raise result
        return result

    return handler, calls


def run(coro):
    return asyncio.run(coro)


# -- submit ---------------------------------------------------------------------------------


def test_submit_sends_bearer_data_uri_and_returns_the_task_id():
    handler, calls = recorder(httpx.Response(200, json={"result": "task-abc"}))
    assert run(provider(handler).submit("redesign", PNG, "scorched", 0.8)) == "task-abc"

    request = calls[0]
    assert str(request.url) == "https://api.meshy.ai/openapi/v1/image-to-image"
    assert request.headers["Authorization"] == "Bearer test-key"
    payload = json.loads(request.content)
    assert payload["ai_model"] == "nano-banana"
    # The image is inlined as a data URI; Meshy never fetches it from us.
    assert payload["reference_image_urls"][0].startswith("data:image/png;base64,")
    # Meshy has no numeric strength knob, so intent has to survive in the prompt text.
    assert "scorched" in payload["prompt"] and "0.80/1" in payload["prompt"]


def test_submit_reconstruct_uses_the_image_to_3d_contract():
    handler, calls = recorder(httpx.Response(200, json={"result": "task-3d"}))
    assert run(provider(handler).submit("reconstruct", JPEG, "ignored", 0.5)) == "task-3d"

    payload = json.loads(calls[0].content)
    assert str(calls[0].url) == "https://api.meshy.ai/openapi/v1/image-to-3d"
    assert payload["image_url"].startswith("data:image/jpeg;base64,")
    assert payload["ai_model"] == "meshy-6" and payload["target_formats"] == ["glb"]


def test_submit_without_an_api_key_never_reaches_the_network():
    handler, calls = recorder(httpx.Response(200, json={"result": "nope"}))
    with pytest.raises(ProviderError):
        run(provider(handler, api_key="").submit("redesign", PNG, "x", 0.8))
    # The point is not the exception, it is that no request was issued.
    assert calls == []


def test_submit_rejection_is_a_provider_error_because_nothing_was_charged():
    handler, _ = recorder(httpx.Response(400, json={"message": "bad request"}))
    with pytest.raises(ProviderError) as caught:
        run(provider(handler).submit("redesign", PNG, "x", 0.8))
    assert not isinstance(caught.value, SubmissionUnknown)


def test_submit_server_error_is_submission_unknown():
    handler, _ = recorder(httpx.Response(503, text="unavailable"))
    with pytest.raises(SubmissionUnknown):
        run(provider(handler).submit("redesign", PNG, "x", 0.8))


def test_submit_network_failure_is_submission_unknown():
    handler, _ = recorder(httpx.ConnectError("connection reset"))
    with pytest.raises(SubmissionUnknown):
        run(provider(handler).submit("reconstruct", PNG, "x", 0.8))


@pytest.mark.parametrize("body", [{}, {"result": ""}, {"result": 42}, {"result": "x" * 201}])
def test_submit_without_a_usable_task_id_is_submission_unknown(body):
    # A 200 we cannot read a task id from is the worst case: Meshy may be generating and billing
    # while we hold no handle on it. Never downgrade this to a plain error.
    handler, _ = recorder(httpx.Response(200, json=body))
    with pytest.raises(SubmissionUnknown):
        run(provider(handler).submit("redesign", PNG, "x", 0.8))


# -- poll -----------------------------------------------------------------------------------


@pytest.mark.parametrize("raw,expected", [
    ("PENDING", "pending"), ("IN_PROGRESS", "running"),
    ("FAILED", "failed"), ("CANCELED", "failed"),
])
def test_poll_maps_the_documented_statuses(raw, expected):
    handler, _ = recorder(httpx.Response(200, json={"status": raw, "progress": 40}))
    snapshot = run(provider(handler).poll("reconstruct", "t1"))
    assert snapshot.status == expected and snapshot.progress == 40
    # A failed task must carry a reason the UI can show; a live one must not.
    assert (snapshot.error is not None) == (expected == "failed")


def test_poll_extracts_the_artifact_url_per_stage():
    image = httpx.Response(200, json={"status": "SUCCEEDED", "image_urls": ["https://cdn/a.png"]})
    handler, _ = recorder(image)
    assert run(provider(handler).poll("redesign", "t1")).output_url == "https://cdn/a.png"

    mesh = httpx.Response(200, json={"status": "SUCCEEDED", "model_urls": {"glb": "https://cdn/m.glb"}})
    handler, _ = recorder(mesh)
    assert run(provider(handler).poll("reconstruct", "t1")).output_url == "https://cdn/m.glb"


@pytest.mark.parametrize("body", [
    {"status": "SUCCEEDED"},
    {"status": "SUCCEEDED", "image_urls": []},
    {"status": "SUCCEEDED", "model_urls": {}},
])
def test_poll_success_without_an_artifact_is_an_error(body):
    handler, _ = recorder(httpx.Response(200, json=body))
    with pytest.raises(ProviderError):
        run(provider(handler).poll("redesign", "t1"))


def test_poll_rejects_an_unknown_status_rather_than_guessing():
    handler, _ = recorder(httpx.Response(200, json={"status": "WAT"}))
    with pytest.raises(ProviderError):
        run(provider(handler).poll("reconstruct", "t1"))


@pytest.mark.parametrize("raw,expected", [(150, 100), (-5, 0), (55, 55), ("x", None), (None, None)])
def test_poll_clamps_progress_into_the_contract_range(raw, expected):
    handler, _ = recorder(httpx.Response(200, json={"status": "IN_PROGRESS", "progress": raw}))
    assert run(provider(handler).poll("reconstruct", "t1")).progress == expected


def test_poll_encodes_the_task_id_into_a_single_path_segment():
    handler, calls = recorder(httpx.Response(200, json={"status": "PENDING"}))
    run(provider(handler).poll("reconstruct", "../../secret"))
    # A task id is data, not a path. It must not be able to climb the URL.
    assert "/openapi/v1/image-to-3d/..%2F..%2Fsecret" in str(calls[0].url)


# -- download -------------------------------------------------------------------------------


def test_download_streams_the_artifact_and_sends_no_credentials():
    handler, calls = recorder(httpx.Response(200, content=b"GLB-BYTES"))
    assert run(provider(handler).download("https://cdn.meshy.ai/a.glb")) == b"GLB-BYTES"
    # The bearer token is for the API only. A signed CDN URL must never receive it.
    assert "Authorization" not in calls[0].headers


@pytest.mark.parametrize("url", [
    "http://cdn.meshy.ai/a.glb",          # not TLS
    "ftp://cdn.meshy.ai/a.glb",           # not even http
    "https://user:pass@cdn/a.glb",        # credentials smuggled into the URL
    "file:///etc/passwd",                 # local file read
])
def test_download_rejects_an_unsafe_artifact_url(url):
    handler, calls = recorder(httpx.Response(200, content=b"x"))
    with pytest.raises(ProviderError):
        run(provider(handler).download(url))
    assert calls == []


def test_download_enforces_the_configured_size_cap():
    handler, _ = recorder(httpx.Response(200, content=b"x" * 500))
    with pytest.raises(ProviderError):
        run(provider(handler, max_asset_bytes=100).download("https://cdn/a.glb"))
