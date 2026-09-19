import { AnimatePresence, motion } from 'framer-motion'
import { Check, RotateCcw, Terminal } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { STAGES, completed, unlocked, useStore, type StageId } from './store'
import IngestStage from './stages/IngestStage'
import RedesignStage from './stages/RedesignStage'
import ReconstructStage from './stages/ReconstructStage'
import FitStage from './stages/FitStage'
import ExploreStage from './stages/ExploreStage'

const LIVE = !!import.meta.env.VITE_API_BASE

const VIEWS: Record<StageId, () => JSX.Element> = {
  ingest: IngestStage,
  redesign: RedesignStage,
  reconstruct: ReconstructStage,
  fit: FitStage,
  explore: ExploreStage,
}

export default function App() {
  const s = useStore()
  const View = VIEWS[s.stage]
  const open = unlocked(s)
  const done = completed(s)

  return (
    <>
      <div className="backdrop"><div className="gridlines" /></div>
      <div className="shell">
        <header className="topbar">
          <div className="brand">
            <div className="brand-mark">
              <svg width="14" height="14" viewBox="0 0 14 14"><path d="M1 12 7 1.5 13 12Z" fill="#120703" /><path d="M4.4 12 7 7.4 9.6 12Z" fill="#ffb35c" /></svg>
            </div>
            <div>GROUNDTRUTH<small>photo → map-ready 3D</small></div>
          </div>
          <div className="spacer" />
          {s.geo && (
            <span className="chip mono" title={s.geo.displayName}>
              {s.geo.lat.toFixed(5)}°, {s.geo.lon.toFixed(5)}°
            </span>
          )}
          {s.geo && <span className="chip mono">bucket · {s.geo.bucket}</span>}
          <span className="chip" title={LIVE ? import.meta.env.VITE_API_BASE : 'Set VITE_API_BASE to use the real pipeline'}>
            <span className={`dot ${LIVE ? 'live' : 'mock'}`} />
            {LIVE ? 'Pipeline API connected' : 'Local AI simulation'}
          </span>
          <button className="btn sm ghost" onClick={s.reset} title="Start a new project">
            <RotateCcw size={14} /> New
          </button>
        </header>

        <aside className="rail">
          <div className="rail-head">Pipeline</div>
          <ol className="steps">
            <div className="spine" />
            {STAGES.map((st, i) => (
              <li key={st.id}>
                <button
                  className={`step ${s.stage === st.id ? 'active' : ''} ${done[st.id] ? 'done' : ''}`}
                  disabled={!open[st.id]}
                  onClick={() => s.go(st.id)}
                >
                  <span className="step-node">{done[st.id] && s.stage !== st.id ? <Check size={15} /> : `0${i + 1}`}</span>
                  <span>
                    <div className="step-title">{st.title}</div>
                    <div className="step-sub">{st.sub}</div>
                  </span>
                </button>
              </li>
            ))}
          </ol>
          {(s.geo || s.mesh || s.fit) && (
            <div className="rail-summary">
              {s.geo && <div className="kv"><span>Footprint</span><span>{s.geo.areaM2.toFixed(0)} m² · {s.geo.source === 'osm' ? s.geo.osmId : 'demo'}</span></div>}
              {s.mesh && <div className="kv"><span>Mesh</span><span>{(s.mesh.meta.triangles / 1000).toFixed(1)}k tris</span></div>}
              {s.fit && <div className="kv"><span>IoU</span><span>{(s.fit.iou * 100).toFixed(1)}%</span></div>}
              {s.fit && <div className="kv"><span>Yaw</span><span>{s.fit.yawDeg.toFixed(2)}°</span></div>}
            </div>
          )}
          <Console />
        </aside>

        <main className={`main ${s.stage === 'explore' ? 'fullbleed' : ''}`}>
          <AnimatePresence mode="wait">
            <motion.div
              key={s.stage}
              initial={{ opacity: 0, y: 14, filter: 'blur(6px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -10, filter: 'blur(6px)' }}
              transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
              style={s.stage === 'explore' ? { position: 'absolute', inset: 0 } : undefined}
            >
              <View />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </>
  )
}

function Console() {
  const logs = useStore((s) => s.logs)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' }) }, [logs])
  return (
    <div className="console">
      <div className="console-head"><Terminal size={12} /> Event log</div>
      <div className="console-body" ref={ref}>
        {logs.map((l, i) => (
          <div key={i} className={l.level}>
            <time>{new Date(l.t).toLocaleTimeString([], { hour12: false })}</time>
            {l.msg}
          </div>
        ))}
      </div>
    </div>
  )
}
