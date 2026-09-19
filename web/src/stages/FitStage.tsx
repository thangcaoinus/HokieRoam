import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowRight, CheckCircle2, Copy, Download, Package, Play, XCircle } from 'lucide-react'
import * as THREE from 'three'
import { useStore } from '../store'
import { solveFit, type FitResult } from '../lib/fit'
import { exportGLB } from '../lib/reconstruct'
import FitScene, { type Layers } from '../components/FitScene'
import { CandidateThumb, FitPlot } from '../components/FitPlot'
import MatrixView from '../components/MatrixView'

const SOLVER = [
  { t: 'Normalize', d: 'Y-up · meters' },
  { t: 'Center & ground', d: 'AABB → y = 0' },
  { t: 'Calipers', d: 'Footprint OBB' },
  { t: 'Orientation', d: 'Δθ + k·90°, IoU' },
  { t: 'Scale', d: 'Proportional fit' },
  { t: 'Validate', d: 'Parcel collisions' },
  { t: 'Export', d: '4×4 affine' },
]

const FACTORS = [
  { key: 'M', label: 'M' },
  { key: 'Ttarget', label: 'T_target' },
  { key: 'Ry', label: 'R_y(θ)' },
  { key: 'S', label: 'S' },
  { key: 'Tground', label: 'T_ground' },
  { key: 'Ralign', label: 'R_align' },
  { key: 'N', label: 'N' },
] as const

