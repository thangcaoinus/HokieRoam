// Prepare a portable derived demo asset. Never modifies samples/ and never contacts a provider.
//
//   node scripts/prepare-example.mjs            # the demo example (burruss)
//   node scripts/prepare-example.mjs dds        # the honest rejection example
//
// Two examples are built by the same path because they carry different evidence: burruss is the
// compelling transformation, dds is the placement the engine correctly refuses. Both must stay
// reproducible from checked-in artifacts with no network access.
import { NodeIO } from '@gltf-transform/core'
import { simplify, weld } from '@gltf-transform/functions'
import { MeshoptSimplifier } from 'meshoptimizer'
import { mkdir, copyFile, writeFile, readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const root = fileURLToPath(new URL('../../', import.meta.url))
const TARGET_TRIANGLES = 60000

/** Burruss restyles differ only by sample directory, preset and blurb; everything else is shared. */
const styleOfBurruss = (id, presetId, description) => ({
  id,
  model: `samples/${id}/result/model.glb`,
  generation: `samples/${id}/result/generation.json`,
  bundle: `samples/${id}/bundle.zip`,
  photos: ['source.jpg', 'source_2.jpg', 'source_3.jpg', 'source_4.jpg'],
  concepts: ['concept.png', 'concept_2.png', 'concept_3.png', 'concept_4.png'],
  footprint: 'web/scripts/burruss-footprint.json',
  title: 'Burruss Hall',
  address: '800 Drillfield Drive, Blacksburg, VA',
  featureId: 'way/32963472',
  presetId,
  description,
})

const EXAMPLES = {
  // Meshy already met the 60k target here, so decimation is a no-op and the asset ships as-is.
  burruss: {
    id: 'burruss',
    model: 'samples/burruss-medieval-4view/result/model.glb',
    generation: 'samples/burruss-medieval-4view/result/generation.json',
    bundle: 'samples/burruss-medieval-4view/bundle.zip',
    photos: ['source.jpg', 'source_2.jpg', 'source_3.jpg', 'source_4.jpg'],
    concepts: ['concept.png'],
    footprint: 'web/scripts/burruss-footprint.json',
    title: 'Burruss Hall',
    address: '800 Drillfield Drive, Blacksburg, VA',
    featureId: 'way/32963472',
    presetId: 'campus',
    description: 'Completed real four-view generation. Placement is measured and shown honestly.',
  },
  dds: {
    id: 'dds',
    model: 'samples/live/model.glb',
    generation: 'samples/live/bundle.zip',
    bundle: 'samples/live/bundle.zip',
    photos: ['samples/photo.png'],
    concepts: ['samples/live/concept.png'],
    manifest: 'samples/live/manifest.json',
    title: 'Data and Decision Sciences Building',
    address: '727 Prices Fork Road, Blacksburg, VA',
    presetId: 'campus',
    description: 'Completed real generation, locally simplified for browser viewing. Placement needs review.',
  },
  // One building, five worlds. Every entry below reuses burruss-footprint.json and way/32963472
  // unchanged: same photographs, same authoritative footprint, only the prompt differs, so the
  // IoU spread across them measures what the restyle cost the geometry rather than noise.
  'burruss-scorched': styleOfBurruss('burruss-scorched', 'scorched',
    'Scorched Nebraska: the sponsor track\u2019s own world, generated from the same four photographs.'),
  'burruss-noir': styleOfBurruss('burruss-noir', 'noir',
    'Neon Noir. The 3D submission froze as submission-unknown and was recovered by hand after reconciling with the provider.'),
  'burruss-fantasy': styleOfBurruss('burruss-fantasy', 'fantasy',
    'Enchanted Citadel: the most aggressive restyle in the set, and the landmark still survives it.'),
  'burruss-solarpunk': styleOfBurruss('burruss-solarpunk', 'solarpunk',
    'Solarpunk Bloom: the optimistic future, to show the range is not only ruin.'),
  // A second building, same apocalypse prompt: 1936 collegiate gothic against a 2024 research
  // building. Its footprint was recovered from the live Overpass lookup stored in the job ledger.
  'gilbert-scorched': {
    id: 'gilbert-scorched',
    model: 'samples/gilbert-scorched/result/model.glb',
    generation: 'samples/gilbert-scorched/result/generation.json',
    bundle: 'samples/gilbert-scorched/bundle.zip',
    photos: ['source.jpg', 'source_2.jpg', 'source_3.jpg'],
    concepts: ['concept.png'],
    footprint: 'web/scripts/gilbert-footprint.json',
    title: 'Gilbert Place',
    address: '220 Gilbert Street, Blacksburg, VA',
    featureId: 'way/43972334',
    presetId: 'scorched',
    description: 'The same post-apocalyptic prompt on a modern research building. Placement is measured and shown honestly.',
  },
}

const name = process.argv[2] ?? 'burruss'
const config = EXAMPLES[name]
if (!config) throw new Error(`Unknown example "${name}". Choose one of: ${Object.keys(EXAMPLES).join(', ')}`)
const output = `${root}web/public/examples/${config.id}`
await mkdir(output, { recursive: true })

await MeshoptSimplifier.ready
const io = new NodeIO()
const doc = await io.read(`${root}${config.model}`)
const triangles = () => doc.getRoot().listMeshes().reduce((sum, m) =>
  sum + m.listPrimitives().reduce((n, p) =>
    n + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0), 0)
const before = triangles()
const ratio = TARGET_TRIANGLES / before
// A ratio at or above 1 would be an upsample request; the asset is already within budget.
const decimated = ratio < 1
if (decimated) await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.005 }))
await io.write(`${output}/model.glb`, doc)

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const optimization = {
  method: decimated ? 'gltf-transform simplify / meshoptimizer' : 'none — source already within the triangle budget',
  ratio: decimated ? ratio : 1, error: decimated ? 0.005 : 0,
  source_triangles: before, triangles: triangles(),
  source_bytes: (await stat(`${root}${config.model}`)).size,
  bytes: (await stat(`${output}/model.glb`)).size,
  source_sha256: hash(await readFile(`${root}${config.model}`)),
  asset_sha256: hash(await readFile(`${output}/model.glb`)),
}
await writeFile(`${output}/optimization.json`, JSON.stringify(optimization, null, 2))

