// Recording harness for the Devpost demo video.
//
// Drives the real app in headed Chrome (real Metal GPU, ~120fps) and records the page with
// Playwright's screencast. Nothing here fakes app behaviour: the walk physics, collision,
// fitting and every network call are the app's own. Two things are simulated, both of them
// input plumbing that a human would otherwise supply by hand:
//   * pointer lock, which Chrome refuses to grant to an automated click, so walk mode could
//     never be driven at all without it;
//   * mouse-look deltas, dispatched as real mousemove events so the camera path is smooth and
//     repeatable instead of hand-jittered.
// Subtitles are injected into the page as DOM, so they are captured natively by the screencast
// and inherit the app's own type and colour tokens -- no burn-in pass, no font mismatch.
import { createRequire } from 'node:module'
const require = createRequire('/Users/tranminhtue/VTHax14/web/')
const { chromium } = require('playwright-core')

export const WEB = process.env.DEMO_WEB || 'http://localhost:5190'
export const SIZE = { width: 1920, height: 1080 }

// Pointer lock is the only reason this exists. Chrome will not grant it to a synthetic click,
// and the app correctly gates every key and mouse handler on document.pointerLockElement.
const initScript = () => {
  let locked = null
  Object.defineProperty(Document.prototype, 'pointerLockElement', {
    configurable: true, get() { return locked },
  })
  Element.prototype.requestPointerLock = function () {
    locked = this
    document.dispatchEvent(new Event('pointerlockchange'))
    return Promise.resolve()
  }
  Document.prototype.exitPointerLock = function () {
    locked = null
    document.dispatchEvent(new Event('pointerlockchange'))
  }
  // Mouse-look: the app reads movementX/movementY off a window mousemove.
  window.__look = (dx, dy) => window.dispatchEvent(
    new MouseEvent('mousemove', { movementX: dx, movementY: dy, bubbles: true }))
}

export async function launch(videoDir) {
  const browser = await chromium.launch({ headless: false, channel: 'chrome' })
  const ctx = await browser.newContext({
    viewport: SIZE,
    deviceScaleFactor: 1,
    recordVideo: { dir: videoDir, size: SIZE },
  })
  await ctx.addInitScript(initScript)
  const page = await ctx.newPage()
  page.on('pageerror', e => console.error('  ! page error:', e.message))
  return { browser, ctx, page }
}

// ---------------------------------------------------------------- subtitles

const OVERLAY_CSS = `
#demo-sub{position:fixed;left:0;right:0;bottom:56px;z-index:2147483647;display:flex;
  justify-content:center;pointer-events:none;font-family:var(--font,'Archivo',sans-serif)}
#demo-sub .box{max-width:1180px;background:rgba(18,20,23,.9);color:#f4f2ed;
  padding:15px 26px;border-radius:3px;font-size:27px;line-height:1.42;font-weight:500;
  letter-spacing:.005em;opacity:0;transition:opacity .28s ease;
  box-shadow:0 18px 50px -18px rgba(0,0,0,.7);border-left:3px solid #c2341d;text-wrap:balance;
  text-align:center}
#demo-sub.on .box{opacity:1}
#demo-card{position:fixed;inset:0;z-index:2147483646;display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:16px;background:#f4f2ed;opacity:0;
  transition:opacity .4s ease;pointer-events:none;
  font-family:var(--font,'Archivo',sans-serif)}
#demo-card.on{opacity:1}
#demo-card .kicker{font-family:var(--mono,monospace);font-size:15px;letter-spacing:.16em;
  text-transform:uppercase;color:#c2341d}
#demo-card h1{font-size:62px;line-height:1.07;margin:0;color:#16181c;font-weight:600;
  letter-spacing:-.02em;text-align:center;max-width:1280px}
#demo-card p{font-size:25px;margin:0;color:#4a4f56;text-align:center;max-width:980px;line-height:1.45}
#demo-card .rule{width:96px;height:2px;background:#c2341d}
`

const OVERLAY_JS = () => {
  if (document.getElementById('demo-sub')) return
  const sub = document.createElement('div')
  sub.id = 'demo-sub'
  sub.innerHTML = '<div class="box"></div>'
  const card = document.createElement('div')
  card.id = 'demo-card'
  card.innerHTML = '<div class="kicker"></div><h1></h1><div class="rule"></div><p></p>'
  document.body.append(sub, card)
  window.__demo = {
    say(text) {
      const box = sub.querySelector('.box')
      if (!text) { sub.classList.remove('on'); return }
      box.textContent = text
      sub.classList.add('on')
    },
    card(kicker, title, body) {
      card.querySelector('.kicker').textContent = kicker || ''
      card.querySelector('h1').textContent = title || ''
      card.querySelector('p').textContent = body || ''
      card.classList.add('on')
    },
    uncard() { card.classList.remove('on') },
  }
}

export async function overlay(page) {
  await page.addStyleTag({ content: OVERLAY_CSS })
  await page.evaluate(OVERLAY_JS)
}

/** Show a subtitle and hold it. `ms` is the total time the line is on screen. */
export async function say(page, text, ms = 2600) {
  await page.evaluate(t => window.__demo?.say(t), text)
  await page.waitForTimeout(ms)
}
export async function clearSub(page) {
  await page.evaluate(() => window.__demo?.say(''))
  await page.waitForTimeout(320)
}
export async function card(page, kicker, title, body, ms = 3200) {
  await page.evaluate(([k, t, b]) => window.__demo?.card(k, t, b), [kicker, title, body])
  await page.waitForTimeout(ms)
}
export async function uncard(page, ms = 520) {
  await page.evaluate(() => window.__demo?.uncard())
  await page.waitForTimeout(ms)
}

// ---------------------------------------------------------------- motion

const easeInOut = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2

/** Smooth mouse drag -- used to orbit the R3F camera without hand jitter. */
export async function drag(page, from, to, ms = 2200, steps = 90) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let i = 1; i <= steps; i++) {
    const t = easeInOut(i / steps)
    await page.mouse.move(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t)
    await page.waitForTimeout(ms / steps)
  }
  await page.mouse.up()
  await page.waitForTimeout(220)
}

/** Smooth mouse-look in walk mode, in accumulated movement units, eased at both ends. */
export async function look(page, dx, dy, ms = 1600, steps = 64) {
  let prev = 0
  for (let i = 1; i <= steps; i++) {
    const t = easeInOut(i / steps)
    const stepX = (dx * t) - (dx * prev)
    const stepY = (dy * t) - (dy * prev)
    prev = t
    await page.evaluate(([x, y]) => window.__look(x, y), [stepX, stepY])
    await page.waitForTimeout(ms / steps)
  }
}

/** Hold a key for a duration -- real keydown/keyup, so the app's own physics integrate it. */
export async function hold(page, key, ms) {
  await page.keyboard.down(key)
  await page.waitForTimeout(ms)
  await page.keyboard.up(key)
}

/** Walk and look at the same time, which is what makes the movement read as human. */
export async function walkLook(page, key, ms, dx = 0, dy = 0) {
  await page.keyboard.down(key)
  await look(page, dx, dy, ms)
  await page.keyboard.up(key)
}

export async function finish(ctx, browser, label) {
  const page = ctx.pages()[0]
  const video = page.video()
  await ctx.close()
  const path = await video.path()
  await browser.close()
  console.log(`  ✓ ${label} -> ${path}`)
  return path
}
