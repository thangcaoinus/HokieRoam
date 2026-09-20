// Capture the Devpost gallery from the running app. Writes PNGs into assets/ at the repo root.
//
//   npx vite --port 5174 --strictPort &          (or ./dev.sh)
//   PLAYWRIGHT_MODULE=playwright-core CHECK_WEB=http://localhost:5174 node scripts/capture-assets.mjs
//
// Honesty rule for these images, since they are marketing: nothing that makes a CLAIM is ever
// hidden. The rejected verdict, the IoU, the "Cached real example · Meshy" chip and every
// provenance label stay on screen exactly as the app renders them. The only thing suppressed is
// the transient "Click to enter the site" pointer-lock prompt, because headless Chromium cannot
// satisfy pointer lock and the modal would otherwise sit over the scene in every walk shot.
import { createRequire } from 'node:module'
import { mkdir, readdir, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')

const BASE = process.env.CHECK_WEB || 'http://localhost:5174'
const OUT = fileURLToPath(new URL('../../assets/', import.meta.url))
const W = 1600, H = 1000
/** Optional substring filter, so a single image can be re-shot: `node scripts/capture-assets.mjs 02` */
const ONLY = process.argv[2] || ''

await mkdir(OUT, { recursive: true })
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] })
const errors = []

/** Scroll the stage so `sel` sits `pad` below the titleblock. `.main` is the scroll container,
 *  not the window, so window-level scrolling and fullPage screenshots both miss it entirely. */
async function frame(page, sel, pad = 20) {
  await page.evaluate(([sel, pad]) => {
    const main = document.querySelector('.main')
    const el = document.querySelector(sel)
    if (!main || !el) return
    main.scrollTop += el.getBoundingClientRect().top - main.getBoundingClientRect().top - pad
  }, [sel, pad])
  await page.waitForTimeout(500)
}

/** One shot: fresh context so nothing leaks between screens, 2x for a crisp gallery image.
 *  `clip` names an element to crop to, which beats a full page full of empty stage. */
