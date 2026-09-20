import { useMemo, useRef, useState } from 'react'
import { sceneRing, type PlacementManifest } from '../lib/api'
import { adjustedProxy, footprintPivot, manualMetrics } from '../lib/placement'
import type { Adjustment } from '../store'
import type { V2 } from '../lib/geo'

/**
 * Top-down manual placement. Deck p.58's last step is "send uncertain results for manual review";
 * this is that review surface. It never edits the manifest — it produces a labelled correction
 * that sits on top of the computed placement, and it recomputes the same plan metrics live so a
 * human can see whether their nudge actually helped rather than guessing.
 */
export default function PlanEditor({ placement, adjust, onChange }: {
  placement: PlacementManifest
  adjust: Adjustment
  onChange: (a: Adjustment) => void
}) {
  const W = 560, H = 380, PAD = 26
  const drag = useRef<{ x: number; y: number; from: Adjustment } | null>(null)
  const [hover, setHover] = useState(false)

  const target = useMemo(() => sceneRing(placement.request.footprint.exterior), [placement])
  const computed = useMemo(() => adjustedProxy(placement, null), [placement])
  const moved = useMemo(() => adjustedProxy(placement, adjust), [placement, adjust])
  const pivot = useMemo(() => footprintPivot(placement), [placement])

  // One transform for everything, fitted to the union so the drawing never reframes mid-drag.
  const view = useMemo(() => {
    const all = [...target, ...computed]
    const xs = all.map((p) => p.x), zs = all.map((p) => p.z)
    const minX = Math.min(...xs), maxX = Math.max(...xs)
    const minZ = Math.min(...zs), maxZ = Math.max(...zs)
    const span = Math.max(maxX - minX, maxZ - minZ, 1) * 1.5
    const k = (Math.min(W, H) - PAD * 2) / span
    return { k, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 }
  }, [target, computed])

  const toSvg = (p: V2) => `${W / 2 + (p.x - view.cx) * view.k},${H / 2 + (p.z - view.cz) * view.k}`
  const path = (ring: V2[]) => ring.map(toSvg).join(' ')
  const live = useMemo(() => manualMetrics(placement, adjust), [placement, adjust])
  const base = placement.selected.metrics
  const delta = live.iou - base.iou

  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, from: adjust }
  }
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current
    if (!d) return
    if (e.shiftKey) {
      // Shift-drag rotates about the footprint centroid; horizontal travel reads as yaw.
      onChange({ ...d.from, dyaw: d.from.dyaw + (e.clientX - d.x) * 0.006 })
    } else {
      onChange({ ...d.from, dx: d.from.dx + (e.clientX - d.x) / view.k, dz: d.from.dz + (e.clientY - d.y) / view.k })
    }
  }
  const onUp = () => { drag.current = null }

  const stat = (label: string, value: string, tone?: string) =>
    <div className="stat" key={label}><div className="v" style={tone ? { color: tone } : undefined}>{value}</div><div className="k">{label}</div></div>

  return <div>
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label="Top-down manual placement editor"
      style={{ touchAction: 'none', cursor: drag.current ? 'grabbing' : hover ? 'grab' : 'default',
        background: '#100e0d', borderRadius: 10, display: 'block' }}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}
      onPointerEnter={() => setHover(true)} onPointerOut={() => setHover(false)}>
      <defs>
        <pattern id="pe-grid" width={10 * view.k} height={10 * view.k} patternUnits="userSpaceOnUse">
          <path d={`M ${10 * view.k} 0 L 0 0 0 ${10 * view.k}`} fill="none" stroke="#2a2320" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="url(#pe-grid)" />
      {/* where the solver put it, kept visible so the manual move is always legible as a delta */}
      <polygon points={path(computed)} fill="none" stroke="#4a5f52" strokeWidth="1.5" strokeDasharray="5 4" />
      <polygon points={path(target)} fill="rgba(255,107,44,.10)" stroke="#ff6b2c" strokeWidth="2.5" />
      <polygon points={path(moved)} fill="rgba(125,255,178,.16)" stroke="#7dffb2" strokeWidth="2.5" />
      <circle cx={W / 2 + (pivot.x - view.cx) * view.k} cy={H / 2 + (pivot.z - view.cz) * view.k}
        r="3.5" fill="#ff6b2c" />
      <text x="12" y="22" fill="#8d8279" fontSize="11">drag to move · shift-drag to rotate</text>
      <text x="12" y={H - 26} fill="#ff6b2c" fontSize="11">orange: authoritative footprint</text>
      <text x="12" y={H - 12} fill="#7dffb2" fontSize="11">green: mesh outline · dashed: computed placement</text>
    </svg>

    <div className="stats" style={{ marginTop: 14 }}>
      {stat('IoU now', `${(live.iou * 100).toFixed(1)}%`,
        Math.abs(delta) < 1e-4 ? undefined : delta > 0 ? 'var(--ok)' : 'var(--warn)')}
      {stat('vs computed', `${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)} pts`)}
      {stat('Coverage', `${(live.coverage * 100).toFixed(1)}%`)}
      {stat('Spill', `${live.spill_area_m2.toFixed(0)} m²`)}
    </div>
    <p className="dimmer" style={{ marginTop: 10 }}>
      Offset {Math.hypot(adjust.dx, adjust.dz).toFixed(1)} m · yaw {(adjust.dyaw * 180 / Math.PI).toFixed(1)}°.
      Measured in the browser against the same footprint the server used. A manual placement is
      never reported as the computed result.
    </p>
  </div>
}
