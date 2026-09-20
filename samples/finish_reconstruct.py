"""Finish a run whose redesign concepts landed but whose 3D submission returned submission-unknown.

Why this is not an auto-retry. `SubmissionUnknown` means the provider MAY already have accepted and
billed the task, so `pipeline.py` freezes the job and refuses to resubmit - that rule protects real
money and stays. This script is the documented human step after that freeze: **reconcile in the
provider account first**, then, only if reconciliation shows no remote task was created, submit the
one missing call by hand.

Reconciliation performed for burruss-noir at 04:22 on 2026-09-20: Meshy's multi-image-to-3d task
list showed exactly two in-progress tasks, both accounted for (01a0bde4 = gilbert-scorched, created
04:17:45; 01a0bde6 = burruss-scorched, created 04:20:05). No task existed for the noir submit, so it
never reached Meshy and nothing was billed for it.

Usage:  python samples/finish_reconstruct.py <name>
"""
import asyncio
import io
import json
import sys
import zipfile
from dataclasses import replace
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent / 'server'))
from app.config import Settings
from app.geometry.mesh import validate_glb
from app.providers.meshy import MeshyProvider
from app.storage import JobStore


async def main(name: str):
    out = ROOT / name
    published = json.loads((out / 'job.json').read_text())
    assert published['status'] == 'submission-unknown', \
        f'{name} is {published["status"]!r}, not frozen'
    # JobView is the projection; the prompt and strength live on the stored job.
    job = JobStore(out / '.data').get(published['job_id'])
    assert not job['provider_tasks'].get('reconstruct'), 'a reconstruct task id already exists'
    data = out / '.data' / job['job_id']
    concepts = sorted(data.glob('concept*.png'), key=lambda p: (len(p.stem), p.stem))
    assert concepts, 'no concept images to reconstruct from'
    print(f'{name}: reconstructing from {len(concepts)} concepts', flush=True)

    settings = Settings()
    assert settings.api_key and settings.provider == 'meshy'
    settings = replace(settings, target_polycount=60_000)
    provider = MeshyProvider(settings)
    try:
        task = await provider.submit(
            'reconstruct', [p.read_bytes() for p in concepts],
            job['settings']['prompt'], job['settings']['strength'], target_polycount=60_000)
        (out / 'reconstruct-task.txt').write_text(task)  # written before the first poll
        print(f'{name}: task {task}', flush=True)
        previous = None
        while True:
            snap = await provider.poll('reconstruct', task)
            if (snap.status, snap.progress) != previous:
                print(name, snap.status, snap.progress, flush=True)
                previous = (snap.status, snap.progress)
            if snap.status == 'succeeded':
                break
            if snap.status == 'failed':
                raise SystemExit(f'{name}: {snap.error}')
            await asyncio.sleep(5)
        glb = await provider.download(snap.output_url)
        validate_glb(glb)  # a provider is not trusted to return what it promised
        result = out / 'result'
        result.mkdir(exist_ok=True)
        (result / 'model.glb').write_bytes(glb)
        for src in list(data.glob('concept*.png')) + list(data.glob('source*.jpg')):
            (result / src.name).write_bytes(src.read_bytes())
        # Same shape storage.bundle() writes: prepare-example.mjs reads settings.prompt.
        generation = {
            'job_id': job['job_id'], 'kind': job['kind'], 'provider': 'meshy',
            'provider_tasks': {**job['provider_tasks'], 'reconstruct': task},
            'settings': dict(job['settings'], provider='meshy',
                             image_model=settings.image_model, mesh_model=settings.mesh_model),
            'warnings': job.get('warnings', []),
            'recovery': ('3D submission recovered by hand after a submission-unknown freeze; '
                         'the provider task list was reconciled first and showed no task, so '
                         'nothing had been billed and this was a first submission, not a retry.'),
        }
        (result / 'generation.json').write_text(json.dumps(generation, indent=2))
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
            for f in sorted(result.iterdir()):
                z.write(f, f.name)
        (out / 'bundle.zip').write_bytes(buf.getvalue())
        print(f'{name}: FINAL succeeded, {len(glb)} bytes', flush=True)
    finally:
        await provider.close()


if __name__ == '__main__':
    asyncio.run(main(sys.argv[1]))
