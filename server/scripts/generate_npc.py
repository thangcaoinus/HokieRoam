"""One-off: generate the HokieBird NPC mesh from four cropped mascot photos.

This is NOT a pipeline job. The pipeline is address -> building; an NPC has no address, no
footprint and no placement, so it never touches `pipeline.py`, `routes.py` or the job store's
job table. It does go through `MeshyProvider` and `reserve_submission` on purpose, so the
paid-generation invariants that protect real money still apply:

  * the submission key is reserved in SQLite BEFORE the provider call, under the same cap;
  * `SubmissionUnknown` is terminal — the task may already have been accepted and billed, so
    this script stops and tells a human to reconcile rather than retrying;
  * polling and re-running resume the recorded task id instead of submitting again.

Re-running after a successful submit is safe: the reservation is already held, the task id is
written to `--state`, and this script will resume polling it. Deleting the state file does NOT
make a resubmit safe — reconcile in the Meshy account first.

Run from `server/`, with the environment exported (nothing here reads a dotenv):

    set -a; . .env; set +a
    .venv/bin/python scripts/generate_npc.py --views <dir> --out <path.glb>
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import Settings  # noqa: E402
from app.geometry.mesh import validate_glb  # noqa: E402
from app.providers.base import ProviderError, SubmissionUnknown  # noqa: E402
from app.providers.meshy import MeshyProvider  # noqa: E402
from app.storage import JobStore  # noqa: E402

# A distinct, stable key: this asset is generated once for the whole project, so a second run
# collides with its own reservation instead of quietly buying a second mascot.
SUBMISSION_KEY = "npc-hokiebird:reconstruct"


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--views", required=True, help="directory of 1-4 cropped PNG/JPG views")
    ap.add_argument("--out", required=True, help="where to write the GLB")
    ap.add_argument("--state", default=".data/npc-hokiebird.json")
    ap.add_argument("--polycount", type=int, default=15000)
    ap.add_argument("--poll-seconds", type=float, default=10.0)
    args = ap.parse_args()

    settings = Settings()
    if settings.provider != "meshy" or not settings.api_key:
        print("Refusing to run: PIPELINE_PROVIDER must be 'meshy' and MESHY_API_KEY must be set.")
        print("Nothing generated without a live key is real, so this script will not pretend.")
        return 2

    views = sorted(p for p in Path(args.views).iterdir()
                   if p.suffix.lower() in {".png", ".jpg", ".jpeg"})
    if not 1 <= len(views) <= settings.max_views:
        print(f"Need 1-{settings.max_views} views, found {len(views)} in {args.views}")
        return 2
    images = [p.read_bytes() for p in views]
    print(f"views ({len(images)}):")
    for p, b in zip(views, images):
        print(f"  {p.name:28} {len(b) // 1024:>5} kB")

    state_path = Path(args.state)
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    storage = JobStore(settings.data_dir)
    provider = MeshyProvider(settings)

    try:
        task_id = state.get("task_id")
        if task_id:
            print(f"\nresuming recorded task {task_id} — no new submission")
        else:
            if storage.has_submission(SUBMISSION_KEY):
                # Reserved with no task id recorded: the provider may already have accepted and
                # billed this. Resubmitting would buy it twice.
                print(f"\nSubmission key {SUBMISSION_KEY!r} is reserved but no task id is stored.")
                print("The provider may already have accepted and billed this request.")
                print("Reconcile at https://www.meshy.ai/ before doing anything else.")
                return 3
            storage.reserve_submission(SUBMISSION_KEY, settings.max_submissions)
            print(f"\nreserved {SUBMISSION_KEY!r}; submitting multi-image-to-3d "
                  f"(model={settings.mesh_model}, target_polycount={args.polycount})")
            try:
                task_id = await provider.submit(
                    "reconstruct", images, prompt="", strength=0.0,
                    target_polycount=args.polycount,
                )
            except SubmissionUnknown as exc:
                # Never auto-retry: the remote task may exist and be billed.
                print(f"\nSUBMISSION UNKNOWN: {exc}")
                print("The task may have been accepted. Do not re-run. Reconcile in Meshy first.")
                return 4
            state["task_id"] = task_id
            state_path.write_text(json.dumps(state, indent=2))
            print(f"task {task_id} recorded in {state_path}")

        while True:
            snap = await provider.poll("reconstruct", task_id)
            print(f"  {snap.status:<10} {snap.progress if snap.progress is not None else '--':>3}%")
            if snap.status == "succeeded":
                break
            if snap.status == "failed":
                print(f"generation failed: {snap.error}")
                return 5
            await asyncio.sleep(args.poll_seconds)

        print("\ndownloading GLB")
        data = await provider.download(snap.output_url)
        # A provider is not trusted to return what it promised.
        validate_glb(data)
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(data)
        state["glb_bytes"] = len(data)
        state_path.write_text(json.dumps(state, indent=2))
        print(f"wrote {out} ({len(data) / 1e6:.2f} MB), validated as binary glTF 2")
        return 0
    except (ProviderError, ValueError) as exc:
        print(f"\nerror: {exc}")
        return 1
    finally:
        await provider.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
