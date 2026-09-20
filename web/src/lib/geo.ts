// Address → lat/lon → authoritative building footprint (OSM), projected to a
// local tangent plane in meters. x = east, z = south (three.js: -z is north).

export type V2 = { x: number; z: number }

export interface GeoResult {
  query: string
  displayName: string
  lat: number
  lon: number
  footprint: V2[]
  footprintLatLon: [number, number][]
  neighbors: V2[][]
  source: 'osm' | 'demo'
  osmId?: string
  identityConfirmed?: boolean
  bucket: string
  areaM2: number
  /** OSM `height` in metres when the record carries one. Only an explicitly tagged height is
   *  used — deriving one from building:levels would be an estimate presented as a record. */
  heightM?: number
}

const M_PER_DEG_LAT = 110_540
const mPerDegLon = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180)

export function project(lat: number, lon: number, lat0: number, lon0: number): V2 {
  return { x: (lon - lon0) * mPerDegLon(lat0), z: -(lat - lat0) * M_PER_DEG_LAT }
}

export function unproject(p: V2, lat0: number, lon0: number): [number, number] {
  return [lat0 - p.z / M_PER_DEG_LAT, lon0 + p.x / mPerDegLon(lat0)]
}

const B32 = '0123456789bcdefghjkmnpqrstuvwxyz'
export function geohash(lat: number, lon: number, precision = 7) {
  let [latLo, latHi, lonLo, lonHi] = [-90, 90, -180, 180]
  let hash = ''
  let bit = 0
  let ch = 0
  let even = true
  while (hash.length < precision) {
    if (even) {
      const mid = (lonLo + lonHi) / 2
      if (lon >= mid) { ch = (ch << 1) | 1; lonLo = mid } else { ch <<= 1; lonHi = mid }
    } else {
      const mid = (latLo + latHi) / 2
      if (lat >= mid) { ch = (ch << 1) | 1; latLo = mid } else { ch <<= 1; latHi = mid }
    }
    even = !even
    if (++bit === 5) { hash += B32[ch]; bit = 0; ch = 0 }
  }
  return hash
}

export function polygonArea(p: V2[]) {
  let a = 0
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length]
    a += p[i].x * q.z - q.x * p[i].z
  }
  return Math.abs(a) / 2
}

export function pointInPolygon(pt: V2, poly: V2[]) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]
    if ((a.z > pt.z) !== (b.z > pt.z) && pt.x < ((b.x - a.x) * (pt.z - a.z)) / (b.z - a.z) + a.x) inside = !inside
  }
  return inside
}

const centroid = (p: V2[]) => ({
  x: p.reduce((s, v) => s + v.x, 0) / p.length,
  z: p.reduce((s, v) => s + v.z, 0) / p.length,
})

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))])
}

