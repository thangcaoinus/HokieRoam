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

/** Mean of a ring's vertices; the manual nudge rotates about it so yaw feels anchored. */
export function ringCentroid(ring: V2[]): V2 {
  let x = 0, z = 0
  for (const v of ring) { x += v.x; z += v.z }
  return { x: x / ring.length, z: z / ring.length }
}

/** Centroid of the footprint ring; the manual nudge rotates about it so yaw feels anchored. */
export function footprintPivot(p: PlacementManifest): V2 {
  return ringCentroid(sceneRing(p.request.footprint.exterior))
}

/** Any column-major matrix with the manual nudge pre-multiplied in world space. Kept independent
 *  of `PlacementManifest` so the free-import path reuses the same review surface rather than
 *  growing a second, subtly different one. */
export function nudgeMatrix(m: number[], pivot: V2, adjust?: Adjustment | null): number[] {
  if (!adjust || (!adjust.dx && !adjust.dz && !adjust.dyaw)) return m
  const { x: px, z: pz } = pivot
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

/** The same nudge applied to a plan ring, so the drawn outline and the placed mesh move together. */
export function nudgeRing(ring: V2[], pivot: V2, adjust?: Adjustment | null): V2[] {
  if (!adjust || (!adjust.dx && !adjust.dz && !adjust.dyaw)) return ring
  const { x: px, z: pz } = pivot
  const c = Math.cos(adjust.dyaw), s = Math.sin(adjust.dyaw)
  return ring.map((v) => {
    const x = v.x - px, z = v.z - pz
    return { x: px + adjust.dx + c * x + s * z, z: pz + adjust.dz - s * x + c * z }
  })
}

/** The computed matrix with the manual nudge applied (column-major). */
export function adjustedMatrix(p: PlacementManifest, adjust?: Adjustment | null): number[] {
  return nudgeMatrix(p.selected.matrix_column_major, footprintPivot(p), adjust)
}

/** The fitted proxy ring after the same nudge, for drawing and for live metrics. */
export function adjustedProxy(p: PlacementManifest, adjust?: Adjustment | null): V2[] {
  return nudgeRing(sceneRing(p.selected.fitted_proxy.exterior), footprintPivot(p), adjust)
}

/** Plan overlap of a proxy against a target ring. The proxy is convex, so Sutherland-Hodgman
 *  clipping of the (possibly concave) target against it is exact — the same measure the server
 *  reports, recomputed in the browser. It is NEVER written into the manifest.
 *
 *  It is only meaningful when the two rings have independent origins. The free-import path does
 *  not call this: there the outline IS the object's own silhouette, so the score would be a
 *  tautology rather than a validation. */
export function planMetrics(target: V2[], proxy: V2[]) {
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

/** Live plan metrics for a manual placement of a server-fitted asset. */
export function manualMetrics(p: PlacementManifest, adjust?: Adjustment | null) {
  return planMetrics(sceneRing(p.request.footprint.exterior), adjustedProxy(p, adjust))
}

/**
 * What the top-down review surface needs, with no assumption that a placement came from the
 * server. `PlanEditor` renders this and nothing else.
 */
export interface PlanModel {
  /** Reference ring drawn in vermilion — the authoritative footprint the proxy is measured against.
   *  **Null on the free-import path**, where the outline is the object's own silhouette: there is
   *  nothing independent to score against, so the editor reports offset and yaw only. */
  target: V2[] | null
  /** The proxy at the computed placement, drawn dashed so a manual move always reads as a delta. */
  computed: V2[]
  /** What the nudge rotates about. */
  pivot: V2
  /** IoU of the computed placement, for the "vs computed" delta. Null whenever `target` is. */
  baseIou: number | null
  legend: { target?: string; proxy: string }
}

/**
 * The free-import review surface. `target` is deliberately null: the outline came from this very
 * object, so an overlap score against it would measure nothing. What the nudge produces here is
 * not a correction to a computed answer but the placement itself — it is carried into the
 * exported matrix and into Explore, because choosing where the object sits IS the task.
 */
export function derivedPlan(fit: FitResult): PlanModel {
  return {
    target: null,
    computed: fit.chosen.poly,
    pivot: ringCentroid(fit.chosen.poly),
    baseIou: null,
    legend: { proxy: 'outline derived from the model' },
  }
}

/** Scene geometry for a derived site, with the free placement composed in. */
export function derivedScene(fit: FitResult, adjust?: Adjustment | null): ScenePlacement {
  const pivot = ringCentroid(fit.chosen.poly)
  return {
    matrices: { M: nudgeMatrix(fit.matrices.M, pivot, adjust) },
    chosen: { poly: nudgeRing(fit.chosen.poly, pivot, adjust) },
    // The outline moves with the object, so the reference box moves with it too.
    footprintOBB: minAreaOBB(nudgeRing(fit.chosen.poly, pivot, adjust)),
  }
}

export function manifestPlan(p: PlacementManifest): PlanModel {
  return {
    target: sceneRing(p.request.footprint.exterior),
    computed: adjustedProxy(p, null),
    pivot: footprintPivot(p),
    baseIou: p.selected.metrics.iou,
    legend: { target: 'authoritative footprint', proxy: 'mesh outline' },
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
