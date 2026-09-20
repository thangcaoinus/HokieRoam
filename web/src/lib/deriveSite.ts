// Free import: derive a site from the object itself.
//
// The address path starts from an AUTHORITATIVE footprint and asks whether the mesh fits it. This
// path has no such reference — the outline IS the object's own top-down silhouette, so an overlap
// score against it would be a tautology, not a validation. Nothing here reports IoU, a verdict or
// a geographic anchor. What it does produce is the rest of what the scored path produces: units
// and axes normalised, the base grounded on y = 0, a plan outline, an inspectable 4x4 and a
// walkable scene — for any GLB, whether it came from Meshy, Blender or a scan.
//
// The outline is the union of every triangle projected onto the plan, rasterised and traced, so a
// genuinely L-shaped or courtyarded object gets an L-shaped outline rather than its convex hull.
// Interior voids are filled: a footprint is a solid region, and GeoResult carries one ring.
import * as THREE from 'three'
import { convexHull, minAreaOBB, signedArea, toRootMatrix, type FitResult } from './fit'
import { polygonArea, type GeoResult, type V2 } from './geo'
import type { MeshAsset } from './reconstruct'

/** Cells across the longer plan span. 360 keeps a 90 m building at ~0.25 m — finer than the
 *  metre-accuracy GIS footprints the scored path works with, so the outline is never the limit. */
const CELLS_ACROSS = 360
const MIN_CELL_M = 0.05
/** Ceiling on interior-fill work so one pathological triangle cannot hang the tab. Edge stamping
 *  is never skipped, so the silhouette stays closed even if this budget runs out. */
const FILL_BUDGET = 40_000_000

export type OutlineMethod = 'plan-silhouette' | 'convex-hull'

export interface DerivedSite {
  geo: GeoResult
  fit: FitResult
  method: OutlineMethod
  cellM: number
  /** Mesh height in metres after normalisation — the object's own, not a record. */
  heightM: number
}

function eachTriangle(root: THREE.Object3D, N: THREE.Matrix4, cb: (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => void) {
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3()
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    const g = m.geometry as THREE.BufferGeometry | undefined
    const pos = g?.attributes.position
    if (!g || !pos) return
    const mw = toRootMatrix(root, m).premultiply(N)
    const index = g.index
    const count = index ? index.count : pos.count
    for (let i = 0; i + 2 < count; i += 3) {
      a.fromBufferAttribute(pos, index ? index.getX(i) : i).applyMatrix4(mw)
      b.fromBufferAttribute(pos, index ? index.getX(i + 1) : i + 1).applyMatrix4(mw)
      c.fromBufferAttribute(pos, index ? index.getX(i + 2) : i + 2).applyMatrix4(mw)
      cb(a, b, c)
    }
  })
}

interface Grid { nx: number; nz: number; cell: number; ox: number; oz: number; cells: Uint8Array }

function rasterize(root: THREE.Object3D, N: THREE.Matrix4, box: THREE.Box3): Grid {
  const span = Math.max(box.max.x - box.min.x, box.max.z - box.min.z)
  const cell = Math.max(MIN_CELL_M, span / CELLS_ACROSS)
  // One empty cell of padding on every side so the boundary trace always has an outside to hug.
  const nx = Math.ceil((box.max.x - box.min.x) / cell) + 3
  const nz = Math.ceil((box.max.z - box.min.z) / cell) + 3
  const ox = box.min.x - cell, oz = box.min.z - cell
  const cells = new Uint8Array(nx * nz)
  const ix = (x: number) => Math.floor((x - ox) / cell)
  const iz = (z: number) => Math.floor((z - oz) / cell)
  const mark = (i: number, j: number) => { if (i >= 0 && i < nx && j >= 0 && j < nz) cells[j * nx + i] = 1 }
  const stamp = (x: number, z: number) => mark(ix(x), iz(z))
  let budget = FILL_BUDGET

  eachTriangle(root, N, (a, b, c) => {
    // Walls project to a degenerate sliver in plan, so edges are stamped explicitly: the interior
    // test below would miss them and leave the silhouette perforated.
    for (const [p, q] of [[a, b], [b, c], [c, a]] as const) {
      const steps = Math.ceil(Math.hypot(q.x - p.x, q.z - p.z) / (cell * 0.5))
      for (let t = 0; t <= steps; t++) stamp(p.x + ((q.x - p.x) * t) / steps, p.z + ((q.z - p.z) * t) / steps)
    }
    const i0 = Math.max(0, ix(Math.min(a.x, b.x, c.x))), i1 = Math.min(nx - 1, ix(Math.max(a.x, b.x, c.x)))
    const j0 = Math.max(0, iz(Math.min(a.z, b.z, c.z))), j1 = Math.min(nz - 1, iz(Math.max(a.z, b.z, c.z)))
    const cells2 = (i1 - i0 + 1) * (j1 - j0 + 1)
    if (cells2 <= 4 || cells2 > budget) return
    budget -= cells2
    const d = (b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)
    if (Math.abs(d) < 1e-12) return
    for (let j = j0; j <= j1; j++) {
      const pz = oz + (j + 0.5) * cell
      for (let i = i0; i <= i1; i++) {
        const px = ox + (i + 0.5) * cell
        const u = ((px - a.x) * (c.z - a.z) - (c.x - a.x) * (pz - a.z)) / d
        const v = ((b.x - a.x) * (pz - a.z) - (px - a.x) * (b.z - a.z)) / d
        if (u >= 0 && v >= 0 && u + v <= 1) cells[j * nx + i] = 1
      }
    }
  })
  return { nx, nz, cell, ox, oz, cells }
}

