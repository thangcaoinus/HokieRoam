// NETWORK-DEPENDENT check — the only one that exercises the real GIS path.
// Everything else in scripts/ runs offline; this one deliberately hits Nominatim and Overpass,
// because a silent GIS failure degrades every address to the synthetic demo parcel and the app
// still "works". Run it before demoing on an unfamiliar network.
//
//   npm run build && npx vite preview --port 5175 --strictPort &
//   PLAYWRIGHT_MODULE=playwright-core node scripts/check-ingest-live.mjs ["some address"]
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const url = process.env.CHECK_WEB || 'http://localhost:5175'
const query = process.argv[2] || 'Burruss Hall, Blacksburg, VA'
const photo = await readFile(new URL('../public/examples/burruss/source.jpg', import.meta.url))
const b = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] })
try {
  const page = await b.newPage({ viewport: { width: 1440, height: 1050 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(url)
  await page.locator('input.input').first().fill(query)
  await page.getByRole('button', { name: 'Resolve', exact: true }).click()
  await page.getByText('OpenStreetMap footprint', { exact: true }).waitFor({ timeout: 45000 })
  const log = await page.locator('body').innerText()
  assert.ok(!/Synthetic demo footprint/.test(log), 'fell back to the demo parcel')
  const matched = log.match(/gis › matched (\S+) · (\d+) vertices · (\d+) neighbors/)
  assert.ok(matched, 'no GIS match line in the event log')
  await page.locator('input[accept="image/png,image/jpeg"]')
    .setInputFiles({ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: photo })
  await page.getByText('1/4', { exact: true }).waitFor({ timeout: 20000 })
  const next = page.getByRole('button', { name: /Redesign/i }).first()
  assert.equal(await next.isDisabled(), false, 'cannot advance to Redesign with a footprint + photo')
  assert.deepEqual(errors, [])
  console.log(`PASS [live GIS]: "${query}" -> ${matched[1]}, ${matched[2]} vertices, ` +
              `${matched[3]} neighbors; photo accepted; Redesign unlocked.`)
} finally { await b.close() }
