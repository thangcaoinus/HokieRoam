import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] })
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(process.env.CHECK_WEB || 'http://127.0.0.1:5175')
  await page.getByRole('button', { name: 'Sandbox · multiple models' }).click()
  await page.getByLabel('Sandbox models').setInputFiles([
    { name: 'first.obj', mimeType: 'text/plain', buffer: Buffer.from('v -2 0 -2\nv 2 0 -2\nv 0 5 0\nv 0 0 2\nf 1 3 2\nf 2 3 4\nf 4 3 1\nf 1 2 4\n') },
    { name: 'small-building.obj', mimeType: 'text/plain', buffer: Buffer.from('v -0.5 0 -0.5\nv 0.5 0 -0.5\nv 0 1 0\nv 0 0 0.5\nf 1 3 2\nf 2 3 4\nf 4 3 1\nf 1 2 4\n') },
  ])
  await page.getByText('2 models · local scene', { exact: true }).waitFor({ timeout: 60000 })
  assert.equal(await page.getByLabel('Height (m)', { exact: true }).inputValue(), '20', 'unit-sized building should receive the stated building estimate')
  await page.getByRole('button', { name: 'first.obj', exact: true }).click()
  await page.getByLabel('Height (m)', { exact: true }).fill('12')
  await page.getByLabel('Rotation (°)', { exact: true }).fill('45')
  await page.getByLabel('X (m)', { exact: true }).fill('-8')
  const read = () => page.evaluate(async () => {
    const { useSandbox } = await import('/src/lib/sandbox.ts')
    return useSandbox.getState().models.map(({ x, z, yaw, scale }) => ({ x, z, yaw, scale }))
  })
  const before = await read()
  assert.equal(before[0].x, -8)
  assert.equal(before[0].scale, 2.4)
  assert.ok(Math.abs(before[0].yaw - Math.PI / 4) < 1e-8)
  await page.getByRole('button', { name: 'Frame all', exact: true }).click()
  await page.waitForTimeout(700)
  await page.screenshot({ path: '/tmp/sandbox-edit.png' })
  // Locate the actual transform gizmo through R3F's scene, then drag its X handle.
  const handle = await page.evaluate(async () => {
    const THREE = await import('/node_modules/.vite/deps/three.js')
    const { _roots } = await import('/node_modules/.vite/deps/@react-three_fiber.js')
    const canvas = document.querySelector('canvas')
    const state = _roots.get(canvas).store.getState()
    let gizmo
    state.scene.traverse(o => { if (o.isTransformControls) gizmo = o })
    if (!gizmo) throw new Error('Missing transform gizmo')
    gizmo.updateMatrixWorld(true)
    const arrow = gizmo.children[0].gizmo.translate.children.find(o => o.name === 'X' && o.geometry?.type === 'CylinderGeometry')
    if (!arrow) throw new Error('Missing X handle')
    const point = new THREE.Box3().setFromObject(arrow).getCenter(new THREE.Vector3()).project(state.camera)
    const rect = canvas.getBoundingClientRect()
    return { x: rect.x + (point.x + 1) * rect.width / 2, y: rect.y + (1 - point.y) * rect.height / 2 }
  })
  await page.mouse.move(handle.x, handle.y)
  await page.mouse.down()
  await page.mouse.move(handle.x + 70, handle.y, { steps: 15 })
  await page.mouse.up()
  const dragged = await read()
  assert.notEqual(dragged[0].x, before[0].x, 'gizmo drag must commit the new position')
  assert.deepEqual(dragged[1], before[1], 'drag must only move the selected model')
  await page.getByRole('button', { name: 'Walk scene', exact: true }).click()
  // The R3F roots are imported once, up front: an ASYNC waitForFunction predicate returns a
  // promise, the in-page poller only tests it for truthiness, and the wait therefore resolves on
  // the first tick whatever the predicate goes on to decide. The predicate below stays synchronous
  // so it is actually polled until the walk player exists.
  await page.evaluate(async () => {
    window.r3fRoots = (await import('/node_modules/.vite/deps/@react-three_fiber.js'))._roots
  })
  await page.waitForFunction(() => {
    const state = window.r3fRoots.get(document.querySelector('canvas'))?.store.getState()
    if (!state?.scene.getObjectByName('walk-player')) return false
    // Retain the scene reference across R3F's delayed renderer-root cleanup.
    window.sandboxWalkTestState = state
    state.setDpr(0.5)
    return true
  })
  await page.getByText('Sandbox · 2 models', { exact: true }).waitFor()
  assert.equal(await page.locator('.minimap polygon').count(), 2, 'minimap must show both transformed models')
  await page.getByText('Click to enter the site', { exact: true }).click()
  await page.waitForFunction(() => !!document.pointerLockElement)
  const playerPosition = () => page.evaluate(() => window.sandboxWalkTestState.scene.getObjectByName('walk-player').position.toArray())
  const spawn = await playerPosition()
  await page.keyboard.down('w')
  try { await page.getByText('Collision · first.obj', { exact: true }).waitFor({ timeout: 60000 }) }
  catch (e) {
    console.log('Walk diagnostics:', { spawn, stopped: await playerPosition(), hud: await page.locator('.hud.tl').innerText() })
    await page.screenshot({ path: '/tmp/sandbox-walk-failure.png' })
    throw e
  }
  await page.keyboard.up('w')
  const stopped = await playerPosition()
  assert.ok(Math.hypot(stopped[0] - spawn[0], stopped[2] - spawn[2]) > 1, 'player should walk toward the model before colliding')
  await page.screenshot({ path: '/tmp/sandbox-walk.png' })
  await page.evaluate(() => document.exitPointerLock())
  await page.getByText('Click to enter the site', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Reset position', exact: true }).click()
  await page.waitForTimeout(200)
  const reset = await playerPosition()
  assert.ok(Math.hypot(reset[0] - spawn[0], reset[2] - spawn[2]) < 0.1, 'reset restores a safe spawn')
  await page.getByRole('button', { name: 'Edit scene', exact: true }).click()
  assert.deepEqual(await read(), dragged, 'walking must retain all model placements')
  await page.getByRole('button', { name: /Ingest/ }).click()
  await page.getByRole('button', { name: 'Sandbox · multiple models' }).click()
  await page.getByText('2 models · local scene', { exact: true }).waitFor()
  await page.getByLabel('Sandbox models').setInputFiles({ name: 'bad.glb', mimeType: 'application/octet-stream', buffer: Buffer.from('bad') })
  await page.getByRole('alert').waitFor()
  assert.equal((await read()).length, 2, 'failed import must preserve the scene')
  await page.getByRole('button', { name: 'Remove selected model', exact: true }).click()
  await page.getByText('1 models · local scene', { exact: true }).waitFor()
  // The shared screen must still support the original single-model Explore entry point.
  await page.evaluate(async () => {
    const { useSandbox } = await import('/src/lib/sandbox.ts')
    const { useStore } = await import('/src/store.ts')
    const { deriveIntoStore } = await import('/src/stages/SandboxFitStage.tsx')
    useStore.getState().set({ mesh: useSandbox.getState().models[0].asset })
    deriveIntoStore('Existing Explore regression')
    useStore.getState().go('explore')
  })
  await page.getByRole('button', { name: 'Walk around', exact: true }).click()
  await page.getByText('Click to enter the site', { exact: true }).click()
  await page.waitForFunction(() => !!document.pointerLockElement)
  assert.equal(await page.locator('.minimap polygon').count(), 1)
  await page.evaluate(() => document.exitPointerLock())
  await page.getByRole('button', { name: 'Orbit view', exact: true }).click()
  const scaleChecks = await page.evaluate(async () => {
    const THREE = await import('/node_modules/.vite/deps/three.js')
    const { prepareSandboxModel, useSandbox } = await import('/src/lib/sandbox.ts')
    const { useStore } = await import('/src/store.ts')
    const { deriveIntoStore } = await import('/src/stages/SandboxFitStage.tsx')
    const asset = useSandbox.getState().models[0].asset
    useStore.getState().set({ declaredHeightM: 32 })
    deriveIntoStore('32 m reference building')
    const fit = useStore.getState().fit
    const fittedRoot = new THREE.Group()
    fittedRoot.applyMatrix4(new THREE.Matrix4().fromArray(fit.matrices.M))
    fittedRoot.add(asset.object.clone(true))
    const expected = new THREE.Box3().setFromObject(fittedRoot).getSize(new THREE.Vector3()).toArray()
    const exact = prepareSandboxModel(asset)
    const other = prepareSandboxModel({ ...asset, meta: { ...asset.meta, sha256: 'different' } })
    return { expected, actual: exact.size.map(v => v * exact.scale), estimatedHeight: other.size[1] * other.scale, exactSource: exact.scaleSource, estimatedSource: other.scaleSource }
  })
  scaleChecks.expected.forEach((v, i) => assert.ok(Math.abs(v - scaleChecks.actual[i]) < 1e-6, 'matching model must keep every fitted dimension'))
  assert.ok(Math.abs(scaleChecks.estimatedHeight - 32) < 1e-6)
  assert.match(scaleChecks.exactSource, /Same dimensions as Explore/)
  assert.match(scaleChecks.estimatedSource, /Estimated from current building/)
  assert.deepEqual(errors, [])
  console.log('PASS: multi-import, independent transforms, gizmo drag, shared Explore walkthrough, minimap, movement, collision, reset, retained scene, failed import, removal; no browser errors.')
} finally { await browser.close() }