async function geocode(q: string) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`
  const res = await withTimeout(fetch(url, { headers: { Accept: 'application/json' } }), 8000)
  if (!res.ok) throw new Error(`geocoder ${res.status}`)
  const data = await res.json()
  if (!data.length) throw new Error('address not found')
  return { lat: +data[0].lat, lon: +data[0].lon, displayName: data[0].display_name as string }
}

type LatLon = { lat: number; lon: number }
interface OsmWay { type: 'way'; id: number; geometry: LatLon[]; tags?: Record<string, string> }
interface OsmRelation {
  type: 'relation'; id: number; tags?: Record<string, string>
  members: { type: string; role: string; geometry?: LatLon[] }[]
}
type OsmElement = OsmWay | OsmRelation
/** What the fetch layer hands back: one ring per building, with the tags that described it. */
export interface OsmBuilding { id: string; ring: LatLon[]; tags?: Record<string, string> }

// A single endpoint is a single point of failure: overpass-api.de returns 406 on some networks,
// and a blocked GIS lookup silently degrades the whole app to the synthetic demo parcel.
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]

/** OSM heights are metres unless suffixed; anything non-numeric is left unknown rather than guessed. */
export function osmHeight(tags: Record<string, string> | undefined): number | undefined {
  const raw = tags?.height
  if (!raw) return undefined
  const value = Number.parseFloat(raw)
  return Number.isFinite(value) && value > 0 && value < 1000 && /^[\d.]+\s*m?$/.test(raw.trim())
    ? value : undefined
}

/** Largest closed outer ring of a multipolygon relation, in plan area.
 *  A relation can have several outer parts (Burruss has four); the footprint type here is one
 *  ring, so the dominant part is used and the rest are left out rather than merged badly. */
function largestOuterRing(relation: OsmRelation): LatLon[] | null {
  let best: LatLon[] | null = null, bestArea = 0
  for (const member of relation.members ?? []) {
    if (member.role !== 'outer' || member.type !== 'way' || !member.geometry) continue
    const ring = member.geometry
    if (ring.length < 4) continue
    // Shoelace in degrees is only used to RANK parts, never as a metre measurement.
    let area = 0
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length]
      area += a.lon * b.lat - b.lon * a.lat
    }
    area = Math.abs(area) / 2
    if (area > bestArea) { bestArea = area; best = ring }
  }
  return best
}

async function overpass(query: string, timeoutMs: number): Promise<OsmElement[]> {
  let lastError: Error | null = null
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await withTimeout(
        fetch(endpoint, { method: 'POST', body: 'data=' + encodeURIComponent(query) }), timeoutMs,
      )
      if (!res.ok) throw new Error(`overpass ${res.status}`)
      return (await res.json()).elements as OsmElement[]
    } catch (e) { lastError = e as Error }
  }
  throw lastError ?? new Error('overpass unavailable')
}

function toBuildings(elements: OsmElement[]): OsmBuilding[] {
  const buildings: OsmBuilding[] = []
  for (const element of elements) {
    if (element.type === 'way') {
      if (element.geometry?.length >= 4) {
        buildings.push({ id: `way/${element.id}`, ring: element.geometry, tags: element.tags })
      }
    } else if (element.type === 'relation') {
      const ring = largestOuterRing(element)
      if (ring) buildings.push({ id: `relation/${element.id}`, ring, tags: element.tags })
    }
  }
  return buildings
}

async function fetchBuildings(lat: number, lon: number, log: (m: string) => void) {
  const area = `(around:140,${lat},${lon})`
  const ways = toBuildings(await overpass(`[out:json][timeout:20];way["building"]${area};out geom;`, 16000))
  // A building mapped as type=multipolygon carries `building` on the RELATION, so the way query
  // above misses it entirely — including Burruss Hall, this project's own example. Resolving
  // relation member geometry is far slower and frequently times out on public mirrors, so it is
  // a SEPARATE best-effort request: it can add buildings but never delay or break the way path.
  let relations: OsmBuilding[] = []
  try {
    relations = toBuildings(
      await overpass(`[out:json][timeout:25];relation["building"]${area};out geom;`, 12000))
  } catch (e) {
    log(`gis › multipolygon buildings unavailable (${(e as Error).message}); ways only`)
  }
  return [...ways, ...relations]
}

function stripClosing(p: V2[]) {
  const a = p[0], b = p[p.length - 1]
  return Math.hypot(a.x - b.x, a.z - b.z) < 1e-6 ? p.slice(0, -1) : p
}

/** Synthetic L-shaped campus hall + neighbors, used when offline or OSM has no match. */
export function demoGeo(query = 'Newman Library, Blacksburg, VA'): GeoResult {
  const lat = 37.22885, lon = -80.41925
  const rot = (-28 * Math.PI) / 180
  const r = (x: number, z: number): V2 => ({
    x: x * Math.cos(rot) - z * Math.sin(rot),
    z: x * Math.sin(rot) + z * Math.cos(rot),
  })
  const footprint = [r(-19, -8), r(19, -8), r(19, 8), r(-3, 8), r(-3, 16), r(-19, 16)].map((p) => ({ x: p.x, z: p.z - 3 }))
  const box = (cx: number, cz: number, w: number, d: number, a: number): V2[] => {
    const c = Math.cos(a), s = Math.sin(a)
    return [[-w, -d], [w, -d], [w, d], [-w, d]].map(([x, z]) => ({
      x: cx + (x / 2) * c - (z / 2) * s,
      z: cz + (x / 2) * s + (z / 2) * c,
    }))
  }
  const neighbors = [
    box(-44, 26, 22, 30, rot), box(40, -30, 34, 18, rot), box(46, 24, 16, 16, rot + 0.1),
    box(-12, -48, 40, 14, rot), box(-52, -22, 14, 22, rot),
  ]
  return {
    query, displayName: 'Newman Library (demo parcel), Blacksburg, Virginia 24061, United States',
    lat, lon, footprint, neighbors, source: 'demo', bucket: geohash(lat, lon),
    footprintLatLon: footprint.map((p) => unproject(p, lat, lon)), areaM2: polygonArea(footprint),
  }
}

export async function resolveAddress(query: string, log: (m: string) => void): Promise<GeoResult> {
  let lat: number, lon: number, displayName: string
  try {
    log(`geocode › querying Nominatim for "${query}"`)
    ;({ lat, lon, displayName } = await geocode(query))
    log(`geocode › ${lat.toFixed(6)}, ${lon.toFixed(6)}`)
  } catch (e) {
    log(`geocode › ${(e as Error).message} — falling back to demo parcel`)
    return demoGeo(query)
  }
  try {
    log('gis › fetching building footprints (Overpass, r=140 m)')
    const ways = await fetchBuildings(lat, lon, log)
    if (!ways.length) throw new Error('no buildings nearby')
    const polys = ways.map((w) => ({ id: w.id, tags: w.tags, poly: stripClosing(w.ring.map((g) => project(g.lat, g.lon, lat, lon))) }))
    const origin = { x: 0, z: 0 }
    const hit =
      polys.find((p) => pointInPolygon(origin, p.poly)) ??
      polys.reduce((best, p) => (Math.hypot(centroid(p.poly).x, centroid(p.poly).z) < Math.hypot(centroid(best.poly).x, centroid(best.poly).z) ? p : best))
    // Recentre the local frame on the target building so the scene origin sits on it.
    const c = centroid(hit.poly)
    const [clat, clon] = unproject(c, lat, lon)
    const shift = (p: V2[]) => p.map((v) => ({ x: v.x - c.x, z: v.z - c.z }))
    const footprint = shift(hit.poly)
    log(`gis › matched ${hit.id} · ${footprint.length} vertices · ${polys.length - 1} neighbors`)
    return {
      query, displayName, lat: clat, lon: clon, footprint,
      neighbors: polys.filter((p) => p !== hit).map((p) => shift(p.poly)),
      source: 'osm', osmId: hit.id, bucket: geohash(clat, clon), heightM: osmHeight(hit.tags),
      footprintLatLon: footprint.map((p) => unproject(p, clat, clon)), areaM2: polygonArea(footprint),
    }
  } catch (e) {
    log(`gis › ${(e as Error).message} — using demo footprint at resolved location`)
    const d = demoGeo(query)
    return { ...d, lat, lon, displayName, bucket: geohash(lat, lon), footprintLatLon: d.footprint.map((p) => unproject(p, lat, lon)) }
  }
}

/** Persist the geographic bucket so world state survives reloads (stand-in for the world DB). */
export function registerBucket(g: GeoResult) {
  const key = 'groundtruth.world.buckets'
  let reg: Record<string, { lat: number; lon: number; name: string; at: string }> = {}
  try { reg = JSON.parse(localStorage.getItem(key) || '{}') } catch { /* ignore */ }
  reg[g.bucket] = { lat: g.lat, lon: g.lon, name: g.displayName.split(',')[0], at: new Date().toISOString() }
  try { localStorage.setItem(key, JSON.stringify(reg)) } catch { /* ignore */ }
  return Object.keys(reg).length
}
