import { useMemo, useRef, useState } from 'react'
import { nudgeRing, planMetrics, type PlanModel } from '../lib/placement'
import type { Adjustment } from '../store'
import type { V2 } from '../lib/geo'

/**
 * Top-down manual placement. Deck p.58's last step is "send uncertain results for manual review";
 * this is that review surface. It never edits the manifest — it produces a labelled correction
 * that sits on top of the computed placement, and it recomputes the same plan metrics live so a
 * human can see whether their nudge actually helped rather than guessing.
 *
 * It renders a `PlanModel`, not a `PlacementManifest`, so the free-import path reuses it. That
 * path has no authoritative target (`plan.target === null`), and the editor then shows offset and
 * yaw and **no IoU** rather than scoring an outline against itself.
 */
export default function PlanEditor({ plan, adjust, onChange }: {
  plan: PlanModel
  adjust: Adjustment
  onChange: (a: Adjustment) => void
}) {
  const W = 560, H = 380, PAD = 26
  const drag = useRef<{ x: number; y: number; from: Adjustment } | null>(null)
  const [hover, setHover] = useState(false)

  const { target, computed, pivot } = plan
  const moved = useMemo(() => nudgeRing(computed, pivot, adjust), [computed, pivot, adjust])

  // One transform for everything, fitted to the union so the drawing never reframes mid-drag.
  const view = useMemo(() => {
    const all = [...(target ?? []), ...computed]
    const xs = all.map((p) => p.x), zs = all.map((p) => p.z)
    const minX = Math.min(...xs), maxX = Math.max(...xs)
    const minZ = Math.min(...zs), maxZ = Math.max(...zs)
    const span = Math.max(maxX - minX, maxZ - minZ, 1) * 1.5
    const k = (Math.min(W, H) - PAD * 2) / span
    return { k, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 }
  }, [target, computed])

  const toSvg = (p: V2) => `${W / 2 + (p.x - view.cx) * view.k},${H / 2 + (p.z - view.cz) * view.k}`
  const path = (ring: V2[]) => ring.map(toSvg).join(' ')
  // Only scored against an independent target; see PlanModel.target.
  const live = useMemo(() => target && planMetrics(target, moved), [target, moved])
  const delta = live && plan.baseIou !== null ? live.iou - plan.baseIou : null

  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, from: adjust }
  }
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current
    if (!d) return
    if (e.shiftKey) {
      // Shift-drag rotates about the pivot; horizontal travel reads as yaw.
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
        background: '#fbfaf7', border: '1px solid #b3ada1', borderRadius: 2, display: 'block' }}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}
      onPointerEnter={() => setHover(true)} onPointerOut={() => setHover(false)}>
      <defs>
        <pattern id="pe-grid" width={10 * view.k} height={10 * view.k} patternUnits="userSpaceOnUse">
          <path d={`M ${10 * view.k} 0 L 0 0 0 ${10 * view.k}`} fill="none" stroke="#dcd8d0" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="url(#pe-grid)" />
      {/* where the solver put it, kept visible so the manual move is always legible as a delta */}
      <polygon points={path(computed)} fill="none" stroke="#9b948a" strokeWidth="1.5" strokeDasharray="5 4" />
      {target && <polygon points={path(target)} fill="rgba(194,52,29,.10)" stroke="#c2341d" strokeWidth="2.5" />}
      <polygon points={path(moved)} fill="rgba(22,24,28,.09)" stroke="#16181c" strokeWidth="2.5" />
      <circle cx={W / 2 + (pivot.x - view.cx) * view.k} cy={H / 2 + (pivot.z - view.cz) * view.k}
        r="3.5" fill="#c2341d" />
      <text x="12" y="21" fill="#656a71" fontSize="11" fontWeight="500">drag to move · shift-drag to rotate · grid 10 m</text>
      {/* A drawn key, so the legend cannot contradict the linework the way a colour name can. */}
      <g fontSize="11" fontWeight="500" fill="#4a4f56">
        {plan.legend.target && <>
          <line x1="12" x2="30" y1={H - 30} y2={H - 30} stroke="#c2341d" strokeWidth="2.5" />
          <text x="36" y={H - 26}>{plan.legend.target}</text>
        </>}
        <line x1="12" x2="30" y1={H - 16} y2={H - 16} stroke="#16181c" strokeWidth="2.5" />
        <text x="36" y={H - 12}>{plan.legend.proxy}</text>
        <line x1="12" x2="30" y1={H - 16} y2={H - 16} stroke="none" />
        <g transform={`translate(${plan.legend.proxy.length * 6.2 + 52}, 0)`}>
          <line x1="12" x2="30" y1={H - 16} y2={H - 16} stroke="#9b948a" strokeWidth="1.5" strokeDasharray="5 4" />
          <text x="36" y={H - 12}>computed placement</text>
        </g>
      </g>
    </svg>

    <div className="stats" style={{ marginTop: 14 }}>
      {live ? <>
        {stat('IoU now', `${(live.iou * 100).toFixed(1)}%`,
          delta === null || Math.abs(delta) < 1e-4 ? undefined : delta > 0 ? 'var(--ok)' : 'var(--warn)')}
        {stat('vs computed', delta === null ? '—' : `${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)} pts`)}
        {stat('Coverage', `${(live.coverage * 100).toFixed(1)}%`)}
        {stat('Spill', `${live.spill_area_m2.toFixed(0)} m²`)}
      </> : <>
        {stat('Offset', `${Math.hypot(adjust.dx, adjust.dz).toFixed(1)} m`)}
        {stat('Yaw', `${(adjust.dyaw * 180 / Math.PI).toFixed(1)}°`)}
        {stat('Overlap score', 'not measured')}
      </>}
    </div>
    <p className="dimmer" style={{ marginTop: 10 }}>
      {live
        ? <>Offset {Math.hypot(adjust.dx, adjust.dz).toFixed(1)} m · yaw {(adjust.dyaw * 180 / Math.PI).toFixed(1)}°.
          Measured in the browser against the same footprint the server used. A manual placement is
          never reported as the computed result.</>
        : <>The outline is the object's own plan silhouette, so there is nothing independent to
          score it against — this surface positions the object, it does not validate it. Position
          and orientation are yours; no overlap score and no verdict are claimed.</>}
    </p>
  </div>
}
