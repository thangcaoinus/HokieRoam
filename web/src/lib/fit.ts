// Automated fitting & alignment engine.
// M = T_target · R_y(θ) · S · T_ground · R_align · N
import * as THREE from 'three'
import { polygonArea, type V2 } from './geo'

export interface OBB { center: V2; length: number; width: number; angle: number; corners: V2[] }

export interface Candidate {
  k: number
  angle: number // footprint-plane angle of the mesh long axis (rad, +x toward +z)
  sx: number
  sz: number
  iou: number
  poly: V2[] // transformed mesh base hull in local map meters
}

export interface FitResult {
  /** Browser output is an offline preview; server PlacementManifest is authoritative.
   *  'derived-site' is the free-import path (`deriveSite.ts`): there is no authoritative
   *  footprint for it to be authoritative *about*, so what it carries is a grounding transform
   *  and a measured outline, never a fit score or a verdict. */
  authority: 'preview-only' | 'derived-site'
  matrices: { N: number[]; Ralign: number[]; Tground: number[]; S: number[]; Ry: number[]; Ttarget: number[]; M: number[] }
  rawAABB: { min: THREE.Vector3Tuple; max: THREE.Vector3Tuple }
  groundedAABB: { min: THREE.Vector3Tuple; max: THREE.Vector3Tuple }
  meshOBB: OBB
  footprintOBB: OBB
  deltaThetaDeg: number
  yawDeg: number
  candidates: Candidate[]
  chosen: Candidate
  scale: { sx: number; sy: number; sz: number; uniform: number; divergence: number; mode: 'uniform' | 'constrained' }
  iou: number
  collisions: { index: number; overlap: number }[]
  confidence: number
  flags: { level: 'ok' | 'warn' | 'error'; text: string }[]
  height: number
  vertexCount: number
}

// ---------- 2D geometry ----------
const cross = (o: V2, a: V2, b: V2) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x)

export function convexHull(pts: V2[]): V2[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.z - b.z)
  if (p.length < 3) return p
  const lower: V2[] = []
  for (const v of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], v) <= 0) lower.pop()
    lower.push(v)
  }
  const upper: V2[] = []
  for (let i = p.length - 1; i >= 0; i--) {
    const v = p[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], v) <= 0) upper.pop()
    upper.push(v)
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1)) // CCW in (x,z)
}

export const rot2 = (p: V2, a: number): V2 => ({
  x: p.x * Math.cos(a) - p.z * Math.sin(a),
  z: p.x * Math.sin(a) + p.z * Math.cos(a),
})

/** Minimum-area oriented bounding box via rotating calipers over hull edges. */
export function minAreaOBB(points: V2[]): OBB {
  const hull = convexHull(points)
  let best: OBB | null = null
  let bestArea = Infinity
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length]
    const ang = Math.atan2(b.z - a.z, b.x - a.x)
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
    for (const p of hull) {
      const r = rot2(p, -ang)
      x0 = Math.min(x0, r.x); x1 = Math.max(x1, r.x); z0 = Math.min(z0, r.z); z1 = Math.max(z1, r.z)
    }
    const area = (x1 - x0) * (z1 - z0)
    if (area < bestArea - 1e-9) {
      bestArea = area
      let length = x1 - x0, width = z1 - z0, angle = ang
      if (width > length) { [length, width] = [width, length]; angle += Math.PI / 2 }
      // normalise long-axis angle into (-90°, 90°]
      while (angle <= -Math.PI / 2) angle += Math.PI
      while (angle > Math.PI / 2) angle -= Math.PI
      const center = rot2({ x: (x0 + x1) / 2, z: (z0 + z1) / 2 }, ang)
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => {
        const r = rot2({ x: (u * length) / 2, z: (v * width) / 2 }, angle)
        return { x: center.x + r.x, z: center.z + r.z }
      })
      best = { center, length, width, angle, corners }
    }
  }
  return best!
}

