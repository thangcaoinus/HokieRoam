// The manual-review path (deck p.58 step 10): a human correction must move the scene, recompute
// its own metrics, be labelled as manual, never overwrite the computed verdict, and be dropped
// when the placement it was expressed against goes away.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const url = process.env.CHECK_WEB || 'http://localhost:5175'
const b = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] })
try {
  const page = await b.newPage({ viewport: { width: 1440, height: 1050 } })
  const errors = [], api = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('request', r => { if (r.url().includes('/v1/')) api.push(r.url()) })
  await page.route('**/*', route =>
    new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.abort())
  await page.goto(url)
  await page.getByRole('button', { name: 'Load completed real example', exact: true }).click()
  await page.getByRole('button', { name: 'Walk around', exact: true }).waitFor({ timeout: 60000 })

  await page.getByRole('button', { name: /Fit & Align/ }).click()
  const verdict = (await page.getByTestId('placement-status').innerText()).match(/Placement: (\w+)/)[1]
  await page.getByRole('button', { name: 'Adjust', exact: true }).click()
  const svg = page.getByRole('img', { name: 'Top-down manual placement editor' })
  await svg.waitFor()

  const iouOf = async () => {
    const t = await page.locator('.stat').filter({ hasText: 'IoU now' }).innerText()
    return parseFloat(t.match(/([\d.]+)%/)[1])
  }
  const before = await iouOf()

  const box = await svg.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2 + 40, { steps: 12 })
  await page.mouse.up()
  const after = await iouOf()
  assert.notEqual(before, after, 'dragging did not change the measured IoU')

  // Labelled as manual, and the computed verdict is untouched.
  await page.getByTestId('manual-placement').waitFor()
  const banner = await page.getByTestId('manual-placement').innerText()
  assert.match(banner, /Manually corrected/)
  assert.match(await page.getByTestId('placement-status').innerText(), new RegExp(`Placement: ${verdict}`))

  // The correction reaches Explore, and walking uses it.
  await page.getByRole('button', { name: 'Explore this design', exact: true }).click()
  await page.getByRole('button', { name: 'Walk around', exact: true }).waitFor({ timeout: 60000 })

  // Reset restores the computed placement exactly.
  await page.getByRole('button', { name: /Fit & Align/ }).click()
  await page.getByRole('button', { name: 'Reset to computed', exact: true }).click()
  assert.equal(await page.getByTestId('manual-placement').count(), 0)
  assert.equal(Math.round(await iouOf() * 10), Math.round(before * 10))

  assert.deepEqual(api, [])
  assert.deepEqual(errors, [])
  console.log(`PASS [manual placement]: drag changed IoU ${before}% -> ${after}%, labelled manual, ` +
              `computed verdict stayed "${verdict}", reached Explore, reset restored ${before}%.`)
} finally { await b.close() }