async function shot(name, { width = W, height = H, full = false, clip, prepare }) {
  if (ONLY && !name.includes(ONLY)) return
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`))
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  await prepare(page)
  // Suppress only the pointer-lock prompt; see the honesty note above.
  await page.addStyleTag({ content: '.focus-prompt{display:none!important}' })
  await page.waitForTimeout(600)
  if (clip) await page.locator(clip).screenshot({ path: `${OUT}${name}.png` })
  else await page.screenshot({ path: `${OUT}${name}.png`, fullPage: full })
  await ctx.close()
  console.log('  ->', name)
}

/** Open the cached Burruss example and wait until its mesh is actually in the store. */
const loadExample = async (page) => {
  await page.getByRole('button', { name: 'Load completed real example', exact: true }).click()
  await page.getByRole('button', { name: /Walk around|Orbit view/ }).first().waitFor({ timeout: 90000 })
}
const go = async (page, label) => {
  await page.getByRole('button', { name: new RegExp(label) }).first().click()
  await page.waitForTimeout(2600)
}

console.log('capturing into assets/ …')

// 1. The centrepiece: verdict band + metrics + the placed building. This is the whole product.
await shot('01-fit-placement-verdict', { prepare: async (p) => {
  await loadExample(p); await go(p, 'Fit & Align'); await p.waitForTimeout(3500)
  await frame(p, '.measure', 18)
} })

// 2. The memorable moment: the HokieBird walking the real footprint.
await shot('02-explore-walk-hokiebird', { prepare: async (p) => {
  await loadExample(p); await go(p, 'Explore')
  await p.getByRole('button', { name: 'Walk around', exact: true }).click().catch(() => {})
  await p.waitForTimeout(5000)
  // The readout is `.explore > .glass` — a sibling of the `.hud.*` corners, not inside them,
  // which is why hiding `.hud.tl` did nothing. At spawn distance it covers the building this
  // shot is about. Hiding it removes no claim: the left rail carries the same two facts
  // (PLACEMENT rejected, IOU 73.1%) and stays in frame. Walking back instead does not work —
  // movement keys need canvas focus, which headless cannot grant without pointer lock.
  await p.addStyleTag({ content: '.explore > .glass{display:none!important}' })
  await p.waitForTimeout(700)
} })

// 3. Photo -> AI concept, the transformation people grasp instantly.
await shot('03-redesign-before-after', { prepare: async (p) => {
  await loadExample(p); await go(p, 'Redesign'); await p.waitForTimeout(1500)
} })

// 4. Five prompts, one building, each scored. The comparison is the argument.
await shot('04-style-comparison', { clip: '.entries', prepare: async (p) => {
  await frame(p, '.entries', 18)
} })

// 5. Address -> authoritative OSM footprint on the basemap.
await shot('05-ingest-footprint', { prepare: async (p) => {
  await p.getByRole('button', { name: 'Burruss Hall, Blacksburg, VA', exact: true }).click()
  await p.waitForTimeout(9000)   // live Nominatim + Overpass
  await frame(p, '.grid-2', 18)
} })

// 6. The reproducible transform: the 4x4 and its provenance, which is what the track asked for.
// Cropped to the disclosure: it is the last block on the sheet, so the scroll container is
// already at its end and no amount of scrolling lifts it to the top of the frame.
await shot('06-transform-matrix', { clip: 'details', prepare: async (p) => {
  await loadExample(p); await go(p, 'Fit & Align')
  await p.getByText('Inspect the transform', { exact: true }).click()
  await p.waitForTimeout(1400)
} })

// 7. Manual review (deck p.58 step 10): drag to correct, metrics recompute live.
await shot('07-manual-placement', { width: 1280, prepare: async (p) => {
  await loadExample(p); await go(p, 'Fit & Align')
  await p.getByRole('button', { name: 'Adjust', exact: true }).click()
  await p.waitForTimeout(1400)
  await frame(p, '.card:has([aria-label="Top-down manual placement editor"])', 18)
} })

// 8. Mesh report: triangles, source axis and units, raw extent before fitting.
await shot('08-reconstruct-asset-report', { prepare: async (p) => {
  await loadExample(p); await go(p, 'Reconstruct'); await p.waitForTimeout(3000)
} })

// 9. Devpost thumbnail, 3:2. Built inside the running app so it inherits the real tokens and the
// self-hosted Archivo, and the mark is read out of the live DOM rather than copied — a logo that
// is pasted into a generator drifts from the product the first time the product changes.
if (!ONLY || '00-devpost-thumbnail'.includes(ONLY)) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`thumbnail: ${e.message}`))
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  const mark = await page.locator('.brand-mark svg').innerHTML()
  // Replacing body content keeps <head>, so the @font-face rules and loaded faces survive.
  await page.evaluate((markSvg) => {
    document.body.style.cssText = 'margin:0;overflow:hidden'
    document.body.innerHTML = `
      <div style="position:fixed;inset:0;background:var(--paper);display:grid;
                  place-items:center;font-family:var(--font)">
        <div style="display:grid;justify-items:center;gap:30px">
          <div style="width:176px;height:176px;background:var(--vermilion);border-radius:18px;
                      display:grid;place-items:center">
            <svg width="124" height="124" viewBox="0 0 16 16">${markSvg}</svg>
          </div>
          <div style="font-weight:700;font-stretch:88%;letter-spacing:.1em;font-size:68px;
                      color:var(--ink);line-height:1">HOKIEROAM</div>
          <div style="width:132px;height:1px;background:var(--rule-2)"></div>
          <div style="font-stretch:80%;font-weight:600;letter-spacing:.17em;text-transform:uppercase;
                      font-size:18px;color:var(--ink-3);text-align:center">
            Reimagine a place. Walk into your idea.
          </div>
        </div>
      </div>`
  }, mark)
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${OUT}00-devpost-thumbnail.png` })
  await ctx.close()
  console.log('  -> 00-devpost-thumbnail (1200x800 @2x)')
}

await browser.close()

const files = (await readdir(OUT)).filter((f) => f.endsWith('.png')).sort()
console.log(`\n${files.length} images in assets/`)
for (const f of files) {
  const { size } = await stat(OUT + f)
  console.log(`  ${f.padEnd(34)} ${(size / 1024).toFixed(0).padStart(5)} kB`)
}
if (errors.length) { console.log('\nPAGE ERRORS:'); errors.forEach((e) => console.log('  ' + e)) }
else console.log('\nno page errors')
