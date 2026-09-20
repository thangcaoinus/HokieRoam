"""Run/resume the authorized four-view Burruss Hall generation; never creates a second job."""
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

PROMPT = 'make this overflow green scape building'

async def main():
    settings = Settings()
    assert settings.api_key, 'MESHY_API_KEY is required'
    # Two earlier submissions are already recorded. This user-requested job needs exactly five:
    # four concept images, then one multi-image 3D build. Scope the cap to this invocation.
    settings = replace(settings, provider='meshy', max_submissions=7, target_polycount=60000)
    store = JobStore(settings.data_dir)
    provider = MeshyProvider(settings)
    pipeline = Pipeline(settings, store, provider)
    images = [p.read_bytes() for p in sorted((ROOT / 'inputs').glob('*.jpg'))]
    assert len(images) == 4
    job = pipeline.create(request_key='burruss-green-scape-four-views-2026-09-19-v1',
                          kind='pipeline', images=[(b, image_media(b)) for b in images],
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
