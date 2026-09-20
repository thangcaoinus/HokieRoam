// Segment B of the demo film: the real 2D->3D generation, recorded as it is submitted.
// Pass --dry to rehearse every selector WITHOUT clicking Generate (which spends real credits).
import { launch, overlay, say, clearSub, card, uncard, finish, WEB } from './harness.mjs'

const DRY = process.argv.includes('--dry')
const S = '/Users/tranminhtue/VTHax14/samples/gilbert-scorched/inputs'
const PHOTOS = [`${S}/01-gilbert1.jpg`, `${S}/02-gilbert2.jpg`, `${S}/03-gilbert3.jpg`]
const ADDRESS = '220 Gilbert Street, Blacksburg, VA'
const PROMPT = 'Make this building look futuristic: mirror-polished white composite panels, '
  + 'deep blue photovoltaic glazing, glowing cyan light lines along every floor slab, slender '
  + 'aerodynamic shading fins. Keep the cantilever, the massing and the floor lines so the '
  + 'building stays recognisable.'

const { browser, ctx, page } = await launch('/tmp/claude-501/-Users-tranminhtue-VTHax14/555c1ef1-9968-4a66-9677-f00a86d1b8b5/scratchpad/rec/generate')
await page.goto(WEB, { waitUntil: 'domcontentloaded' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)
await overlay(page)

await card(page, 'Part two', 'From photographs to a placed building',
  'Three phone photos of a real building, one sentence of art direction.', 3000)
await uncard(page)

await say(page, 'Every run starts from a real street address.', 2300)
const addr = page.locator('.input-wrap input.input')
await addr.click()
await addr.pressSequentially(ADDRESS, { delay: 34 })
await page.waitForTimeout(500)
await clearSub(page)
await page.getByRole('button', { name: 'Resolve', exact: true }).click()

await page.locator('.note').first().waitFor({ timeout: 75000 })
await page.waitForTimeout(700)
const osm = await page.locator('.note.ok').filter({ hasText: 'OpenStreetMap footprint' }).count()
console.log(osm ? '  footprint: REAL OSM' : '  footprint: demo fallback (Overpass unreachable)')
await say(page, osm
  ? 'OpenStreetMap returns the authoritative footprint — the ground truth the model gets fitted to.'
  : 'The building resolves, and the app says plainly when live GIS is unreachable.', 3600)
await clearSub(page)

await say(page, 'Now three photographs of the same building.', 2200)
await page.locator('.dropzone input[type=file]').setInputFiles(PHOTOS)
await page.locator('.thumbs .thumb').nth(2).waitFor({ timeout: 20000 })
await page.waitForTimeout(1300)
await clearSub(page)

await page.getByRole('button', { name: /Continue to redesign/ }).click()
await page.locator('#creative-prompt').waitFor({ timeout: 15000 })
await page.waitForTimeout(900)

await say(page, 'One creative prompt decides what the building becomes.', 2400)
const prompt = page.locator('#creative-prompt')
await prompt.click()
await prompt.press('Meta+a')
await prompt.press('Backspace')
await prompt.pressSequentially(PROMPT, { delay: 16 })
await page.waitForTimeout(900)
await clearSub(page)

if (DRY) {
  console.log('  DRY RUN — stopping before Generate. No credits spent.')
  await page.screenshot({ path: '/tmp/claude-501/-Users-tranminhtue-VTHax14/555c1ef1-9968-4a66-9677-f00a86d1b8b5/scratchpad/rec/dry-redesign.png' })
} else {
  await say(page, 'This starts one real job on the pipeline server: image-to-image, then '
    + 'image-to-3D.', 3200)
  await clearSub(page)
  await page.getByRole('button', { name: /Generate concept/ }).click()
  console.log('  >>> SUBMITTED. Real credits spent.')
  await page.waitForTimeout(6000)
  await say(page, 'It is genuinely running — the panel is the server’s own job state, not an '
    + 'animation.', 4200)
  await clearSub(page)
  await page.waitForTimeout(9000)
  const jobId = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('groundtruth.session.v1') || '{}').jobId || null }
    catch { return null }
  })
  console.log('  JOB ID:', jobId)
  await card(page, 'About nine minutes later', 'The model comes back',
    'Real generation takes minutes, so the film cuts here.', 3400)
}

await finish(ctx, browser, DRY ? 'generate (dry)' : 'generate')
