import { unzipSync } from 'fflate'
import { BUNDLE_KEY, useStore } from '../store'
import type { PlacementManifest } from './api'
import { sceneRing } from './api'
import { geohash, polygonArea, unproject, type GeoResult } from './geo'
import { canonical, placementMatches } from './placement'
import { loadMeshUrl } from './reconstruct'

const LIMIT = 100 * 1024 * 1024
const decoder = new TextDecoder()
function fail(message: string): never { throw new Error(message) }
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const vector = (v: unknown, n: number) => Array.isArray(v) && v.length === n && v.every(finite)
const ring = (v: unknown) => Array.isArray(v) && v.length >= 3 && v.length <= 10000 && v.every(p => vector(p, 2))
const polygon = (v: any) => v && ring(v.exterior) && Array.isArray(v.holes) && v.holes.length === 0

// Runtime checks precede the renderer. This importer supports the current UI's flat, hole-free
// OSM/synthetic placement contract; other manifests are left intact and explicitly rejected.
function placement(value: any): PlacementManifest {
  const p = value, r = p?.request, f = p?.frame, c = p?.selected
  if (p?.schema_version !== 1 || p.applies_to !== 'unchanged-source-glb-asset-root' ||
      !/^[a-f0-9]{64}$/.test(p.asset_sha256 ?? '') || !r || !f || !c ||
      !polygon(r.footprint) || !polygon(c.fitted_proxy) ||
      !vector(c.matrix_column_major, 16) || !finite(c.scale) || c.scale <= 0 || !finite(c.yaw_radians) ||
      !['accepted', 'review', 'rejected'].includes(p.plan_fit) ||
      p.heading !== 'ambiguous' || p.height !== 'inferred' ||
      !['performed', 'not-provided'].includes(p.neighbor_check) ||
      !Array.isArray(p.warnings) || !p.warnings.every((w: unknown) => typeof w === 'string') ||
      !c.metrics || !['iou', 'coverage', 'spill_fraction', 'spill_area_m2', 'neighbor_overlap_m2'].every(k => finite(c.metrics[k])) ||
      typeof c.metrics.contained !== 'boolean' || !vector(p.source_dimensions_m, 3) || !vector(p.fitted_dimensions_m, 3)) {
    fail('Invalid placement.json: expected a version 1 Groundtruth placement with finite geometry and metrics.')
  }
  if (!finite(f.origin_latitude) || Math.abs(f.origin_latitude) > 90 ||
      !finite(f.origin_longitude) || Math.abs(f.origin_longitude) > 180 ||
      f.origin_height_m !== 0 || f.convention !== 'X=east,Y=up,Z=south' || f.ground_mode !== 'flat-assumed' ||
      !['osm', 'synthetic'].includes(p.provenance?.source) || typeof p.provenance?.feature_id !== 'string' ||
      typeof p.provenance?.identity_confirmed !== 'boolean' ||
      !Array.isArray(r.neighbors) || !r.neighbors.every(polygon) ||
      canonical(f) !== canonical(r.frame) || canonical(p.provenance) !== canonical(r.provenance)) {
    fail('This bundle uses a placement frame or footprint format the current viewer does not support.')
  }
  return p as PlacementManifest
}

function embeddedGLB(bytes: Uint8Array) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length < 20 || v.getUint32(0, true) !== 0x46546c67 || v.getUint32(4, true) !== 2 ||
      v.getUint32(8, true) !== bytes.length || v.getUint32(16, true) !== 0x4e4f534a) fail('Invalid model.glb.')
  const size = v.getUint32(12, true)
  const doc = JSON.parse(decoder.decode(bytes.subarray(20, 20 + size)))
  if ([...(doc.buffers ?? []), ...(doc.images ?? [])].some(entry => entry.uri)) {
    fail('Use a self-contained GLB with embedded buffers and textures.')
  }
}

async function digest(bytes: Uint8Array) {
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('')
}

// Store a single original ZIP, rather than large data URLs in localStorage.
async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open('groundtruth-bundle', 1)
    open.onupgradeneeded = () => open.result.createObjectStore('files')
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error)
  })
}
async function stored(file?: File): Promise<File | undefined> {
  const db = await database()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('files', file ? 'readwrite' : 'readonly')
      const request = file ? tx.objectStore('files').put(file, 'current') : tx.objectStore('files').get('current')
      tx.oncomplete = () => resolve(file ?? request.result)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally { db.close() }
}

export async function restoreSavedBundle() {
  const file = await stored()
  if (!file) fail('The saved ZIP is no longer in this browser. Open your exported bundle again.')
  await openSavedBundle(file, false)
}

