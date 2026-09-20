// Geometry check for lib/deriveSite: build objects whose true plan outline is known, then verify
// the derived outline reproduces it rather than its convex hull or its bounding box.
//
// This runs headless with no browser, because the failure it exists to catch is invisible at the
// integration level: fillVoids once seeded its exterior flood from a single corner cell, and when
// an edge stamp rounded into that cell the flood reached nothing, every empty cell counted as an
// interior void, and the whole silhouette filled solid. An L came out as its bounding box —
// silently, for every object. Only a shape with a known area shows that.
//
// Not a unit-test runner; there is none configured for web/. Build and run it with esbuild, which
// is already present as a vite dependency:
//
//   node_modules/.bin/esbuild scripts/check-derive-site.ts --bundle --platform=node \
//     --format=esm --outfile=/tmp/check-derive-site.mjs && node /tmp/check-derive-site.mjs
import * as THREE from 'three'
import { deriveSite } from '../src/lib/deriveSite'
import { polygonArea } from '../src/lib/geo'
import type { MeshAsset } from '../src/lib/reconstruct'

function asset(object: THREE.Object3D, N = new THREE.Matrix4()): MeshAsset {
  return {
    object, normalization: N,
    meta: { source: 'test', format: 'GLB', upAxis: 'Y', units: 'm', vertices: 0, triangles: 0 },
  } as unknown as MeshAsset
}

// An L: two boxes. Footprint = 40x40 minus a 20x20 bite = 1200 m². Hull = 1400 m² (the diagonal
// cut across the notch). A convex-hull outline cannot tell these apart; a silhouette must.
function lShape() {
  const g = new THREE.Group()
  const a = new THREE.Mesh(new THREE.BoxGeometry(40, 30, 20))
  a.position.set(0, 15, -10)
  const b = new THREE.Mesh(new THREE.BoxGeometry(20, 30, 20))
  b.position.set(-10, 15, 10)
  g.add(a, b)
  g.updateMatrixWorld(true)
  return g
}

// A hollow courtyard block: outer 40x40, inner 20x20 void. The footprint is a solid region, so
// the derived outline must be 1600 m², NOT 1200.
function courtyard() {
  const g = new THREE.Group()
  const walls: [number, number, number, number][] = [
    [0, -15, 40, 10], [0, 15, 40, 10], [-15, 0, 10, 20], [15, 0, 10, 20],
  ]
  for (const [x, z, w, d] of walls) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 24, d))
    m.position.set(x, 12, z)
    g.add(m)
  }
  g.updateMatrixWorld(true)
  return g
}

// Z-up centimetres, off-origin — the quirk reconstruct.ts deliberately emits. Local box is
// 3000 x 1000 x 2000 cm; N rotates local +z up, so the normalised object is 30 m x 10 m in plan
// and 20 m tall. The derived outline must come out in metres, centred and grounded regardless.
function awkward() {
  const m = new THREE.Mesh(new THREE.BoxGeometry(3000, 1000, 2000))
  m.position.set(12345, 6789, 500)
  m.updateMatrixWorld(true)
  const N = new THREE.Matrix4().makeRotationX(-Math.PI / 2)
    .premultiply(new THREE.Matrix4().makeScale(0.01, 0.01, 0.01))
  return { object: m, N }
}

/** AABB of the object's own vertices after the derived transform — frame-agnostic, so it checks
 *  grounding and centring without assuming which local axis was up. */
function placedBox(object: THREE.Object3D, M: number[]) {
  const m = new THREE.Matrix4().fromArray(M)
  const box = new THREE.Box3()
  const v = new THREE.Vector3()
  object.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const pos = (mesh.geometry as THREE.BufferGeometry).attributes.position
    const toWorld = mesh.matrixWorld.clone().premultiply(m)
    for (let i = 0; i < pos.count; i++) box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(toWorld))
  })
  return box
}

let ok = true
const report = (label: string, got: number, want: number, tol: number) => {
  const pass = Math.abs(got - want) <= tol
  if (!pass) ok = false
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}: ${got.toFixed(2)} (want ${want} ±${tol})`)
}
const check = (label: string, pass: boolean, detail = '') => {
  if (!pass) ok = false
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail && ` — ${detail}`}`)
}

