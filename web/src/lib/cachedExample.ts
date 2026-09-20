import { EXAMPLE_KEY, useStore } from '../store'
import { sceneRing, type PlacementManifest } from './api'
import { geohash, polygonArea, unproject, type GeoResult } from './geo'
import { placementMatches } from './placement'
import { loadMeshUrl } from './reconstruct'

/** Example ids that ship as static artifacts under web/public/examples/<id>/. */
export const EXAMPLE_IDS = ['burruss', 'dds'] as const
export type ExampleId = (typeof EXAMPLE_IDS)[number]
/** The one the "Load completed real example" button opens. */
export const DEFAULT_EXAMPLE: ExampleId = 'burruss'
export const examplePath = (id: ExampleId) => `${import.meta.env.BASE_URL}examples/${id}`
/** Kept for callers that only need the default example's artifacts. */
export const EXAMPLE_PATH = examplePath(DEFAULT_EXAMPLE)

interface Example {
  id: string; title: string; address: string; prompt: string; presetId: string; provider: string
  /** Artifact filenames, so a four-view example is not assumed to be a single PNG. */
  photos: string[]; concept: string
  optimization?: { ratio: number }
  placement: PlacementManifest
}

/** All artifacts are served with the app. No API, GIS, or generation requests. */
export async function loadCompletedExample(id: ExampleId = DEFAULT_EXAMPLE) {
  const base = examplePath(id)
  const response = await fetch(`${base}/example.json`)
  if (!response.ok) throw new Error('The completed example is unavailable. Run npm run prepare:example in web/.')
  const example = await response.json() as Example
  const p = example.placement
  const simplified = (example.optimization?.ratio ?? 1) < 1
  const mesh = await loadMeshUrl(`${base}/model.glb`, {
    source: simplified ? 'Cached Meshy generation · simplified for this demo' : 'Cached Meshy generation',
    provider: example.provider })
  mesh.meta.exampleId = example.id
  const lat = p.frame.origin_latitude, lon = p.frame.origin_longitude
  const footprint = sceneRing(p.request.footprint.exterior)
  const geo: GeoResult = {
    query: example.address, displayName: example.title, lat, lon, footprint,
    footprintLatLon: footprint.map(v => unproject(v, lat, lon)),
    neighbors: (p.request.neighbors ?? []).map(n => sceneRing(n.exterior)),
    source: 'osm', osmId: p.provenance.feature_id, identityConfirmed: p.provenance.identity_confirmed,
    bucket: geohash(lat, lon), areaM2: polygonArea(footprint),
    heightM: p.request.measured_height_m ?? undefined,
  }
  if (!placementMatches(p, geo, mesh)) throw new Error('The example model does not match its saved placement. Rebuild the example artifacts.')
  const s = useStore.getState()
  s.reset()
  s.set({ example: { id: example.id, title: example.title }, geo, address: example.address,
    photos: example.photos.map((file) => `${base}/${file}`), primaryPhoto: 0,
    concept: `${base}/${example.concept}`,
    mesh, placement: p, prompt: example.prompt, presetId: example.presetId, stage: 'explore' })
  try { localStorage.setItem(EXAMPLE_KEY, example.id) } catch { /* still usable without persistence */ }
  s.log('example › completed real generation loaded from local artifacts; no new generation', 'ok')
}