export async function openSavedBundle(file: File, persist = true) {
  const revision = useStore.getState().revision
  if (file.size > LIMIT) fail('Use a ZIP smaller than 100 MB.')
  const input = new Uint8Array(await file.arrayBuffer())
  let total = 0, count = 0
  const names = new Set<string>()
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(input, { filter: entry => {
      if (++count > 32 || names.has(entry.name) || !/^(model\.glb|placement\.json|generation\.json|optimization\.json|(?:source|concept)(?:_[2-4])?\.(?:png|jpg))$/.test(entry.name)) {
        fail('Unexpected or duplicate file in the bundle.')
      }
      names.add(entry.name)
      total += entry.originalSize
      if (total > 180 * 1024 * 1024 || entry.originalSize > LIMIT ||
          (entry.name.endsWith('.json') && entry.originalSize > 1024 * 1024)) fail('Bundle contents exceed the supported size limit.')
      return true
    } })
  } catch (e) { fail(`Cannot read this Groundtruth ZIP: ${(e as Error).message}`) }
  const parse = (name: string) => {
    if (!files[name]) fail(`Bundle is missing ${name}. Export after fitting the model.`)
    try { return JSON.parse(decoder.decode(files[name])) } catch { return fail(`Invalid ${name}.`) }
  }
  const p = placement(parse('placement.json')), generation = parse('generation.json')
  if (!files['model.glb']) fail('Bundle is missing model.glb.')
  if (typeof generation.provider !== 'string' || typeof generation.settings?.prompt !== 'string' ||
      !generation.sha256 || typeof generation.sha256 !== 'object') fail('Invalid generation provenance.')
  for (const [name, bytes] of Object.entries(files)) {
    if (!/\.(glb|png|jpg)$/.test(name)) continue
    const key = name.replace(/\.[^.]+$/, '')
    if (await digest(bytes) !== generation.sha256[key]) fail(`Hash mismatch for ${name}. The bundle has changed or is incomplete.`)
  }
  for (const key of Object.keys(generation.sha256)) {
    if (!Object.keys(files).some(name => name.replace(/\.[^.]+$/, '') === key)) {
      fail(`Bundle is missing the recorded ${key} artifact.`)
    }
  }
  if (generation.sha256.model !== p.asset_sha256) fail('The model does not match its saved placement.')
  const sourceNames = ['source', 'source_2', 'source_3', 'source_4'].map(k => Object.keys(files).find(n => n === `${k}.png` || n === `${k}.jpg`)).filter((n): n is string => !!n)
  if (!sourceNames.length) fail('Bundle is missing its source photo.')
  embeddedGLB(files['model.glb'])
  const urls: string[] = []
  const url = (bytes: BlobPart, type: string) => { const u = URL.createObjectURL(new Blob([bytes], { type })); urls.push(u); return u }
  try {
    const mesh = await loadMeshUrl(url(files['model.glb'], 'model/gltf-binary'), { source: `Imported bundle · ${file.name}`, provider: generation.provider })
    mesh.meta.bundle = true
    const lat = p.frame.origin_latitude, lon = p.frame.origin_longitude
    const footprint = sceneRing(p.request.footprint.exterior)
    const geo: GeoResult = {
      query: p.provenance.feature_id, displayName: `Saved design · ${p.provenance.feature_id}`,
      lat, lon, footprint, footprintLatLon: footprint.map(v => unproject(v, lat, lon)),
      neighbors: p.request.neighbors!.map(n => sceneRing(n.exterior)),
      source: p.provenance.source === 'osm' ? 'osm' : 'demo',
      osmId: p.provenance.source === 'osm' ? p.provenance.feature_id : undefined,
      identityConfirmed: p.provenance.identity_confirmed, bucket: geohash(lat, lon), areaM2: polygonArea(footprint),
    }
    // No second fit, inferred corrections, or silently discarded request fields.
    if (!placementMatches(p, geo, mesh)) fail('This placement uses inputs the current viewer cannot restore exactly.')
    const photos = sourceNames.map(n => url(files[n], n.endsWith('.png') ? 'image/png' : 'image/jpeg'))
    const conceptName = Object.keys(files).find(n => n === 'concept.png' || n === 'concept.jpg')
    const concept = conceptName ? url(files[conceptName], conceptName.endsWith('.png') ? 'image/png' : 'image/jpeg') : null
    const archiveUrl = url(file, 'application/zip')
    let saved = !persist
    if (persist) { try { await stored(file); saved = true } catch { /* current session remains usable */ } }
    if (useStore.getState().revision !== revision) fail('Opening cancelled because the project changed.')
    const s = useStore.getState()
    s.reset()
    s.set({ bundle: { name: file.name, url: archiveUrl, urls }, mesh, geo, placement: p,
      photos, primaryPhoto: 0, concept, prompt: generation.settings.prompt,
      strength: finite(generation.settings.strength) ? generation.settings.strength : 0.8,
      address: geo.displayName, stage: 'explore' })
    if (saved) { try { localStorage.setItem(BUNDLE_KEY, 'current') } catch { saved = false } }
    s.log('bundle › opened saved model and placement; no generation or geographic lookup', 'ok')
    if (!saved) s.log('bundle › browser storage unavailable; reopen the ZIP after refresh', 'warn')
  } catch (e) { urls.forEach(u => URL.revokeObjectURL(u)); throw e }
}
