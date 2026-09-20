import { planRing, sceneRing, type FitRequest, type PlacementManifest } from './api'
import { minAreaOBB, type FitResult } from './fit'
import type { GeoResult } from './geo'
import type { MeshAsset } from './reconstruct'

/** Shared display geometry; no browser fitting or invented metrics for a server placement. */
export type ScenePlacement = {
  matrices: Pick<FitResult['matrices'], 'M'>
  chosen: { poly: ReturnType<typeof sceneRing> }
  footprintOBB: FitResult['footprintOBB']
}

export function placementScene(p: PlacementManifest): ScenePlacement {
  return {
    matrices: { M: p.selected.matrix_column_major },
    chosen: { poly: sceneRing(p.selected.fitted_proxy.exterior) },
    footprintOBB: minAreaOBB(sceneRing(p.request.footprint.exterior)),
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
    min_iou: 0.85, numerical_tolerance_m: 1e-6,
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
