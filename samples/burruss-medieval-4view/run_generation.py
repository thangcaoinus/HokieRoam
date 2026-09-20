"""Run/resume the authorized four-view Burruss Hall medieval-fantasy generation.

Four photographs, four concepts, one multi-image 3D build: exactly five paid submissions.
Resumable by request key - a re-run re-attaches to the stored task ids and never resubmits.
"""
import asyncio
import io
import json
import logging
import sys
import zipfile
from dataclasses import replace
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parents[1] / 'server'))
from app.config import Settings
from app.pipeline import Pipeline, view
from app.providers.meshy import MeshyProvider
from app.storage import JobStore, image_media

PROMPT = ('Make this looks like an old building medieval fantasy building with greenery, but '
          'contained, not like complete overhaul of it, but just some modification to howw the '
          'wall, maybe some hole, maybe vine, etc... but still recognizable as burruss hall')
REQUEST_KEY = 'burruss-medieval-four-views-2026-09-19-v1'

async def main():
    settings = Settings()
    assert settings.api_key, 'MESHY_API_KEY is required'
    # Seven submissions are already recorded (earlier jobs + the stalled green-scape run + the 1-view run).
    # This user-authorized job needs exactly five more: four concept images, then one 3D build.
    settings = replace(settings, provider='meshy', max_submissions=12, target_polycount=60000)
    store = JobStore(settings.data_dir)
    provider = MeshyProvider(settings)
    pipeline = Pipeline(settings, store, provider)
    images = [p.read_bytes() for p in sorted((ROOT / 'inputs').glob('*.jpg'))]
    assert len(images) == 4, f'expected 4 input views, found {len(images)}'
    job = pipeline.create(request_key=REQUEST_KEY, kind='pipeline',
                          images=[(b, image_media(b)) for b in images],
                          prompt=PROMPT, strength=0.8, target_polycount=60000)
    (ROOT / 'job.json').write_text(view(job).model_dump_json(indent=2))
    print('Job:', job['job_id'], flush=True)
    runner = asyncio.create_task(pipeline.run(job['job_id']))
    previous = None
    try:
        while not runner.done():
            current = store.get(job['job_id'])
            (ROOT / 'job.json').write_text(view(current).model_dump_json(indent=2))
            summary = (current['stage'], current['status'], current['progress'], len(current['files']))
            if summary != previous:
                print(summary, flush=True)
                previous = summary
            await asyncio.sleep(5)
        await runner
        current = store.get(job['job_id'])
        (ROOT / 'job.json').write_text(view(current).model_dump_json(indent=2))
        bundle = store.bundle(current)
        (ROOT / 'bundle.zip').write_bytes(bundle)
        with zipfile.ZipFile(io.BytesIO(bundle)) as archive:
            archive.extractall(ROOT / 'result')
        print('Final:', current['status'], current['error'], flush=True)
        print('Saved:', ROOT / 'bundle.zip', flush=True)
        if current['status'] != 'succeeded':
            raise SystemExit(1)
    finally:
        await provider.close()

if __name__ == '__main__':
    logging.basicConfig(level=logging.WARNING)
    asyncio.run(main())
