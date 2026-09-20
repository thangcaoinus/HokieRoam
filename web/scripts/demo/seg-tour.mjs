// Segment A of the demo film: the finished building, the measured placement, walk mode, sandbox.
// Runs entirely on cached artifacts -- no generation, no GIS lookup, no credits.
import {
  launch, overlay, say, clearSub, card, uncard, finish, drag, look, hold, walkLook, WEB,
} from './harness.mjs'

const EX = '/Users/tranminhtue/VTHax14/web/public/examples'
const SANDBOX_MODELS = [
  `${EX}/burruss/model.glb`,
  `${EX}/gilbert-scorched/model.glb`,
  '/Users/tranminhtue/VTHax14/web/public/npc/hokiebird.glb',
]

const { browser, ctx, page } = await launch('/tmp/claude-501/-Users-tranminhtue-VTHax14/555c1ef1-9968-4a66-9677-f00a86d1b8b5/scratchpad/rec/tour')
await page.goto(WEB, { waitUntil: 'domcontentloaded' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)
await overlay(page)

// ---- title
await card(page, 'HokieRoam', 'Reimagine a place. Walk into your idea.',
  'A real address, an authoritative footprint, and a building you can walk around.', 3600)
await uncard(page)
await page.waitForTimeout(400)

// ---- the finished building
await say(page, 'Start with a finished one. Burruss Hall, rebuilt from four photographs and one '
  + 'prompt.', 3200)
await page.getByRole('button', { name: 'Load completed real example', exact: true }).click()
await page.getByRole('button', { name: 'Walk around', exact: true }).waitFor({ timeout: 90000 })
await page.waitForTimeout(2200)
await clearSub(page)

await say(page, 'It is standing on its real OpenStreetMap footprint, at its real coordinates.', 3000)
await drag(page, { x: 1180, y: 620 }, { x: 700, y: 560 }, 4200, 110)
await clearSub(page)
await drag(page, { x: 820, y: 600 }, { x: 1120, y: 640 }, 2600, 70)

// ---- the measurement (the honest beat)
await say(page, 'The placement is measured, not claimed.', 2400)
await page.getByRole('button', { name: 'Inspect / export', exact: true }).click()
await page.getByTestId('placement-status').waitFor({ timeout: 30000 })
await page.waitForTimeout(1200)
await clearSub(page)
const verdict = (await page.getByTestId('placement-status').innerText()).replace(/\s+/g, ' ').trim()
console.log('  verdict on screen:', verdict.slice(0, 160))
await say(page, 'Overlap with the true footprint is 73.1%, and the app calls that a rejection '
  + 'rather than rounding it up.', 4200)
await clearSub(page)

// ---- walk mode
await page.locator('.step').filter({ hasText: 'Explore' }).first().click()
await page.getByRole('button', { name: 'Walk around', exact: true }).waitFor({ timeout: 30000 })
await say(page, 'Then step inside the site.', 2000)
await page.getByRole('button', { name: 'Walk around', exact: true }).click()
await page.waitForTimeout(2000)
await clearSub(page)
await page.locator('.focus-prompt .inner').click()
await page.waitForTimeout(700)
const locked = await page.evaluate(() => !!document.pointerLockElement)
console.log('  pointer lock:', locked)

await say(page, 'Third person, exterior only — it never claims interiors it did not reconstruct.', 3000)
// lookLift = max(0, -camPitch) * 42, so a NEGATIVE pitch is what raises the gaze up the facade.
// Positive pitch only lifts the camera and keeps it staring at the player's feet.
await look(page, 0, -300, 1700)
await clearSub(page)
// Forward is (-sin camYaw, -cos camYaw) and spawn camYaw points at the building, so a straight
// W approaches it. Yaw only while standing still, or the walk curves off into open ground.
await hold(page, 'w', 2600)
await look(page, 300, 0, 1600)
await hold(page, 'w', 2000)
await say(page, 'Shift sprints, space jumps, and the hull and footprint are real colliders.', 3000)
await look(page, -460, -40, 2000)
await page.keyboard.down('Shift')
await hold(page, 'w', 1700)
await page.keyboard.up('Shift')
await page.keyboard.press('Space')
await page.waitForTimeout(700)
await clearSub(page)
await look(page, 260, 60, 1500)
await hold(page, 'w', 1400)
await page.waitForTimeout(400)

// ---- sandbox
await page.keyboard.press('Escape')
await page.waitForTimeout(400)
await page.locator('.step-aside').click()
await page.waitForTimeout(1600)
await say(page, 'A sandbox stages several models in one local scene.', 2600)
await page.locator('input[aria-label="Sandbox models"]').setInputFiles(SANDBOX_MODELS)
await page.locator('.sandbox-list .btn').nth(2).waitFor({ timeout: 90000 })
await page.waitForTimeout(1600)
await clearSub(page)
// An import with no real-world size gets a labelled estimate, not an invented measurement --
// so the mascot arrives 48 m tall. Correcting it on camera is the honest version of that.
await page.locator('.sandbox-list .btn').nth(2).click()
await page.waitForTimeout(600)
await say(page, 'An import with no real size gets a labelled estimate — so correct it.', 2800)
const h = page.locator('input[aria-label="Height (m)"]')
await h.click(); await h.press('Meta+a'); await h.pressSequentially('4', { delay: 90 })
await h.press('Tab')
await page.waitForTimeout(800)
await page.getByRole('button', { name: 'Frame all', exact: true }).click()
await page.waitForTimeout(1300)
await clearSub(page)
await drag(page, { x: 1100, y: 620 }, { x: 850, y: 580 }, 2400, 70)

// ---- and walk that scene too, through the same walk implementation
await say(page, 'The same walk mode runs on the sandbox scene.', 2600)
await page.getByRole('button', { name: 'Walk scene', exact: true }).click()
await page.waitForTimeout(2200)
await page.locator('.focus-prompt .inner').click()
await page.waitForTimeout(700)
console.log('  sandbox pointer lock:', await page.evaluate(() => !!document.pointerLockElement))
await clearSub(page)
await look(page, 0, -280, 1500)
await hold(page, 'w', 2400)
await look(page, 330, 0, 1700)
await hold(page, 'w', 2000)
await look(page, -300, 40, 1500)
await page.waitForTimeout(500)

await finish(ctx, browser, 'tour')