// Photos and concepts come either from the sample tree or from the job bundle.
const photoNames = [], conceptNames = []
for (const [list, sources, prefix, fallbackExt] of [
  [photoNames, config.photos, 'source', 'jpg'], [conceptNames, config.concepts, 'concept', 'png']]) {
  for (const [index, entry] of sources.entries()) {
    const ext = entry.split('.').pop() ?? fallbackExt
    const target = index === 0 ? `${prefix}.${ext}` : `${prefix}_${index + 1}.${ext}`
    if (entry.includes('/')) await copyFile(`${root}${entry}`, `${output}/${target}`)
    else execFileSync('unzip', ['-o', '-j', `${root}${config.bundle}`, entry, '-d', output], { stdio: 'ignore' })
    if (!entry.includes('/') && entry !== target) {
      await copyFile(`${output}/${entry}`, `${output}/${target}`)
    }
    list.push(target)
  }
}

execFileSync(`${root}server/.venv/bin/python`, ['-c', `
import json,zipfile,hashlib,sys
from pathlib import Path
from app.geometry.fit import fit_glb
from app.schemas import FitRequest
root=Path(sys.argv[1]); out=root/('web/public/examples/'+sys.argv[2]); config=json.loads(sys.argv[3])
photos=json.loads(sys.argv[4]); concepts=json.loads(sys.argv[5]); optimization=json.loads(sys.argv[6])

if 'manifest' in config:
    request=FitRequest.model_validate(json.loads((root/config['manifest']).read_text())['request'])
else:
    fp=json.loads((root/config['footprint']).read_text())
    # These constants must equal what web/src/lib/placement.ts:fitRequest sends, or the browser's
    # placementMatches check will reject the cached example as belonging to another footprint.
    request=FitRequest.model_validate({
        'footprint':{'exterior':fp['exterior'],'holes':[]},
        'frame':{'origin_longitude':fp['origin_longitude'],'origin_latitude':fp['origin_latitude'],
                 'origin_height_m':0,'convention':'X=east,Y=up,Z=south','ground_mode':'flat-assumed'},
        'provenance':{'source':'osm','feature_id':config['featureId'],
                      'source_url':'https://www.openstreetmap.org/'+config['featureId'],
                      'identity_confirmed':True},
        'neighbors':[],'up_axis':'Y','unit_scale':1.0,
        'min_iou':0.85,'numerical_tolerance_m':1e-6,'max_spill_fraction':0.15,
        'measured_height_m':fp.get('measured_height_m'),'max_height_correction':1.25})

manifest=fit_glb((out/'model.glb').read_bytes(),request).model_dump(mode='json')
(out/'placement.json').write_text(json.dumps(manifest,indent=2))

gen=root/config['generation']
generation=json.loads(zipfile.ZipFile(gen).read('generation.json') if gen.suffix=='.zip' else gen.read_text())
generation['derived_asset']=optimization
# Keyed by ARTIFACT name (source, source_2, concept, model), not by filename: savedBundle.ts
# checks generation.sha256.model against the placement's asset hash.
def artifact_key(prefix, index): return prefix if index == 0 else f'{prefix}_{index+1}'
sha={artifact_key('source',i):hashlib.sha256((out/n).read_bytes()).hexdigest()
     for i,n in enumerate(photos)}
sha.update({artifact_key('concept',i):hashlib.sha256((out/n).read_bytes()).hexdigest()
            for i,n in enumerate(concepts)})
sha['model']=hashlib.sha256((out/'model.glb').read_bytes()).hexdigest()
generation['sha256']=sha
(out/'generation.json').write_text(json.dumps(generation,indent=2))

names=photos+concepts+['model.glb','placement.json','generation.json','optimization.json']
with zipfile.ZipFile(out/'bundle.zip','w',zipfile.ZIP_DEFLATED) as z:
    for n in names: z.write(out/n,n)

meta={'id':config['id'],'title':config['title'],'address':config['address'],
      'prompt':generation['settings']['prompt'],'presetId':config['presetId'],'provider':'meshy',
      'description':config['description'],'photos':photos,'concept':concepts[0],
      'optimization':optimization,'placement':manifest}
(out/'example.json').write_text(json.dumps(meta,indent=2))
print(json.dumps({'example':config['id'],'plan_fit':manifest['plan_fit'],
                  'iou':round(manifest['selected']['metrics']['iou'],6),
                  'triangles':optimization['triangles'],'decimated':optimization['ratio']<1}))
`, root, config.id, JSON.stringify(config), JSON.stringify(photoNames), JSON.stringify(conceptNames),
   JSON.stringify(optimization)], { cwd: `${root}server`, stdio: 'inherit' })