/** Sutherland–Hodgman: clip arbitrary subject polygon by a convex clip polygon. */
export function clipPolygon(subject: V2[], clip: V2[]): V2[] {
  const ccw = signedArea(clip) > 0
  const inside = (p: V2, a: V2, b: V2) => (ccw ? cross(a, b, p) >= 0 : cross(a, b, p) <= 0)
  const intersect = (p: V2, q: V2, a: V2, b: V2): V2 => {
    const d = (p.x - q.x) * (a.z - b.z) - (p.z - q.z) * (a.x - b.x)
    const t = ((p.x - a.x) * (a.z - b.z) - (p.z - a.z) * (a.x - b.x)) / d
    return { x: p.x + t * (q.x - p.x), z: p.z + t * (q.z - p.z) }
  }
  let out = subject
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length]
    const input = out
    out = []
    for (let j = 0; j < input.length; j++) {
      const cur = input[j], prev = input[(j + input.length - 1) % input.length]
      if (inside(cur, a, b)) {
        if (!inside(prev, a, b)) out.push(intersect(prev, cur, a, b))
        out.push(cur)
      } else if (inside(prev, a, b)) out.push(intersect(prev, cur, a, b))
    }
  }
  return out
}

export function signedArea(p: V2[]) {
  let a = 0
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length]
    a += p[i].x * q.z - q.x * p[i].z
  }
  return a / 2
}

/** IoU of an arbitrary polygon against a convex polygon. */
export function iou(poly: V2[], convex: V2[]) {
  const inter = polygonArea(clipPolygon(poly, convex))
  return inter / (polygonArea(poly) + polygonArea(convex) - inter)
}

// ---------- mesh sampling ----------
/** Accumulated transform taking `node`'s local coordinates into `root`'s own frame — root's
 *  transform included, its ancestors deliberately excluded, so the result is independent of
 *  wherever the asset happens to be parented in a scene. */
export function toRootMatrix(root: THREE.Object3D, node: THREE.Object3D): THREE.Matrix4 {
  const m = new THREE.Matrix4()
  for (let n: THREE.Object3D | null = node; n && n !== root.parent; n = n.parent) { n.updateMatrix(); m.premultiply(n.matrix) }
  return m
}

/** Vertices in the root's own frame (root transform included, ancestors ignored). */
export function sampleVertices(root: THREE.Object3D, max = 150_000): THREE.Vector3[] {
  const out: THREE.Vector3[] = []
  let total = 0
  root.traverse((o) => {
    const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined
    if ((o as THREE.Mesh).isMesh && g?.attributes.position) total += g.attributes.position.count
  })
  const step = Math.max(1, Math.ceil(total / max))
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    const pos = (m.geometry as THREE.BufferGeometry).attributes.position
    if (!pos) return
    const mw = toRootMatrix(root, m)
    for (let i = 0; i < pos.count; i += step) out.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mw))
  })
  return out
}

const tuple = (v: THREE.Vector3): THREE.Vector3Tuple => [v.x, v.y, v.z]

// ---------- solver ----------
export interface FitInput {
  mesh: THREE.Object3D
  normalization: THREE.Matrix4 // N: source axes/units → Y-up meters
  footprint: V2[]
  neighbors: V2[][]
}

