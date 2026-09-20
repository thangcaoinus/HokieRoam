// Free import (plan.md): bring your own object, get a measured outline, a grounded transform, a
// free placement and an export — with no address, no backend and no map lookup.
//
// The point of this check is as much what must NOT appear as what must. The derived path has no
// authoritative footprint, so any IoU, coverage, spill or accepted/review/rejected verdict on
// screen would be a claim the pipeline cannot support. It asserts their absence explicitly, and
// that no request leaves the page's own origin.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, readFile } from 'node:fs/promises'
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const url = process.env.CHECK_WEB || 'http://localhost:5175'
const out = '/tmp/groundtruth-free-import-check'
await mkdir(out, { recursive: true })

// Any GLB works; this one ships with the repo and is a real 59k-triangle generation.
const modelPath = process.env.CHECK_MODEL || new URL('../public/examples/burruss/model.glb', import.meta.url)
const model = await readFile(modelPath)

const b = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] })
try {
  const page = await b.newPage({ viewport: { width: 1440, height: 1050 } })
  // Geocoding, footprint lookup and basemap tiles — the three things this path claims not to do.
  const GIS = /nominatim|overpass|openstreetmap/i
  // The app's webfont stylesheet is off-origin but is not a lookup; it is aborted below anyway.
  const ALLOWED_OFF_ORIGIN = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//
  const errors = [], apiRequests = [], gisRequests = [], offOrigin = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('request', r => {
    const u = r.url()
    if (u.includes('/v1/')) apiRequests.push(u)
    if (GIS.test(u)) gisRequests.push(u)
    if (new URL(u).origin !== new URL(url).origin && !ALLOWED_OFF_ORIGIN.test(u)
      && !u.startsWith('data:') && !u.startsWith('blob:')) offOrigin.push(u)
  })
  // Nominatim, Overpass and the OSM tile server are all off-origin; aborting them makes any
  // attempted geographic lookup a visible failure rather than a silent success.
  await page.route('**/*', route =>
    new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.abort())
  await page.goto(url)

  // --- import, with no address resolved ---
  await page.getByRole('button', { name: 'Import your own model', exact: true }).click()
  await page.getByLabel('Your own 3D model').setInputFiles({ name: 'my-building.glb', mimeType: 'model/gltf-binary', buffer: model })
  await page.getByTestId('derived-site-banner').waitFor({ timeout: 120000 })

  const banner = await page.getByTestId('derived-site-banner').innerText()
  assert.match(banner, /user-provided/)
  assert.match(banner, /no overlap score and no placement verdict/i)

  // --- the object was measured, not scored ---
  const statOf = async (label) => {
    const t = await page.locator('.stat').filter({ hasText: label }).first().innerText()
    return parseFloat(t.match(/([\d.]+)/)[1])
  }
  const sizes = async () => Object.fromEntries(await Promise.all(
    ['Length', 'Width', 'Height', 'Outline area'].map(async (k) => [k, await statOf(k)])))

  const authored = await sizes()
  for (const [k, v] of Object.entries(authored)) {
    assert.ok(Number.isFinite(v) && v > 0, `${k} should be a positive measurement, got ${v}`)
  }
  // This asset is a generator's unit-normalised output, so it must be reported as such rather
  // than silently given a size it never carried.
  assert.match(await page.getByTestId('scale-note').innerText(), /unit-normalised/i)
  assert.match(await page.locator('.kv').filter({ hasText: 'Scale applied' }).innerText(), /1\.000× uniform · as-authored/)

  // Export the as-authored transform first, so uniformity can be judged at full precision rather
  // than from UI text rounded to two significant figures.
  const exportTransform = async (name) => {
    const ev = page.waitForEvent('download')
    await page.getByRole('button', { name: 'transform.json', exact: true }).click()
    await (await ev).saveAs(`${out}/${name}`)
    return JSON.parse(await readFile(`${out}/${name}`, 'utf8'))
  }
  const before = await exportTransform('transform-as-authored.json')
  assert.equal(before.measurements.scale_provenance, 'as-authored')
  assert.equal(before.measurements.scale_applied, 1)

  // --- a declared real size scales uniformly and stays labelled as a claim ---
  const DECLARED = 48.4
  await page.getByLabel('Real-world height').fill(String(DECLARED))
  await page.waitForTimeout(600)
  const scaled = await sizes()
  assert.ok(Math.abs(scaled.Height - DECLARED) < 0.5, `declared height should be applied, got ${scaled.Height}`)
  assert.match(await page.getByTestId('scale-note').innerText(), /your claim, not a measurement/i)
  assert.match(await page.locator('.kv').filter({ hasText: 'Scale applied' }).innerText(), /user-declared/)
  const { Length: length, Width: width, Height: height, 'Outline area': area } = scaled

  const body = () => page.locator('body').innerText()
  const noScoreClaims = async (where) => {
    const text = await body()
    for (const forbidden of [/IoU/i, /coverage/i, /\bspill\b/i, /\baccepted\b/i, /\brejected\b/i]) {
      assert.ok(!forbidden.test(text), `${where}: "${forbidden}" must never appear on the derived path`)
    }
    // Null Island would be the dishonest way to render "no location".
    assert.ok(!/0\.00000°/.test(text), `${where}: coordinates must not be fabricated`)
  }
  await noScoreClaims('fit stage')
  assert.match(await body(), /no anchor/i)
  await page.screenshot({ path: `${out}/derived-fit.png`, fullPage: true })

  // --- free placement changes the transform ---
  const matrixText = () => page.locator('.matrix, .mtx, pre, code').first().innerText().catch(() => '')
  const beforeOffset = await page.locator('.kv').filter({ hasText: 'Placement offset' }).innerText()
  assert.match(beforeOffset, /0\.00 m/)

  const svg = page.getByRole('img', { name: 'Top-down manual placement editor' })
  await svg.waitFor()
  await svg.scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  // No IoU readout in this editor, unlike the scored path's.
  const editorStats = await page.locator('.stat').filter({ hasText: 'Overlap score' }).innerText()
  assert.match(editorStats, /not measured/i)

  const beforeMatrix = await matrixText()
  const box = await svg.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 50, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(400)

  const afterOffset = await page.locator('.kv').filter({ hasText: 'Placement offset' }).innerText()
  assert.ok(!/(^|\s)0\.00 m/.test(afterOffset), `drag should move the placement, got "${afterOffset}"`)
  assert.notEqual(await matrixText(), beforeMatrix, 'the drag must reach the exported 4x4')
  await noScoreClaims('after drag')

  // --- export carries the derived footprint, honestly labelled ---
  const t = await exportTransform('transform.json')

  // Proportions must be identical before and after the declared size: that is what makes the
  // scaling uniform rather than a stretch to fit. Compared at full precision, not on screen.
  const aspect = (m) => [m.length_m / m.height_m, m.width_m / m.height_m]
  const [a0, a1] = [aspect(before.measurements), aspect(t.measurements)]
  for (let i = 0; i < 2; i++) {
    assert.ok(Math.abs(a0[i] - a1[i]) / a0[i] < 1e-6,
      `declared size must preserve proportions exactly, got ${a0[i]} -> ${a1[i]}`)
  }
  const k = t.measurements.scale_applied
  assert.ok(Math.abs(k - DECLARED / before.measurements.height_m) < 1e-6, 'scale factor must be height-derived')
  // Area is two-dimensional, so it grows by the square of the same factor.
  assert.ok(Math.abs(t.derived_footprint.area_m2 / before.derived_footprint.area_m2 - k * k) / (k * k) < 1e-6)
  assert.equal(t.site.geographic_anchor, null)
  assert.equal(t.site.world_registration, 'not-integrated')
  assert.equal(t.derived_footprint.provenance, 'user-provided')
  assert.equal(t.derived_footprint.derived_from, 'mesh-plan-silhouette')
  assert.deepEqual(t.derived_footprint.latlon, [])
  assert.equal(t.measurements.scale_provenance, 'user-declared')
  assert.equal(t.measurements.scale_mode, 'uniform')
  assert.equal(t.measurements.declared_height_m, DECLARED)
  assert.ok(Math.abs(t.measurements.height_m - DECLARED) < 0.5)
  assert.ok(t.measurements.authored_height_m < 5, 'the file\'s own size must still be reported')
  assert.ok(t.transform.manual_placement, 'the manual placement must be recorded, not silently baked in')
  assert.equal(t.transform.matrix_column_major.length, 16)
  assert.ok(!('iou' in (t.fit ?? {})), 'no fit score may be exported')
  // The outline must be a real polygon, not a degenerate stub.
  assert.ok(t.derived_footprint.exterior_scene_xz.length >= 3)

  // --- it walks ---
  await page.getByRole('button', { name: 'Walk the site', exact: true }).click()
  await page.getByRole('button', { name: 'Walk around', exact: true }).click()
  await page.getByRole('button', { name: 'Orbit view', exact: true }).waitFor({ timeout: 60000 })
  await page.waitForTimeout(1200)
  const hud = await page.locator('.glass').first().innerText()
  assert.match(hud, /derived site|no anchor/i)
  assert.match(hud, /site origin/i, 'position must be reported in metres from the site origin')
  await noScoreClaims('explore')
  await page.screenshot({ path: `${out}/derived-explore.png`, fullPage: true })

  assert.deepEqual(apiRequests, [], 'the free path must not call the Pipeline API')
  assert.deepEqual(gisRequests, [], 'the free path must not geocode, fetch a footprint or load basemap tiles')
  assert.deepEqual(offOrigin, [], 'the free path must not contact any unexpected third party')
  assert.deepEqual(errors, [])
  console.log(`PASS [free import]: unit-normalised file flagged, declared ${DECLARED} m scaled uniformly to ${length.toFixed(1)} x ${width.toFixed(1)} x ${height.toFixed(1)} m (outline ${area} m²), placement drag reached the 4x4, export labelled user-provided/derived-from-mesh/user-declared, walked; no IoU or verdict shown; no API and no GIS requests.`)
} finally { await b.close() }
