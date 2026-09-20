/** Run against an isolated fixture API and Vite dev server. See web/README.md. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFile, mkdir } from 'node:fs/promises'
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const api = process.env.CHECK_API || 'http://127.0.0.1:8001'
const web = process.env.CHECK_WEB || 'http://localhost:5174'
const health = await (await fetch(`${api}/v1/health`)).json()
assert.equal(health.provider, 'fixture', 'This check must never submit paid generation')
const form = new FormData()
form.append('image', new Blob([await readFile(new URL('../../samples/photo.png', import.meta.url))], { type: 'image/png' }), 'photo.png')
form.append('prompt', 'placement integration fixture')
form.append('strength', '0.5')
let job = await (await fetch(`${api}/v1/jobs`, { method: 'POST', headers: { 'Idempotency-Key': 'placement-check-reusable' }, body: form })).json()
for (let n = 0; n < 100 && job.status !== 'succeeded'; n++) {
  await new Promise((r) => setTimeout(r, 200))
  job = await (await fetch(`${api}/v1/jobs/${job.job_id}`)).json()
}
assert.equal(job.status, 'succeeded')
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] })
try {
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } })
const errors = []
page.on('pageerror', e => errors.push(e.message))
let generationPosts = 0
page.on('request', r => { if (r.method() === 'POST' && r.url().endsWith('/v1/jobs')) generationPosts++ })
const geo = {
  query: 'Fixture building', displayName: 'Fixture building', lat: 37.2, lon: -80.4,
  footprint: [{x:40,z:-10},{x:60,z:-10},{x:60,z:-20},{x:40,z:-20}],
  footprintLatLon: [], neighbors: [], source: 'osm', osmId: 'way/fixture-test',
  bucket: 'test', areaM2: 200, identityConfirmed: true,
}
await page.goto(web)
await page.evaluate(({job,geo}) => localStorage.setItem('groundtruth.session.v1', JSON.stringify({
  jobId: job.job_id, fingerprint: null, attempt: 0, address: 'Fixture building', geo,
  presetId: 'campus', prompt: 'placement integration fixture', strength: 0.5, stage: 'fit',
})), {job,geo})
await page.reload()
await page.waitForFunction(async () => !!(await import('/src/store.ts')).useStore.getState().mesh)
await page.getByRole('button', { name: /Fit & Align/ }).click()
await page.getByRole('button', {name: /^(Fit building to footprint|Re-run placement)$/}).click()
await page.getByTestId('placement-status').filter({hasText:'accepted'}).waitFor()
const placement = await page.evaluate(async () => (await import('/src/store.ts')).useStore.getState().placement)
assert.equal(placement.provenance.identity_confirmed, true)
assert.equal(placement.selected.metrics.iou, 1)
assert.deepEqual(placement.request.footprint.exterior, [[40,10],[60,10],[60,20],[40,20]])
// Inspect the actual rendered Three.js matrix, not just the store.
async function sceneMatrix() {
  for (let n=0; n<100; n++) {
    const result = await page.evaluate(async () => {
      const { _roots } = await import('/node_modules/.vite/deps/@react-three_fiber.js')
      const o = [..._roots.values()].map(r => r.store.getState().scene.getObjectByName('asset-placement')).find(Boolean)
      return o && o.children[0] ? {matrix:o.matrix.toArray(),auto:o.matrixAutoUpdate,childMatrix:o.children[0].matrix.toArray()} : null
    })
    if (result) return result
    await page.waitForTimeout(100)
  }
  throw new Error('Placed asset did not mount')
}
assert.deepEqual((await sceneMatrix()).matrix, placement.selected.matrix_column_major)
assert.equal((await sceneMatrix()).auto, false)
await page.getByRole('button', {name:'Explore this design',exact:true}).click()
await page.waitForFunction(async () => (await import('/src/store.ts')).useStore.getState().stage === 'explore')
assert.deepEqual((await sceneMatrix()).matrix, placement.selected.matrix_column_major)
await page.getByRole('button', {name:'Walk around',exact:true}).click()
assert.deepEqual((await sceneMatrix()).matrix, placement.selected.matrix_column_major)
await page.getByRole('button', {name:'Orbit view',exact:true}).click()
await page.reload()
await page.getByRole('button', {name:'Walk around',exact:true}).waitFor()
assert.deepEqual((await sceneMatrix()).matrix, placement.selected.matrix_column_major)
assert.equal(generationPosts, 0)
await page.getByRole('button', {name:'Inspect / export',exact:true}).click()
const downloadEvent = page.waitForEvent('download')
await page.getByRole('button', {name:'Export model + placement',exact:true}).click()
await mkdir('/tmp/groundtruth-placement-check-results', {recursive:true})
await (await downloadEvent).saveAs('/tmp/groundtruth-placement-check-results/fixture.zip')
execFileSync('python3', ['-c', `
import hashlib,json,sys,zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
 p=json.loads(z.read('placement.json'))
 assert p==json.loads(sys.argv[2])
 assert hashlib.sha256(z.read('model.glb')).hexdigest()==p['asset_sha256']
`, '/tmp/groundtruth-placement-check-results/fixture.zip', JSON.stringify(placement)])
await page.screenshot({path:'/tmp/groundtruth-placement-check-results/fixture-fit.png',fullPage:true})
// A footprint edit invalidates placement and cannot resurrect it after refresh.
await page.evaluate(async () => {
  const s = (await import('/src/store.ts')).useStore
  const geo = s.getState().geo
  s.getState().set({geo:{...geo, footprint:geo.footprint.map(p=>({...p,x:p.x+1}))}})
})
assert.equal(await page.evaluate(async () => (await import('/src/store.ts')).useStore.getState().placement), null)
await page.reload()
await page.waitForFunction(async () => !!(await import('/src/store.ts')).useStore.getState().mesh)
assert.equal(await page.evaluate(async () => (await import('/src/store.ts')).useStore.getState().placement), null)
assert.equal(generationPosts, 0)
assert.deepEqual(errors, [])
console.log(JSON.stringify({fixture:job.job_id, status:placement.plan_fit, matrix:placement.selected.matrix_column_major, generationPosts, errors}))
if (process.env.CHECK_REAL_JOB) {
  const realJob = await (await fetch(`${api}/v1/jobs/${process.env.CHECK_REAL_JOB}`)).json()
  const p = realJob.placement
  const ring = points => points.map(([x,n])=>({x,z:-n}))
  const geo = {query:'DDS',displayName:'Data and Decision Sciences Building',lat:p.frame.origin_latitude,lon:p.frame.origin_longitude,
    footprint:ring(p.request.footprint.exterior),footprintLatLon:[],neighbors:(p.request.neighbors||[]).map(n=>ring(n.exterior)),
    source:'osm',osmId:p.provenance.feature_id,identityConfirmed:true,bucket:'dds',areaM2:3000}
  await page.evaluate(({realJob,geo}) => localStorage.setItem('groundtruth.session.v1',JSON.stringify({
    jobId:realJob.job_id,fingerprint:null,attempt:0,address:'DDS',geo,presetId:'campus',
    prompt:'Modern Hokie Stone academic building with large glass curtain walls, preserve roofline and massing.',strength:0.8,stage:'fit'
  })),{realJob,geo})
  await page.reload()
  await page.getByTestId('placement-status').filter({hasText:'rejected'}).waitFor({timeout:60000})
  assert.deepEqual((await sceneMatrix()).matrix,p.selected.matrix_column_major)
  await page.screenshot({path:'/tmp/groundtruth-placement-check-results/real-fit.png',fullPage:true})
  await page.getByRole('button',{name:'Show raw model',exact:true}).click()
  await page.waitForTimeout(1800) // allow the camera framing animation to settle
  await page.screenshot({path:'/tmp/groundtruth-placement-check-results/real-raw.png',fullPage:true})
  await page.getByRole('button',{name:'Explore this design',exact:true}).click()
  await page.getByRole('button',{name:'Walk around',exact:true}).waitFor()
  assert.deepEqual((await sceneMatrix()).matrix,p.selected.matrix_column_major)
  await page.screenshot({path:'/tmp/groundtruth-placement-check-results/real-explore.png',fullPage:true})
  await page.reload()
  await page.getByRole('button',{name:'Walk around',exact:true}).waitFor({timeout:60000})
  assert.deepEqual((await sceneMatrix()).matrix,p.selected.matrix_column_major)
  assert.equal(generationPosts,0)
  console.log('Real cached model: rejected state, Fit/Explore/reload matrix verified; no generation POSTs.')
}
assert.deepEqual(errors, [])
} finally { await browser.close() }