/** Flood the exterior from the padded corner; every empty cell it cannot reach is an interior
 *  void and becomes solid. A building footprint is a region, not a shell. */
function fillVoids(g: Grid) {
  const { nx, nz, cells } = g
  const seen = new Uint8Array(nx * nz)
  const stack = [0]
  seen[0] = 1
  while (stack.length) {
    const at = stack.pop()!
    const i = at % nx, j = (at - i) / nx
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const ni = i + di, nj = j + dj
      if (ni < 0 || ni >= nx || nj < 0 || nj >= nz) continue
      const k = nj * nx + ni
      if (seen[k] || cells[k]) continue
      seen[k] = 1
      stack.push(k)
    }
  }
  for (let k = 0; k < cells.length; k++) if (!cells[k] && !seen[k]) cells[k] = 1
}

/** Closed boundary loops between occupied and empty cells, in plan metres.
 *  Every corner has equal in- and out-degree, so each walk returns to where it started. */
function traceLoops(g: Grid): V2[][] {
  const { nx, nz, cell, ox, oz, cells } = g
  const occupied = (i: number, j: number) => i >= 0 && i < nx && j >= 0 && j < nz && cells[j * nx + i] === 1
  const key = (i: number, j: number) => j * (nx + 1) + i
  const edges = new Map<number, number[]>()
  const add = (ai: number, aj: number, bi: number, bj: number) => {
    const from = key(ai, aj)
    const list = edges.get(from)
    if (list) list.push(key(bi, bj)); else edges.set(from, [key(bi, bj)])
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    if (!occupied(i, j)) continue
    if (!occupied(i, j - 1)) add(i + 1, j, i, j)
    if (!occupied(i - 1, j)) add(i, j, i, j + 1)
    if (!occupied(i, j + 1)) add(i, j + 1, i + 1, j + 1)
    if (!occupied(i + 1, j)) add(i + 1, j + 1, i + 1, j)
  }
  const point = (k: number): V2 => ({ x: ox + (k % (nx + 1)) * cell, z: oz + Math.floor(k / (nx + 1)) * cell })
  const limit = nx * nz * 4 + 8
  const loops: V2[][] = []
  for (const start of [...edges.keys()]) {
    while ((edges.get(start)?.length ?? 0) > 0) {
      const ring: number[] = []
      let at = start
      for (;;) {
        const list = edges.get(at)
        if (!list?.length || ring.length > limit) break
        ring.push(at)
        at = list.pop()!
        if (at === start) break
      }
      if (at === start && ring.length >= 4) loops.push(ring.map(point))
    }
  }
  return loops
}

const perpendicular = (p: V2, a: V2, b: V2) => {
  const dx = b.x - a.x, dz = b.z - a.z
  const len = Math.hypot(dx, dz)
  return len < 1e-12 ? Math.hypot(p.x - a.x, p.z - a.z) : Math.abs(dz * (p.x - a.x) - dx * (p.z - a.z)) / len
}

/** Ramer-Douglas-Peucker on an open chain. */
function rdp(pts: V2[], eps: number): V2[] {
  if (pts.length < 3) return pts
  const a = pts[0], b = pts[pts.length - 1]
  let index = 0, worst = 0
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpendicular(pts[i], a, b)
    if (d > worst) { worst = d; index = i }
  }
  if (worst <= eps) return [a, b]
  return [...rdp(pts.slice(0, index + 1), eps).slice(0, -1), ...rdp(pts.slice(index), eps)]
}

/** RDP on a closed ring: cut at two far-apart, deterministically chosen points so the result does
 *  not depend on where the trace happened to start. */
function simplifyRing(ring: V2[], eps: number): V2[] {
  if (ring.length < 5) return ring
  let anchor = 0
  for (let i = 1; i < ring.length; i++) {
    if (ring[i].x < ring[anchor].x || (ring[i].x === ring[anchor].x && ring[i].z < ring[anchor].z)) anchor = i
  }
  const rotated = [...ring.slice(anchor), ...ring.slice(0, anchor)]
  let far = 1, best = -1
  for (let i = 1; i < rotated.length; i++) {
    const d = Math.hypot(rotated[i].x - rotated[0].x, rotated[i].z - rotated[0].z)
    if (d > best) { best = d; far = i }
  }
  const head = rdp(rotated.slice(0, far + 1), eps)
  const tail = rdp([...rotated.slice(far), rotated[0]], eps)
  const merged = [...head.slice(0, -1), ...tail.slice(0, -1)]
  return merged.length >= 3 ? merged : ring
}

