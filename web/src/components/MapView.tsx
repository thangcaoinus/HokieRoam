import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import type { GeoResult } from '../lib/geo'
import { minAreaOBB } from '../lib/fit'

const TILE = 256

function worldPx(lat: number, lon: number, z: number) {
  const n = TILE * 2 ** z
  const s = Math.sin((lat * Math.PI) / 180)
  return { x: ((lon + 180) / 360) * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n }
}

export default function MapView({ geo, loading }: { geo: GeoResult | null; loading?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 800, h: 560 })
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    if (ref.current) ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])

  // A derived site has no coordinates, so there is no correct tile to fetch. Requesting any
  // would both show the wrong place (Null Island) and put a network call on a path that
  // advertises itself as needing no geographic lookup.
  const anchored = !!geo && geo.source !== 'derived'

  const view = useMemo(() => {
    if (!geo) return null
    const ext = Math.max(...geo.footprint.map((p) => Math.max(Math.abs(p.x), Math.abs(p.z)))) * 2
    const mppAt = (z: number) => (156543.03392 * Math.cos((geo.lat * Math.PI) / 180)) / 2 ** z
    let z = 19
    while (z > 15 && ext / mppAt(z) > Math.min(size.w, size.h) * 0.42) z--
    const mpp = mppAt(z)
    const c = worldPx(geo.lat, geo.lon, z)
    const x0 = Math.floor((c.x - size.w / 2) / TILE), x1 = Math.floor((c.x + size.w / 2) / TILE)
    const y0 = Math.floor((c.y - size.h / 2) / TILE), y1 = Math.floor((c.y + size.h / 2) / TILE)
    const tiles: { key: string; src: string; left: number; top: number }[] = []
    if (anchored) for (let tx = x0; tx <= x1; tx++)
      for (let ty = y0; ty <= y1; ty++)
        tiles.push({
          key: `${z}/${tx}/${ty}`,
          src: `https://tile.openstreetmap.org/${z}/${tx}/${ty}.png`,
          left: size.w / 2 + tx * TILE - c.x,
          top: size.h / 2 + ty * TILE - c.y,
        })
    const P = (p: { x: number; z: number }) => `${size.w / 2 + p.x / mpp},${size.h / 2 + p.z / mpp}`
    const obb = minAreaOBB(geo.footprint)
    const barM = [5, 10, 20, 25, 50, 100].find((m) => m / mpp > 70) ?? 100
    return { tiles, P, obb, mpp, z, barM }
  }, [geo, size, anchored])

  return (
    <div className="map" ref={ref}>
      {!view && (
        <div className="map-empty">
          <div>
            <svg width="72" height="72" viewBox="0 0 72 72" fill="none" style={{ opacity: 0.5, marginBottom: 12 }}>
              <circle cx="36" cy="36" r="34" stroke="currentColor" strokeDasharray="3 5" />
              <circle cx="36" cy="36" r="20" stroke="currentColor" strokeDasharray="2 4" />
              <path d="M36 0v72M0 36h72" stroke="currentColor" strokeOpacity=".4" />
              <path d="M28 30h16v12H28z" stroke="#c2341d" strokeWidth="1.5" />
            </svg>
            <div style={{ fontWeight: 650, fontSize: 15, color: 'var(--ink-2)' }}>Awaiting coordinates</div>
            <div style={{ fontSize: 12.5 }}>Resolve an address to pull its authoritative footprint</div>
          </div>
        </div>
      )}
      {view && (
        <>
          <div className="map-tiles">
            {view.tiles.map((t) => (
              <img key={t.key} src={t.src} alt="" style={{ left: t.left, top: t.top }} onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
            ))}
          </div>
          <svg width={size.w} height={size.h}>
            <defs>
              {/* Cadastral hatch: fine ruled lines at 45deg, the way a plat marks the subject parcel. */}
              <pattern id="hatch" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
                <line x1="0" y1="0" x2="0" y2="6" stroke="#c2341d" strokeOpacity=".55" strokeWidth="1" />
              </pattern>
            </defs>
            {geo!.neighbors.map((n, i) => (
              <polygon key={i} points={n.map(view.P).join(' ')} fill="rgba(244,242,237,.10)" stroke="rgba(244,242,237,.55)" strokeWidth="1" />
            ))}
            <motion.polygon
              key={geo!.bucket + geo!.footprint.length}
              points={view.obb.corners.map(view.P).join(' ')}
              fill="none" stroke="#8ab4dd" strokeWidth="1" strokeDasharray="5 4"
              initial={{ opacity: 0 }} animate={{ opacity: 0.9 }} transition={{ delay: 1 }}
            />
            <motion.polygon
              key={'fp' + geo!.bucket + geo!.footprint.length}
              points={geo!.footprint.map(view.P).join(' ')}
              fill="url(#hatch)" stroke="#e8503a" strokeWidth="1.75" strokeLinejoin="round"
              initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ duration: 1.2, ease: 'easeInOut' }}
            />
            {geo!.footprint.map((p, i) => {
              const [x, y] = view.P(p).split(',').map(Number)
              return <motion.rect key={i} x={x - 2.5} y={y - 2.5} width="5" height="5" fill="#f4f2ed" stroke="#e8503a" strokeWidth="1.25" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 + i * 0.02 }} />
            })}
            <g transform={`translate(${size.w / 2},${size.h / 2})`} stroke="#f4f2ed" strokeOpacity=".75">
              <line x1="-9" x2="9" /><line y1="-9" y2="9" />
            </g>
            {/* north arrow */}
            <g transform={`translate(${size.w - 34},42)`}>
              <path d="M0-13 6 8 0 3.4-6 8Z" fill="#f4f2ed" stroke="#1b1d21" strokeWidth="1" strokeLinejoin="round" />
              <path d="M0-13 0 3.4-6 8Z" fill="#1b1d21" />
              <text y="-19" textAnchor="middle" fill="#f4f2ed" fontSize="10" fontWeight="700" fontFamily="Archivo" letterSpacing="1">N</text>
            </g>
            {/* scale bar */}
            <g transform={`translate(${size.w - 24 - view.barM / view.mpp},${size.h - 26})`}>
              {/* Alternating scale bar, as a drawing sheet prints it. */}
              <rect width={view.barM / view.mpp} height="5" fill="#f4f2ed" stroke="#1b1d21" strokeWidth="1" />
              <rect width={view.barM / view.mpp / 2} height="5" fill="#1b1d21" />
              <text y="-6" fill="#f4f2ed" fontSize="10.5" fontWeight="600" fontFamily="Archivo">{view.barM} m</text>
            </g>
          </svg>
          <div className="map-corner">
            <span className="chip mono">{anchored ? `z${view.z} · ` : ''}{geo!.source === 'osm' ? `OSM ${geo!.osmId}` : geo!.source === 'derived' ? 'derived outline · no basemap' : 'demo parcel'}</span>
          </div>
          <div className="map-hud">
            <div className="hud-card"><div className="cap">Footprint</div><div className="big">{geo!.areaM2.toFixed(0)} m²</div></div>
            <div className="hud-card"><div className="cap">OBB</div><div className="big">{view.obb.length.toFixed(1)} × {view.obb.width.toFixed(1)} m</div></div>
            <div className="hud-card"><div className="cap">Vertices</div><div className="big">{geo!.footprint.length}</div></div>
            <div className="hud-card"><div className="cap">Adjacent parcels</div><div className="big">{geo!.neighbors.length}</div></div>
          </div>
        </>
      )}
      {loading && <div className="scan" />}
    </div>
  )
}