export function solveFit({ mesh, normalization: N, footprint, neighbors }: FitInput): FitResult {
  const verts = sampleVertices(mesh).map((v) => v.applyMatrix4(N))
  const rawBox = new THREE.Box3().setFromPoints(verts)
  const height = rawBox.max.y - rawBox.min.y

  // Base slice → mesh orientation on the XZ plane
  const baseCut = rawBox.min.y + height * 0.2
  const basePts = verts.filter((v) => v.y <= baseCut).map((v) => ({ x: v.x, z: v.z }))
  const meshOBB = minAreaOBB(basePts.length >= 3 ? basePts : verts.map((v) => ({ x: v.x, z: v.z })))

  // R_align: rotate the mesh long axis onto +x. 2D rotation by -φ ≡ R_y(+φ)
  const Ralign = new THREE.Matrix4().makeRotationY(meshOBB.angle)
  const aligned = verts.map((v) => v.clone().applyMatrix4(Ralign))
  const alignedBox = new THREE.Box3().setFromPoints(aligned)

  // T_ground: centre laterally on AABB and put base flush on y = 0
  const Tground = new THREE.Matrix4().makeTranslation(
    -(alignedBox.min.x + alignedBox.max.x) / 2, -alignedBox.min.y, -(alignedBox.min.z + alignedBox.max.z) / 2,
  )
  const grounded = aligned.map((v) => v.applyMatrix4(Tground))
  const groundedBox = new THREE.Box3().setFromPoints(grounded)
  const Lm = groundedBox.max.x - groundedBox.min.x
  const Wm = groundedBox.max.z - groundedBox.min.z
  const hull = convexHull(grounded.filter((v) => v.y <= height * 0.2).map((v) => ({ x: v.x, z: v.z })))

  // Footprint OBB (rotating calipers)
  const fp = minAreaOBB(footprint)

  const candidates: Candidate[] = [0, 1, 2, 3].map((k) => {
    const angle = fp.angle + (k * Math.PI) / 2
    const odd = k % 2 === 1
    const needX = (odd ? fp.width : fp.length) / Lm
    const needZ = (odd ? fp.length : fp.width) / Wm
    const s = Math.min(needX, needZ)
    const divergence = Math.max(needX, needZ) / s - 1
    const cap = 1.25 // constrained non-uniform: ≤25 % extra stretch on the slack axis
    const sx = divergence > 0.08 ? Math.min(needX, s * cap) : s
    const sz = divergence > 0.08 ? Math.min(needZ, s * cap) : s
    const poly = hull.map((p) => {
      const r = rot2({ x: p.x * sx, z: p.z * sz }, angle)
      return { x: r.x + fp.center.x, z: r.z + fp.center.z }
    })
    return { k, angle, sx, sz, iou: iou(footprint, poly), poly }
  })
  const chosen = candidates.reduce((a, b) => (b.iou > a.iou + 1e-6 ? b : a))

  const uniform = Math.min(chosen.sx, chosen.sz)
  const divergence = Math.max(chosen.sx, chosen.sz) / uniform - 1
  const sy = uniform
  const S = new THREE.Matrix4().makeScale(chosen.sx, sy, chosen.sz)
  const yaw = -chosen.angle // 2D rotation by φ ≡ R_y(-φ)
  const Ry = new THREE.Matrix4().makeRotationY(yaw)
  const Ttarget = new THREE.Matrix4().makeTranslation(fp.center.x, 0, fp.center.z)
  const M = new THREE.Matrix4().multiply(Ttarget).multiply(Ry).multiply(S).multiply(Tground).multiply(Ralign).multiply(N)

  const collisions = neighbors
    .map((n, index) => ({ index, overlap: polygonArea(clipPolygon(n, chosen.poly)) }))
    .filter((c) => c.overlap > 0.5)

  const flags: FitResult['flags'] = []
  if (chosen.iou >= 0.75) flags.push({ level: 'ok', text: `Footprint IoU ${(chosen.iou * 100).toFixed(1)}% — high-confidence fit` })
  else if (chosen.iou >= 0.55) flags.push({ level: 'warn', text: `Footprint IoU ${(chosen.iou * 100).toFixed(1)}% — moderate fit` })
  else flags.push({ level: 'error', text: `Footprint IoU ${(chosen.iou * 100).toFixed(1)}% — low confidence, manual review` })
  if (divergence > 0.08) flags.push({ level: 'warn', text: `Aspect divergence ${(divergence * 100).toFixed(1)}% — constrained non-uniform scale applied` })
  else flags.push({ level: 'ok', text: 'Proportions preserved — uniform scale' })
  if (collisions.length) flags.push({ level: 'error', text: `Overlaps ${collisions.length} adjacent parcel${collisions.length > 1 ? 's' : ''} (${collisions.reduce((s, c) => s + c.overlap, 0).toFixed(1)} m²)` })
  else flags.push({ level: 'ok', text: `No collisions with ${neighbors.length} adjacent parcels` })

  const confidence = Math.max(0, Math.min(1, chosen.iou * (collisions.length ? 0.7 : 1) * (1 - Math.min(divergence, 0.25) * 0.6)))
  const ang = (a: number) => {
    let d = (a * 180) / Math.PI
    while (d <= -180) d += 360
    while (d > 180) d -= 360
    return d
  }

  return {
    authority: 'preview-only',
    matrices: {
      N: N.toArray(), Ralign: Ralign.toArray(), Tground: Tground.toArray(), S: S.toArray(),
      Ry: Ry.toArray(), Ttarget: Ttarget.toArray(), M: M.toArray(),
    },
    rawAABB: { min: tuple(rawBox.min), max: tuple(rawBox.max) },
    groundedAABB: { min: tuple(groundedBox.min), max: tuple(groundedBox.max) },
    meshOBB, footprintOBB: fp,
    deltaThetaDeg: ang(fp.angle - meshOBB.angle),
    yawDeg: ang(yaw),
    candidates, chosen,
    scale: { sx: chosen.sx, sy, sz: chosen.sz, uniform, divergence, mode: divergence > 0.08 ? 'constrained' : 'uniform' },
    iou: chosen.iou, collisions, confidence, flags, height, vertexCount: verts.length,
  }
}
