import { planRing, sceneRing, type FitRequest, type PlacementManifest } from './api'
import { clipPolygon, minAreaOBB, type FitResult } from './fit'
import type { Adjustment } from '../store'
import { polygonArea, type V2 } from './geo'
import type { GeoResult } from './geo'
import type { MeshAsset } from './reconstruct'

/** Shared display geometry; no browser fitting or invented metrics for a server placement. */
export type ScenePlacement = {
  matrices: Pick<FitResult['matrices'], 'M'>
  chosen: { poly: ReturnType<typeof sceneRing> }
  footprintOBB: FitResult['footprintOBB']
}

export function placementScene(p: PlacementManifest, adjust?: Adjustment | null): ScenePlacement {
  return {
    matrices: { M: adjustedMatrix(p, adjust) },
    chosen: { poly: adjustedProxy(p, adjust) },
    footprintOBB: minAreaOBB(sceneRing(p.request.footprint.exterior)),
  }
}

/** Centroid of the footprint ring; the manual nudge rotates about it so yaw feels anchored. */
export function footprintPivot(p: PlacementManifest): V2 {
  const ring = sceneRing(p.request.footprint.exterior)
  let x = 0, z = 0
  for (const v of ring) { x += v.x; z += v.z }
  return { x: x / ring.length, z: z / ring.length }
}

/** The computed matrix with the manual nudge pre-multiplied in world space (column-major). */
export function adjustedMatrix(p: PlacementManifest, adjust?: Adjustment | null): number[] {
  const m = p.selected.matrix_column_major
  if (!adjust || (!adjust.dx && !adjust.dz && !adjust.dyaw)) return m
  const { x: px, z: pz } = footprintPivot(p)
  const c = Math.cos(adjust.dyaw), s = Math.sin(adjust.dyaw)
  // A = T(pivot+delta) · Ry(dyaw) · T(-pivot), column-major, then A · M.
  const a = [
    c, 0, -s, 0,
    0, 1, 0, 0,
    s, 0, c, 0,
    px + adjust.dx - (c * px + s * pz), 0, pz + adjust.dz - (-s * px + c * pz), 1,
  ]
  const out = new Array<number>(16).fill(0)
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * m[col * 4 + k]
      out[col * 4 + row] = sum
    }
  }
  return out
}

/** The fitted proxy ring after the same nudge, for drawing and for live metrics. */
export function adjustedProxy(p: PlacementManifest, adjust?: Adjustment | null): V2[] {
  const ring = sceneRing(p.selected.fitted_proxy.exterior)
  if (!adjust || (!adjust.dx && !adjust.dz && !adjust.dyaw)) return ring
  const { x: px, z: pz } = footprintPivot(p)
  const c = Math.cos(adjust.dyaw), s = Math.sin(adjust.dyaw)
  return ring.map((v) => {
    const x = v.x - px, z = v.z - pz
    return { x: px + adjust.dx + c * x + s * z, z: pz + adjust.dz - s * x + c * z }
  })
}

/** Live plan metrics for a manual placement. The proxy is convex, so Sutherland-Hodgman clipping
 *  of the (possibly concave) footprint against it is exact — the same measure the server reports,
 *  recomputed in the browser. It is NEVER written into the manifest. */
export function manualMetrics(p: PlacementManifest, adjust?: Adjustment | null) {
  const target = sceneRing(p.request.footprint.exterior)
  const proxy = adjustedProxy(p, adjust)
  const targetArea = Math.abs(polygonArea(target))
  const proxyArea = Math.abs(polygonArea(proxy))
  const inter = Math.abs(polygonArea(clipPolygon(target, proxy)))
  const union = targetArea + proxyArea - inter
  return {
    iou: union > 0 ? inter / union : 0,
    coverage: targetArea > 0 ? inter / targetArea : 0,
    spill_fraction: proxyArea > 0 ? (proxyArea - inter) / proxyArea : 0,
    spill_area_m2: proxyArea - inter,
  }
}

export function fitRequest(geo: GeoResult, mesh: MeshAsset): FitRequest {
  return {
    footprint: { exterior: planRing(geo.footprint), holes: [] },
    frame: { origin_longitude: geo.lon, origin_latitude: geo.lat, origin_height_m: 0,
      convention: 'X=east,Y=up,Z=south', ground_mode: 'flat-assumed' },
    provenance: {
      source: geo.source === 'osm' ? 'osm' : 'synthetic',
      feature_id: geo.osmId ?? `demo/${geo.bucket}`,
      source_url: geo.osmId ? `https://www.openstreetmap.org/${geo.osmId}` : null,
      identity_confirmed: geo.source === 'osm' && !!geo.identityConfirmed,
    },
    neighbors: geo.neighbors.map((ring) => ({ exterior: planRing(ring), holes: [] })),
    up_axis: mesh.meta.upAxis,
    unit_scale: { m: 1, cm: 0.01, mm: 0.001 }[mesh.meta.units],
    min_iou: 0.85, numerical_tolerance_m: 1e-6, max_spill_fraction: 0.15,
    measured_height_m: geo.heightM ?? null, max_height_correction: 1.25,
  }
}

// Canonical keys make comparison independent of JSON property order from Python.
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const o = value as Record<string, unknown>
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function placementMatches(p: PlacementManifest, geo: GeoResult, mesh: MeshAsset): boolean {
  return !!mesh.meta.sha256 && mesh.meta.sha256 === p.asset_sha256 &&
    canonical(p.request) === canonical(fitRequest(geo, mesh))
}
