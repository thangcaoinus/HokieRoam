// Prepare a portable derived demo asset. Never modifies samples/live or contacts Meshy.
import { NodeIO } from '@gltf-transform/core'
import { simplify, weld } from '@gltf-transform/functions'
import { MeshoptSimplifier } from 'meshoptimizer'
import { mkdir, copyFile, writeFile, readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
const root = fileURLToPath(new URL('../../', import.meta.url))
const output = `${root}web/public/examples/dds`
await mkdir(output, {recursive:true})
await MeshoptSimplifier.ready
const io = new NodeIO()
const doc = await io.read(`${root}samples/live/model.glb`)
const triangles = () => doc.getRoot().listMeshes().reduce((sum,m) => sum + m.listPrimitives().reduce((n,p) => n + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3,0),0)
const before = triangles()
const ratio = 60000 / before
await doc.transform(weld(), simplify({simplifier:MeshoptSimplifier,ratio,error:0.005}))
await io.write(`${output}/model.glb`,doc)
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const optimization = {method:'gltf-transform simplify / meshoptimizer',ratio,error:0.005,source_triangles:before,triangles:triangles(),source_bytes:(await stat(`${root}samples/live/model.glb`)).size,bytes:(await stat(`${output}/model.glb`)).size,source_sha256:hash(await readFile(`${root}samples/live/model.glb`)),asset_sha256:hash(await readFile(`${output}/model.glb`))}
await writeFile(`${output}/optimization.json`,JSON.stringify(optimization,null,2))
await copyFile(`${root}samples/photo.png`,`${output}/source.png`)
await copyFile(`${root}samples/live/concept.png`,`${output}/concept.png`)
// Recompute placement for changed bytes; never retain the original asset's hash or fit.
execFileSync(`${root}server/.venv/bin/python`,['-c',`
import json,zipfile,hashlib,sys
from pathlib import Path
from app.geometry.fit import fit_glb
from app.schemas import FitRequest
root=Path(sys.argv[1]); out=root/'web/public/examples/dds'
original=json.loads((root/'samples/live/manifest.json').read_text())
manifest=fit_glb((out/'model.glb').read_bytes(),FitRequest.model_validate(original['request'])).model_dump(mode='json')
(out/'placement.json').write_text(json.dumps(manifest,indent=2))
with zipfile.ZipFile(root/'samples/live/bundle.zip') as z: generation=json.loads(z.read('generation.json'))
generation['derived_asset']=json.loads((out/'optimization.json').read_text())
generation['sha256']={k:hashlib.sha256((out/v).read_bytes()).hexdigest() for k,v in {'source':'source.png','concept':'concept.png','model':'model.glb'}.items()}
(out/'generation.json').write_text(json.dumps(generation,indent=2))
with zipfile.ZipFile(out/'bundle.zip','w',zipfile.ZIP_DEFLATED) as z:
 for name in ['model.glb','source.png','concept.png','placement.json','generation.json','optimization.json']: z.write(out/name,name)
meta={'id':'dds','title':'Data and Decision Sciences Building','address':'727 Prices Fork Road, Blacksburg, VA','prompt':generation['settings']['prompt'],'presetId':'campus','provider':'meshy','description':'Completed real generation, locally simplified for browser viewing. Placement needs review.','optimization':generation['derived_asset'],'placement':manifest}
(out/'example.json').write_text(json.dumps(meta,indent=2))
print(json.dumps({'plan_fit':manifest['plan_fit'],'iou':manifest['selected']['metrics']['iou']}))
`,root],{cwd:`${root}server`,stdio:'inherit'})
console.log(JSON.stringify(optimization,null,2))