const identity = () => new THREE.Matrix4().toArray()

export function deriveSite(mesh: MeshAsset, name: string): DerivedSite {
  const N = mesh.normalization
  const box = new THREE.Box3()
  const v = new THREE.Vector3()
  let vertexCount = 0
  eachTriangle(mesh.object, N, (a, b, c) => {
    box.expandByPoint(a); box.expandByPoint(b); box.expandByPoint(c)
    vertexCount += 3
  })
  if (box.isEmpty()) throw new Error('This file has no triangles to place.')
  const heightM = box.max.y - box.min.y

  const grid = rasterize(mesh.object, N, box)
  fillVoids(grid)
  const loops = traceLoops(grid)
  const traced = loops.reduce<V2[] | null>((best, ring) =>
    !best || Math.abs(signedArea(ring)) > Math.abs(signedArea(best)) ? ring : best, null)

  // Fall back rather than ship a broken outline: the hull is always valid, just less faithful.
  const hullPoints: V2[] = []
  eachTriangle(mesh.object, N, (a, b, c) => { hullPoints.push({ x: a.x, z: a.z }, { x: b.x, z: b.z }, { x: c.x, z: c.z }) })
  const hull = convexHull(hullPoints)
  const hullArea = polygonArea(hull)
  const simplified = traced ? simplifyRing(traced, Math.max(grid.cell * 0.9, 0.08)) : null
  const usable = simplified && simplified.length >= 3 && polygonArea(simplified) > hullArea * 0.05
  const method: OutlineMethod = usable ? 'plan-silhouette' : 'convex-hull'
  let outline = usable ? simplified! : hull

  // T_ground: centre the plan extent on the origin and rest the base on y = 0. The outline is
  // measured in the same frame, so it moves with the same translation.
  const tx = -(box.min.x + box.max.x) / 2
  const tz = -(box.min.z + box.max.z) / 2
  const Tground = new THREE.Matrix4().makeTranslation(tx, -box.min.y, tz)
  outline = outline.map((p) => ({ x: p.x + tx, z: p.z + tz }))
  // Match convexHull's winding so every consumer (clipping, extrusion) sees one convention.
  if (Math.sign(signedArea(outline)) !== Math.sign(signedArea(convexHull(outline)))) outline.reverse()

  const obb = minAreaOBB(outline)
  const areaM2 = polygonArea(outline)
  const geo: GeoResult = {
    query: name,
    displayName: `${name} · imported model, no geographic anchor`,
    lat: 0, lon: 0,
    footprint: outline,
    // Deliberately empty: this site is not registered to the world, so there are no real
    // coordinates to publish. An invented lat/lon would be the dishonest option.
    footprintLatLon: [],
    neighbors: [],
    source: 'derived',
    bucket: 'local',
    areaM2,
  }
  const fit: FitResult = {
    authority: 'derived-site',
    matrices: {
      N: N.toArray(), Ralign: identity(), Tground: Tground.toArray(), S: identity(),
      Ry: identity(), Ttarget: identity(),
      M: new THREE.Matrix4().multiply(Tground).multiply(N).toArray(),
    },
    rawAABB: { min: box.min.toArray(), max: box.max.toArray() },
    groundedAABB: {
      min: v.copy(box.min).add(new THREE.Vector3(tx, -box.min.y, tz)).toArray(),
      max: new THREE.Vector3(box.max.x + tx, box.max.y - box.min.y, box.max.z + tz).toArray(),
    },
    meshOBB: obb, footprintOBB: obb,
    deltaThetaDeg: 0, yawDeg: 0,
    // No orientation search ran: the object keeps the orientation its author gave it, and there
    // is no independent footprint to rotate it onto.
    candidates: [{ k: 0, angle: obb.angle, sx: 1, sz: 1, iou: 1, poly: outline }],
    chosen: { k: 0, angle: obb.angle, sx: 1, sz: 1, iou: 1, poly: outline },
    scale: { sx: 1, sy: 1, sz: 1, uniform: 1, divergence: 0, mode: 'uniform' },
    iou: 1, collisions: [], confidence: 1,
    flags: [
      { level: 'ok', text: `Outline derived from the model itself — ${outline.length} vertices, ${areaM2.toFixed(0)} m²` },
      { level: 'ok', text: 'Proportions preserved — units and axes normalised, base grounded, no scaling applied' },
      { level: 'warn', text: 'No authoritative footprint: overlap is not measured and no placement verdict is claimed' },
    ],
    height: heightM, vertexCount,
  }
  return { geo, fit, method, cellM: grid.cell, heightM }
}
