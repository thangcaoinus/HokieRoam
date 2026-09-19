import { motion } from 'framer-motion'
import type { Candidate, FitResult } from '../lib/fit'
import { clipPolygon } from '../lib/fit'
import type { V2 } from '../lib/geo'

function frame(polys: V2[][], pad = 1.25) {
  const all = polys.flat()
  const cx = (Math.min(...all.map((p) => p.x)) + Math.max(...all.map((p) => p.x))) / 2
  const cz = (Math.min(...all.map((p) => p.z)) + Math.max(...all.map((p) => p.z))) / 2
  const r = Math.max(...all.map((p) => Math.max(Math.abs(p.x - cx), Math.abs(p.z - cz)))) * pad
  return (p: V2) => `${((p.x - cx) / r) * 50 + 50},${((p.z - cz) / r) * 50 + 50}`
}

export function FitPlot({ fit, footprint, neighbors }: { fit: FitResult; footprint: V2[]; neighbors: V2[][] }) {
  const P = frame([footprint, fit.chosen.poly, fit.footprintOBB.corners], 1.5)
  const pts = (p: V2[]) => p.map(P).join(' ')
  return (
    <svg className="plot" viewBox="0 0 100 100">
      <defs>
        <pattern id="g" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M5 0H0V5" fill="none" stroke="rgba(255,255,255,.05)" strokeWidth=".2" /></pattern>
        <clipPath id="vb"><rect width="100" height="100" /></clipPath>
      </defs>
      <rect width="100" height="100" fill="url(#g)" />
      <g clipPath="url(#vb)">
        {neighbors.map((n, i) => <polygon key={i} points={pts(n)} fill="rgba(255,255,255,.03)" stroke="rgba(255,255,255,.2)" strokeWidth=".25" />)}
        {fit.collisions.map((c) => {
          const o = clipPolygon(neighbors[c.index], fit.chosen.poly)
          return o.length > 2 && <polygon key={c.index} points={pts(o)} fill="rgba(255,93,108,.5)" stroke="#ff5d6c" strokeWidth=".3" />
        })}
      </g>
      <polygon points={pts(footprint)} fill="rgba(255,107,44,.14)" stroke="#ff6b2c" strokeWidth=".55" strokeLinejoin="round" />
      <polygon points={pts(fit.footprintOBB.corners)} fill="none" stroke="#5ee1ff" strokeWidth=".35" strokeDasharray="1.4 1" />
      <motion.polygon
        points={pts(fit.chosen.poly)} fill="rgba(125,255,178,.08)" stroke="#7dffb2" strokeWidth=".45" strokeLinejoin="round"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8 }}
      />
      {(() => {
        const [x, y] = P(fit.footprintOBB.center).split(',').map(Number)
        const a = fit.footprintOBB.angle
        return (
          <g stroke="#5ee1ff" strokeWidth=".3">
            <line x1={x} y1={y} x2={x + Math.cos(a) * 12} y2={y + Math.sin(a) * 12} />
            <line x1={x} y1={y} x2={x - Math.sin(a) * 7} y2={y + Math.cos(a) * 7} strokeOpacity=".5" />
            <circle cx={x} cy={y} r=".9" fill="#5ee1ff" />
          </g>
        )
      })()}
    </svg>
  )
}

export function CandidateThumb({ c, footprint, best }: { c: Candidate; footprint: V2[]; best: boolean }) {
  const P = frame([footprint, c.poly], 1.2)
  return (
    <div className={`cand ${best ? 'best' : ''}`}>
      <svg viewBox="0 0 100 100" style={{ width: '100%', display: 'block', aspectRatio: 1 }}>
        <polygon points={footprint.map(P).join(' ')} fill="rgba(255,107,44,.14)" stroke="#ff6b2c" strokeWidth="1.4" />
        <polygon points={c.poly.map(P).join(' ')} fill="none" stroke={best ? '#7dffb2' : '#5ee1ff'} strokeWidth="1.4" strokeDasharray={best ? undefined : '4 3'} />
      </svg>
      <div className="k">k={c.k} · {c.k * 90}°</div>
      <div className="meter"><i style={{ width: `${c.iou * 100}%` }} /></div>
      <div className="iou">{(c.iou * 100).toFixed(1)}%</div>
    </div>
  )
}