function download(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

function transformJSON(fit: FitResult) {
  const { geo, mesh } = useStore.getState()
  const rowMajor = new THREE.Matrix4().fromArray(fit.matrices.M).transpose().toArray()
  return {
    version: 1,
    generator: 'groundtruth',
    anchor: {
      lat: geo!.lat, lon: geo!.lon, geohash: geo!.bucket, source: geo!.source, osm_id: geo!.osmId ?? null,
      frame: 'local tangent plane · x=east, y=up, z=south · meters',
    },
    transform: {
      composition: 'T_target · R_y(θ) · S · T_ground · R_align · N',
      matrix_column_major: fit.matrices.M,
      matrix_row_major: rowMajor,
      factors: fit.matrices,
    },
    fit: {
      iou: fit.iou, yaw_deg: fit.yawDeg, delta_theta_deg: fit.deltaThetaDeg, k: fit.chosen.k,
      scale: fit.scale, confidence: fit.confidence, collisions: fit.collisions,
      needs_review: fit.flags.some((f) => f.level === 'error'),
    },
    source_mesh: mesh?.meta,
    footprint_latlon: geo!.footprintLatLon,
  }
}

export default function FitStage() {
  const s = useStore()
  const progress = useRef(s.fit ? 7 : 0)
  const [step, setStep] = useState(s.fit ? 7 : -1)
  const [factor, setFactor] = useState<(typeof FACTORS)[number]['key']>('M')
  const [layers, setLayers] = useState<Layers>({ footprint: true, aabb: true, obb: true, neighbors: true })
  const [copied, setCopied] = useState(false)
  const raf = useRef(0)
  const [preview, setPreview] = useState<FitResult | null>(s.fit)

  useEffect(() => () => cancelAnimationFrame(raf.current), [])

  const run = () => {
    if (!s.mesh || !s.geo) return
    const t0 = performance.now()
    const fit = solveFit({ mesh: s.mesh.object, normalization: s.mesh.normalization, footprint: s.geo.footprint, neighbors: s.geo.neighbors })
    const ms = performance.now() - t0
    s.log(`fit › solved in ${ms.toFixed(1)} ms over ${fit.vertexCount.toLocaleString()} vertices`)
    setPreview(fit)
    s.set({ fit: null })
    progress.current = 0
    const start = performance.now()
    const logs = [
      () => s.log(`fit › N: ${s.mesh!.meta.upAxis}-up/${s.mesh!.meta.units} → Y-up/m`),
      () => s.log(`fit › mesh OBB ${fit.meshOBB.length.toFixed(2)}×${fit.meshOBB.width.toFixed(2)} m, grounded Δy=${(-fit.rawAABB.min[1]).toFixed(2)}`),
      () => s.log(`fit › footprint OBB ${fit.footprintOBB.length.toFixed(2)}×${fit.footprintOBB.width.toFixed(2)} m @ ${(fit.footprintOBB.angle * 180 / Math.PI).toFixed(2)}°`),
      () => s.log(`fit › Δθ=${fit.deltaThetaDeg.toFixed(2)}° · best k=${fit.chosen.k} IoU ${(fit.iou * 100).toFixed(1)}%`),
      () => s.log(`fit › scale (${fit.scale.sx.toFixed(3)}, ${fit.scale.sy.toFixed(3)}, ${fit.scale.sz.toFixed(3)}) ${fit.scale.mode}`),
      () => s.log(`fit › ${fit.collisions.length ? fit.collisions.length + ' parcel collision(s)' : 'no parcel collisions'}`, fit.collisions.length ? 'warn' : 'info'),
      () => s.log(`fit › transform exported · confidence ${(fit.confidence * 100).toFixed(0)}%`, 'ok'),
    ]
    let last = -1
    const tick = () => {
      const p = Math.min(7, ((performance.now() - start) / 1000) * 1.15)
      progress.current = p
      const st = Math.floor(p)
      while (last < Math.min(st, 6)) logs[++last]()
      setStep(st)
      if (p < 7) raf.current = requestAnimationFrame(tick)
      else s.set({ fit })
    }
    cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(tick)
  }

  const fit = preview
  const done = step >= 7
  const reveal = (i: number) => step >= i

  const copy = async () => {
    await navigator.clipboard.writeText(JSON.stringify(transformJSON(fit!), null, 2))
    setCopied(true); setTimeout(() => setCopied(false), 1400)
  }
  const exportGlb = async () => {
    s.log('export › writing map-anchored GLB…')
    const blob = await exportGLB(s.mesh!, new THREE.Matrix4().fromArray(fit!.matrices.M))
    download(blob, `groundtruth-${s.geo!.bucket}.glb`)
    s.log(`export › GLB ${(blob.size / 1024).toFixed(0)} KB`, 'ok')
  }

  const circ = 2 * Math.PI * 46

  return (
    <div className="stage">
      <div className="eyebrow">Stage 04 · Automated fitting & alignment</div>
      <div className="row wrap" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <h1 className="h1">Snap it to the <em>map</em>.</h1>
          <p className="lede" style={{ marginBottom: 22 }}>No manual modeling. The solver normalizes, grounds, orients and scales the mesh onto the authoritative footprint, then serializes a reproducible transform.</p>
        </div>
        <button className="btn primary lg" onClick={run} disabled={step >= 0 && step < 7} style={{ marginBottom: 24 }}>
          <Play size={16} /> {fit ? 'Re-run solver' : 'Run alignment solver'}
        </button>
      </div>

      <div className="solver">
        {SOLVER.map((x, i) => (
          <div key={x.t} className={`solver-step ${step === i ? 'on' : ''} ${step > i ? 'done' : ''}`}>
            <div className="i">{step > i ? '✓ ' : ''}0{i + 1}</div>
            <b>{x.t}</b>
            <div className="dimmer" style={{ fontSize: 11 }}>{x.d}</div>
          </div>
        ))}
      </div>

      <div className="fit-grid">
        <div className="card" style={{ padding: 6 }}>
          <div className="viewer">
            {fit && s.mesh && s.geo ? (
              <FitScene asset={s.mesh} fit={fit} footprint={s.geo.footprint} neighbors={s.geo.neighbors} progress={progress} layers={layers} />
            ) : (
              <div className="map-empty"><div>
                <div style={{ fontFamily: 'var(--display)', fontSize: 18, color: 'var(--text-2)', marginBottom: 4 }}>Solver idle</div>
                <div style={{ fontSize: 12.5 }}>Run the alignment solver to watch the mesh snap onto its footprint</div>
              </div></div>
            )}
            <div className="viewer-hud">
              <div className="glass row wrap" style={{ padding: '8px 12px', gap: 14 }}>
                {([['footprint', 'Footprint', '#ff6b2c'], ['obb', 'Footprint OBB', '#5ee1ff'], ['aabb', 'Raw AABB', '#5ee1ff'], ['neighbors', 'Parcels', '#6d6963']] as const).map(([k, l, c]) => (
                  <label key={k} className="toggle">
                    <input type="checkbox" checked={layers[k]} onChange={(e) => setLayers({ ...layers, [k]: e.target.checked })} />
                    <i style={{ width: 10, height: 3, background: c, borderRadius: 2 }} />{l}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="stack">
          <div className="card card-pad">
            <div className="row" style={{ gap: 18 }}>
              <div className="ring">
                <svg width="108" height="108">
                  <circle cx="54" cy="54" r="46" fill="none" stroke="rgba(255,255,255,.07)" strokeWidth="8" />
                  <circle cx="54" cy="54" r="46" fill="none" stroke="url(#rg)" strokeWidth="8" strokeLinecap="round"
                    strokeDasharray={circ} strokeDashoffset={circ * (1 - (reveal(3) && fit ? fit.iou : 0))} style={{ transition: 'stroke-dashoffset 1s cubic-bezier(.2,.8,.2,1)' }} />
                  <defs><linearGradient id="rg"><stop offset="0" stopColor="#ff6b2c" /><stop offset="1" stopColor="#ffb35c" /></linearGradient></defs>
                </svg>
                <div className="c"><div><b>{reveal(3) && fit ? (fit.iou * 100).toFixed(1) : '—'}</b><small>IOU %</small></div></div>
              </div>
              <div className="stats" style={{ flex: 1 }}>
                <div className="stat"><div className="v">{reveal(3) && fit ? fit.deltaThetaDeg.toFixed(1) : '—'}<small>°</small></div><div className="k">Δθ</div></div>
                <div className="stat"><div className="v">{reveal(3) && fit ? fit.yawDeg.toFixed(1) : '—'}<small>°</small></div><div className="k">Yaw θ</div></div>
                <div className="stat"><div className="v">{reveal(4) && fit ? fit.scale.uniform.toFixed(3) : '—'}<small>×</small></div><div className="k">Scale s</div></div>
                <div className="stat hl"><div className="v">{done && fit ? (fit.confidence * 100).toFixed(0) : '—'}<small>%</small></div><div className="k">Confidence</div></div>
              </div>
            </div>
          </div>

          <div className="card card-pad">
            <div className="card-title"><span className="n">XZ</span> Footprint fit <span className="right legend"><span><i style={{ background: '#ff6b2c' }} />GIS</span><span><i style={{ background: '#7dffb2' }} />Mesh</span><span><i style={{ background: '#5ee1ff' }} />OBB</span></span></div>
            {fit && reveal(3) && s.geo ? (
              <>
                <FitPlot fit={fit} footprint={s.geo.footprint} neighbors={s.geo.neighbors} />
                <div className="label" style={{ marginTop: 12 }}><span>Cardinal candidates</span><span>max IoU</span></div>
                <div className="cands">
                  {fit.candidates.map((c) => <CandidateThumb key={c.k} c={c} footprint={s.geo!.footprint} best={c.k === fit.chosen.k} />)}
                </div>
              </>
            ) : (
              <div className="dimmer" style={{ fontSize: 13, padding: '30px 0', textAlign: 'center' }}>Orientation search results appear here</div>
            )}
          </div>
        </div>
      </div>

      {fit && reveal(5) && (
        <div className="fit-grid" style={{ marginTop: 18 }}>
          <div className="card card-pad">
            <div className="card-title"><span className="n">4×4</span> Transform inspector
              <span className="right row">
                <button className="btn sm" onClick={copy}><Copy size={13} /> {copied ? 'Copied' : 'Copy JSON'}</button>
                <button className="btn sm" onClick={() => download(new Blob([JSON.stringify(transformJSON(fit), null, 2)], { type: 'application/json' }), `transform-${s.geo!.bucket}.json`)}><Download size={13} /> transform.json</button>
                <button className="btn sm" onClick={exportGlb}><Package size={13} /> GLB</button>
              </span>
            </div>
            <div className="formula" style={{ marginBottom: 12 }}>
              <b>M</b> ={' '}
              {FACTORS.slice(1).map((f, i) => (
                <span key={f.key}>
                  <span className={factor === f.key ? 'on' : ''} style={{ cursor: 'pointer' }} onClick={() => setFactor(f.key)}>{f.label}</span>
                  {i < FACTORS.length - 2 ? ' · ' : ''}
                </span>
              ))}
            </div>
            <div className="seg" style={{ marginBottom: 12 }}>
              {FACTORS.map((f) => <button key={f.key} className={factor === f.key ? 'on' : ''} onClick={() => setFactor(f.key)}>{f.label}</button>)}
            </div>
            <MatrixView m={fit.matrices[factor]} />
          </div>

          <div className="card card-pad">
            <div className="card-title"><span className="n">QA</span> Validation</div>
            <div className="flags">
              {fit.flags.map((f, i) => (
                <div key={i} className={`flag ${f.level}`}>
                  {f.level === 'ok' ? <CheckCircle2 size={16} /> : f.level === 'warn' ? <AlertTriangle size={16} /> : <XCircle size={16} />}
                  <span>{f.text}</span>
                </div>
              ))}
            </div>
            <div className="divider" style={{ margin: '14px 0' }} />
            <div className="stack" style={{ gap: 6 }}>
              <div className="kv"><span>Scale mode</span><span>{fit.scale.mode} ({fit.scale.sx.toFixed(3)}, {fit.scale.sy.toFixed(3)}, {fit.scale.sz.toFixed(3)})</span></div>
              <div className="kv"><span>Fitted size</span><span>{((fit.groundedAABB.max[0] - fit.groundedAABB.min[0]) * fit.scale.sx).toFixed(1)} × {((fit.groundedAABB.max[2] - fit.groundedAABB.min[2]) * fit.scale.sz).toFixed(1)} × {(fit.height * fit.scale.sy).toFixed(1)} m</span></div>
              <div className="kv"><span>Anchor</span><span>{s.geo!.lat.toFixed(6)}, {s.geo!.lon.toFixed(6)}</span></div>
            </div>
            <button className="btn primary lg block" style={{ marginTop: 18 }} disabled={!done} onClick={() => s.go('explore')}>
              Walk the site <ArrowRight size={17} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
