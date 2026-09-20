import { EXAMPLE_KEY, useStore } from '../store'
import { sceneRing, type PlacementManifest } from './api'
import { geohash, polygonArea, unproject, type GeoResult } from './geo'
import { placementMatches } from './placement'
import { loadMeshUrl } from './reconstruct'

export const EXAMPLE_PATH = `${import.meta.env.BASE_URL}examples/dds`
interface Example {
  id: string; title: string; address: string; prompt: string; presetId: string; provider: string
  placement: PlacementManifest
}

/** All artifacts are served with the app. No API, GIS, or generation requests. */
export async function loadCompletedExample() {
  const response = await fetch(`${EXAMPLE_PATH}/example.json`)
  if (!response.ok) throw new Error('The completed example is unavailable. Run npm run prepare:example in web/.')
  const example = await response.json() as Example
  const p = example.placement
  const mesh = await loadMeshUrl(`${EXAMPLE_PATH}/model.glb`, { source: 'Cached Meshy generation · simplified for this demo', provider: example.provider })
  mesh.meta.exampleId = example.id
  const lat = p.frame.origin_latitude, lon = p.frame.origin_longitude
  const footprint = sceneRing(p.request.footprint.exterior)
  const geo: GeoResult = {
    query: example.address, displayName: example.title, lat, lon, footprint,
    footprintLatLon: footprint.map(v => unproject(v, lat, lon)),
    neighbors: (p.request.neighbors ?? []).map(n => sceneRing(n.exterior)),
    source: 'osm', osmId: p.provenance.feature_id, identityConfirmed: p.provenance.identity_confirmed,
    bucket: geohash(lat, lon), areaM2: polygonArea(footprint),
  }
  if (!placementMatches(p, geo, mesh)) throw new Error('The example model does not match its saved placement. Rebuild the example artifacts.')
  const s = useStore.getState()
  s.reset()
  s.set({ example: { id: example.id, title: example.title }, geo, address: example.address,
    photos: [`${EXAMPLE_PATH}/source.png`], primaryPhoto: 0, concept: `${EXAMPLE_PATH}/concept.png`,
    mesh, placement: p, prompt: example.prompt, presetId: example.presetId, stage: 'explore' })
  try { localStorage.setItem(EXAMPLE_KEY, example.id) } catch { /* still usable without persistence */ }
  s.log('example › completed real generation loaded from local artifacts; no new generation', 'ok')
}
