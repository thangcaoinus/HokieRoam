"""Run one authorized paid style generation, by name, into its own sample directory.

Generalizes samples/burruss-medieval-4view/run_generation.py so the final-sprint slate can run
three jobs concurrently. Two deliberate differences from that script:

  * Each run gets its OWN data directory (samples/<name>/.data). storage.py documents that it
    assumes exactly one application worker, and SQLite WAL admits one writer at a time, so three
    concurrent processes sharing server/.data would contend for the job ledger mid-generation.
    Isolating them removes the contention entirely. The reserve-before-submit invariant that
    protects real money is per-job, so it still holds inside each directory.
  * max_submissions is raised past the harness's historical 12, which is already spent.

Resumable by request key: a re-run re-attaches to the stored task ids and never resubmits.
Usage:  python samples/run_style_generation.py <name>
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
sys.path.insert(0, str(ROOT.parent / 'server'))
from app.config import Settings
from app.pipeline import Pipeline, view
from app.providers.meshy import MeshyProvider
from app.storage import JobStore, image_media

# Each prompt names the building. The medieval run's own README credits "still recognizable as
# burruss hall" for keeping the identity; the preset text alone (presets.ts) does not say it.
RUNS = {
    'burruss-scorched': dict(
        inputs=ROOT / 'burruss-medieval-4view' / 'inputs',
        request_key='burruss-scorched-four-views-2026-09-20-v1',
        prompt=(
            'Burruss Hall as a post-apocalyptic ruin: scorched stone, soot-stained facade, '
            'shattered windows, rusted steel, blowing dust, harsh amber sunlight, dead trees. '
            'Still unmistakably Burruss Hall - keep the central tower, the symmetric wings and '
            'the original architectural geometry.'),
    ),
    'burruss-noir': dict(
        inputs=ROOT / 'burruss-medieval-4view' / 'inputs',
        request_key='burruss-noir-four-views-2026-09-20-v1',
        prompt=(
            'Burruss Hall at cyberpunk night: rain-soaked facade, neon signage, magenta and cyan '
            'rim light, wet reflections on the plaza, holographic glow in the windows. '
            'Still unmistakably Burruss Hall - keep the central tower, the symmetric wings and '
            'the original architectural geometry.'),
    ),
    # The two above stay close to the preset text in presets.ts, which is deliberately conservative
    # (both are "dark and damaged"). These two push the style much harder in the opposite emotional
    # direction. Naming the building and its tower is what buys the licence: the medieval run proves
    # identity survives an aggressive restyle as long as the prompt pins the landmark features.
    'burruss-fantasy': dict(
        inputs=ROOT / 'burruss-medieval-4view' / 'inputs',
        request_key='burruss-fantasy-four-views-2026-09-20-v1',
        prompt=(
            'Burruss Hall reimagined as an enchanted high-fantasy citadel: pale gold and ivory '
            'stone, soaring slender spires crowned with banners, stained-glass rose windows '
            'glowing from within, floating lanterns in the air, carved dragons and filigree along '
            'the parapets, magical violet dusk light. Keep the central tower and the symmetric '
            'wings so it is still unmistakably Burruss Hall - keep the original architectural '
            'geometry.'),
    ),
    'burruss-solarpunk': dict(
        inputs=ROOT / 'burruss-medieval-4view' / 'inputs',
        request_key='burruss-solarpunk-four-views-2026-09-20-v1',
        prompt=(
            'Burruss Hall reimagined as a solarpunk utopia: living green walls and hanging gardens '
            'cascading down the facade, golden brass and warm timber accents, curved solar '
            'canopies over the roofline, wind sculptures, wildflower meadow on the lawn, bright '
            'optimistic afternoon sun. Keep the central tower and the symmetric wings so it is '
            'still unmistakably Burruss Hall - keep the original architectural geometry.'),
    ),
    'gilbert-scorched': dict(
        inputs=ROOT / 'gilbert-scorched' / 'inputs',
        request_key='gilbert-scorched-three-views-2026-09-20-v1',
        prompt=(
            'This modern university research building - terracotta rain-screen panels, ribbon '
            'glazing, metal cladding and a large cantilevered upper volume carried on round '
            'columns - as a post-apocalyptic ruin: scorched panels, soot-stained cladding, '
            'shattered curtain-wall glazing, exposed rusted steel, blowing dust, harsh amber '
            'sunlight. Keep the cantilever, the massing, the floor lines and the original '
            'architectural geometry so the building stays recognizable.'),
    ),
}


async def main(name: str):
    cfg = RUNS[name]
    out = ROOT / name
    out.mkdir(exist_ok=True)
    settings = Settings()
    assert settings.api_key, 'MESHY_API_KEY is required'
    assert settings.provider == 'meshy', f'refusing to run against provider={settings.provider!r}'
    settings = replace(settings, provider='meshy', max_submissions=50,
                       target_polycount=60_000, data_dir=out / '.data')
    store = JobStore(settings.data_dir)
    provider = MeshyProvider(settings)
    pipeline = Pipeline(settings, store, provider)
    images = [p.read_bytes() for p in sorted(Path(cfg['inputs']).glob('*.jpg'))]
    assert 1 <= len(images) <= 4, f'expected 1-4 input views, found {len(images)}'
    print(f'{name}: {len(images)} views, {len(images) + 1} paid submissions', flush=True)
    job = pipeline.create(request_key=cfg['request_key'], kind='pipeline',
                          images=[(b, image_media(b)) for b in images],
                          prompt=cfg['prompt'], strength=0.8, target_polycount=60_000)
    (out / 'job.json').write_text(view(job).model_dump_json(indent=2))
    print(f'{name}: job {job["job_id"]}', flush=True)
    runner = asyncio.create_task(pipeline.run(job['job_id']))
    previous = None
    try:
        while not runner.done():
            current = store.get(job['job_id'])
            (out / 'job.json').write_text(view(current).model_dump_json(indent=2))
            summary = (current['stage'], current['status'], current['progress'],
                       len(current['files']))
            if summary != previous:
                print(name, summary, flush=True)
                previous = summary
            await asyncio.sleep(5)
        await runner
        current = store.get(job['job_id'])
        (out / 'job.json').write_text(view(current).model_dump_json(indent=2))
        bundle = store.bundle(current)
        (out / 'bundle.zip').write_bytes(bundle)
        with zipfile.ZipFile(io.BytesIO(bundle)) as archive:
            archive.extractall(out / 'result')
        print(f'{name}: FINAL {current["status"]} {current["error"] or ""}', flush=True)
        if current['status'] != 'succeeded':
            raise SystemExit(1)
    finally:
        await provider.close()


if __name__ == '__main__':
    logging.basicConfig(level=logging.WARNING)
    target = sys.argv[1]
    assert target in RUNS, f'unknown run {target!r}; choose from {sorted(RUNS)}'
    asyncio.run(main(target))
