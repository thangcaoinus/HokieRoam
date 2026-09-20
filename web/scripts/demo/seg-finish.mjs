// Segment C: the model that came back, fitted to its real footprint.
// Re-enters the SAME photos, prompt, strength and polycount, so the fingerprint matches and the
// server replays the finished job instead of billing a second generation. A fresh context has no
// session, so `attempt` stays 0 and the Idempotency-Key is identical to the original submission.
// The silent lead-in is trimmed off in the edit; T0 below marks the first usable frame.
import {
  launch, overlay, say, clearSub, card, uncard, finish, drag, look, hold, WEB,
} from './harness.mjs'

const S = '/Users/tranminhtue/VTHax14/samples/gilbert-scorched/inputs'
const PHOTOS = [`${S}/01-gilbert1.jpg`, `${S}/02-gilbert2.jpg`, `${S}/03-gilbert3.jpg`]
const ADDRESS = '220 Gilbert Street, Blacksburg, VA'
const PROMPT = 'Make this building look futuristic: mirror-polished white composite panels, '
  + 'deep blue photovoltaic glazing, glowing cyan light lines along every floor slab, slender '
  + 'aerodynamic shading fins. Keep the cantilever, the massing and the floor lines so the '
  + 'building stays recognisable.'

const t0 = Date.now()
const mark = (what) => console.log(`  T+${((Date.now() - t0) / 1000).toFixed(1)}s  ${what}`)

const { browser, ctx, page } = await launch('/tmp/claude-501/-Users-tranminhtue-VTHax14/555c1ef1-9968-4a66-9677-f00a86d1b8b5/scratchpad/rec/finish')
await page.goto(WEB, { waitUntil: 'domcontentloaded' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1000)
await overlay(page)

// ---- silent lead-in: rebuild the identical request so the server replays the job
await page.locator('.input-wrap input.input').fill(ADDRESS)
await page.getByRole('button', { name: 'Resolve', exact: true }).click()
// Public Overpass is intermittent from this network. A demo-parcel fallback would make the fit
// score meaningless, so retry the lookup rather than record a take that measures a fake footprint.
let osm = 0
for (let attempt = 1; attempt <= 5; attempt++) {
  await page.locator('.note').first().waitFor({ timeout: 90000 })
  osm = await page.locator('.note.ok').filter({ hasText: 'OpenStreetMap footprint' }).count()
  if (osm) { console.log(`  footprint: REAL OSM (attempt ${attempt})`); break }
  console.log(`  attempt ${attempt}: demo fallback — re-resolving`)
  await page.waitForTimeout(2000)
  await page.getByRole('button', { name: 'Resolve', exact: true }).click()
  await page.waitForTimeout(2500)
}
if (!osm) { console.error('  ABORT: Overpass unreachable; not recording a fake footprint.'); await browser.close(); process.exit(2) }
await page.locator('.dropzone input[type=file]').setInputFiles(PHOTOS)
await page.locator('.thumbs .thumb').nth(2).waitFor({ timeout: 20000 })
await page.getByRole('button', { name: /Continue to redesign/ }).click()
await page.locator('#creative-prompt').waitFor({ timeout: 15000 })
await page.locator('#creative-prompt').fill(PROMPT)
await page.waitForTimeout(400)
await page.getByRole('button', { name: /Generate concept/ }).click()

// The replay log line is the proof no second generation was paid for.
await page.locator('.log-line, .event, li, div').filter({ hasText: 're-attached to existing job' })
  .first().waitFor({ timeout: 60000 }).catch(() => console.log('  (no re-attach line matched)'))
await page.waitForTimeout(3500)
mark('re-attached; model loading')

// ---- T0: first usable frame
await page.locator('.step').filter({ hasText: 'Redesign' }).first().click()
await page.waitForTimeout(1800)
mark('T0 — concept on screen (trim to here)')
await say(page, 'Nine minutes later, the concept is back.', 2600)
await clearSub(page)

await page.locator('.step').filter({ hasText: 'Fit & Align' }).first().click()
await page.waitForTimeout(1400)
await say(page, 'Now fit the new mesh to the footprint that OpenStreetMap gave us.', 3000)
await page.getByRole('button', { name: 'Fit building to footprint', exact: true }).click()
await page.getByTestId('placement-status').waitFor({ timeout: 60000 })
await page.waitForTimeout(1500)
await clearSub(page)
const verdict = (await page.getByTestId('placement-status').innerText()).replace(/\s+/g, ' ').trim()
console.log('  NEW MODEL VERDICT:', verdict.slice(0, 200))
mark('fit computed')
await page.waitForTimeout(2600)

await page.getByRole('button', { name: 'Explore this design', exact: true }).click()
await page.getByRole('button', { name: 'Walk around', exact: true }).waitFor({ timeout: 60000 })
await page.waitForTimeout(2000)
await say(page, 'A building that did not exist ten minutes ago, standing where it belongs.', 3400)
await drag(page, { x: 1160, y: 620 }, { x: 760, y: 570 }, 4000, 105)
await clearSub(page)

await page.getByRole('button', { name: 'Walk around', exact: true }).click()
await page.waitForTimeout(1800)
await page.locator('.focus-prompt .inner').click()
await page.waitForTimeout(600)
// A big gaze lift plus a long approach ends up pressed against the facade looking at sky, which
// is how the first cut closed on ten seconds of nothing. Approach, pan the facade, then back off
// with S so the building settles into frame for the last shot.
await look(page, 0, -190, 1400)
await hold(page, 'w', 2100)
await look(page, 280, 0, 1500)
await hold(page, 's', 2100)
await look(page, -200, -50, 1400)
await page.waitForTimeout(600)
mark('walk done')

await card(page, 'HokieRoam', 'Reimagine a place. Walk into your idea.',
  'Address · photos · prompt → placed, measured, walkable, exportable.', 3800)
await finish(ctx, browser, 'finish')