{
  const d = deriveSite(asset(lShape()), 'L block')
  console.log(`\nL: method=${d.method} cell=${d.cellM.toFixed(3)}m verts=${d.geo.footprint.length} height=${d.heightM.toFixed(1)}m`)
  console.log('   ring:', d.geo.footprint.map((p) => `(${p.x.toFixed(1)},${p.z.toFixed(1)})`).join(' '))
  report('  L outline area (hull would be 1400)', Math.abs(polygonArea(d.geo.footprint)), 1200, 40)
  check('  L stayed a silhouette', d.method === 'plan-silhouette', d.method)
  check('  L has the notch (>= 6 corners)', d.geo.footprint.length >= 6, `${d.geo.footprint.length} corners`)
  report('  L height', d.heightM, 30, 0.01)
}

{
  const d = deriveSite(asset(courtyard()), 'Courtyard block')
  console.log(`\nCourtyard: method=${d.method} verts=${d.geo.footprint.length}`)
  report('  courtyard outline area (void filled)', Math.abs(polygonArea(d.geo.footprint)), 1600, 50)
}

{
  const a = awkward()
  const d = deriveSite(asset(a.object, a.N), 'Awkward frame')
  const xs = d.geo.footprint.map((p) => p.x), zs = d.geo.footprint.map((p) => p.z)
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...zs) - Math.min(...zs)
  console.log(`\nAwkward: method=${d.method} outline span=${w.toFixed(2)} x ${h.toFixed(2)} m`)
  report('  outline width (normalised to metres)', w, 30, 0.5)
  report('  outline depth', h, 10, 0.5)
  report('  height', d.heightM, 20, 0.05)

  const box = placedBox(a.object, d.fit.matrices.M)
  console.log(`   placed AABB min=(${box.min.x.toFixed(2)},${box.min.y.toFixed(2)},${box.min.z.toFixed(2)}) max=(${box.max.x.toFixed(2)},${box.max.y.toFixed(2)},${box.max.z.toFixed(2)})`)
  report('  base grounded on y=0', box.min.y, 0, 0.001)
  report('  top at the mesh height', box.max.y, 20, 0.001)
  report('  centred on origin (x)', (box.min.x + box.max.x) / 2, 0, 0.001)
  report('  centred on origin (z)', (box.min.z + box.max.z) / 2, 0, 0.001)
  report('  no scaling applied', d.fit.scale.uniform, 1, 0)
  check('  outline encloses the placed object',
    Math.min(...xs) <= box.min.x + 0.3 && Math.max(...xs) >= box.max.x - 0.3)
}

// A declared real size must scale everything uniformly and leave proportions untouched.
{
  const plain = deriveSite(asset(lShape()), 'L block')
  const DECLARED = 90
  const d = deriveSite(asset(lShape()), 'L block', DECLARED)
  const k = DECLARED / plain.heightM
  console.log(`\nDeclared size: ${plain.heightM.toFixed(2)} m -> ${d.heightM.toFixed(2)} m (k=${d.scale.toFixed(3)}, ${d.scaleProvenance})`)
  report('  applied height', d.heightM, DECLARED, 1e-9)
  report('  scale factor', d.scale, k, 1e-9)
  check('  provenance is user-declared', d.scaleProvenance === 'user-declared', d.scaleProvenance)
  check('  identity case stays as-authored', plain.scaleProvenance === 'as-authored', plain.scaleProvenance)
  report('  authored height still reported', d.authoredHeightM, plain.heightM, 1e-9)
  // Area is two-dimensional, so it must grow by k^2 exactly.
  report('  outline area scales by k^2', Math.abs(polygonArea(d.geo.footprint)) / Math.abs(polygonArea(plain.geo.footprint)), k * k, 1e-6)
  check('  outline keeps its corner count', d.geo.footprint.length === plain.geo.footprint.length)
  // Still grounded after scaling: S is applied about the origin, AFTER T_ground.
  const box = placedBox(lShape(), d.fit.matrices.M)
  report('  still grounded on y=0', box.min.y, 0, 1e-9)
  report('  scaled height in the scene', box.max.y, DECLARED, 1e-6)
  report('  still centred (x)', (box.min.x + box.max.x) / 2, 0, 1e-9)
}

console.log(ok ? '\nALL PASS' : '\nFAILURES ABOVE')
process.exit(ok ? 0 : 1)
