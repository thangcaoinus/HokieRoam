import { AnimatePresence, motion } from 'framer-motion'
import { Check, RotateCcw, Terminal } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { STAGES, completed, unlocked, useStore, type ApiState, type StageId } from './store'
import { probeHealth, resumeSession } from './lib/pipelineJob'
import IngestStage from './stages/IngestStage'
import RedesignStage from './stages/RedesignStage'
import ReconstructStage from './stages/ReconstructStage'
import FitStage from './stages/FitStage'
import ExploreStage from './stages/ExploreStage'
import SandboxStage from './stages/SandboxStage'


const VIEWS: Record<StageId, () => JSX.Element> = {
  sandbox: SandboxStage,
  ingest: IngestStage,
  redesign: RedesignStage,
  reconstruct: ReconstructStage,
  fit: FitStage,
  explore: ExploreStage,
}

export default function App() {
  const s = useStore()
  // Pipeline API mode only: check the server, then re-attach to a saved job (GET only, never POST).
  useEffect(() => { void probeHealth(); void resumeSession() }, [])
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
              {/* A derived site has no coordinates. Printing 0.00000°, 0.00000° would assert
                  Null Island as a location rather than admit there is none. */}
              {s.geo.source === 'derived' ? 'local frame · no anchor' : `${s.geo.lat.toFixed(5)}°, ${s.geo.lon.toFixed(5)}°`}
            </span>
          )}
          {s.geo && <span className="chip mono">bucket · {s.geo.bucket}</span>}
          {s.bundle ? <span className="chip">Imported bundle · {s.mesh?.meta.provider}{s.mesh?.meta.provider === 'fixture' ? ' (synthetic)' : ''}</span> : s.example ? <span className="chip">Cached real example · Meshy</span> : <ApiChip api={s.api} />}
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
          <button className={`btn ${s.stage === 'sandbox' ? 'primary' : ''}`} style={{ margin: '0 18px 18px' }} onClick={() => s.go('sandbox')}>Sandbox · multiple models</button>
          {(s.geo || s.mesh || s.fit || s.placement) && (
            <div className="rail-summary">
              {s.geo && <div className="kv"><span>Footprint</span><span>{s.geo.areaM2.toFixed(0)} m² · {s.geo.source === 'osm' ? s.geo.osmId : s.geo.source === 'derived' ? 'derived from model' : 'demo'}</span></div>}
              {s.mesh && <div className="kv"><span>Mesh</span><span>{(s.mesh.meta.triangles / 1000).toFixed(1)}k tris</span></div>}
              {s.placement && <div className="kv"><span>Placement</span><span>{s.placement.plan_fit}</span></div>}
              {s.placement && <div className="kv"><span>IoU</span><span>{(s.placement.selected.metrics.iou * 100).toFixed(1)}%</span></div>}
              {/* Never for a derived site: its FitResult carries iou = 1 as a structural
                  placeholder because nothing was measured, not as a perfect score. */}
              {s.fit && s.geo?.source !== 'derived' && <div className="kv"><span>IoU</span><span>{(s.fit.iou * 100).toFixed(1)}%</span></div>}
              {s.fit && s.geo?.source !== 'derived' && <div className="kv"><span>Yaw</span><span>{s.fit.yawDeg.toFixed(2)}°</span></div>}
              {s.fit && s.geo?.source === 'derived' && <div className="kv"><span>Site</span><span>derived · not scored</span></div>}
            </div>
          )}
          <Console />
        </aside>

        <main className={`main ${s.stage === 'explore' || s.stage === 'sandbox' ? 'fullbleed' : ''}`}>
          <AnimatePresence mode="wait">
            <motion.div
              key={s.stage}
              initial={{ opacity: 0, y: 14, filter: 'blur(6px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -10, filter: 'blur(6px)' }}
              transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
              style={s.stage === 'explore' || s.stage === 'sandbox' ? { position: 'absolute', inset: 0 } : undefined}
            >
              <View />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </>
  )
}

/**
 * The honesty signal. "Connected" is only claimed after /v1/health answers, and a fixture server is
 * named as synthetic — neither may read as AI generation. Simulation mode says so plainly.
 */
function ApiChip({ api }: { api: ApiState }) {
  const base = import.meta.env.VITE_API_BASE
  let tone: 'live' | 'warn' | 'err' | 'idle', text: string, title = base ?? ''
  if (api.state === 'off') { tone = 'warn'; text = 'Local AI simulation'; title = 'Set VITE_API_BASE to use the real pipeline' }
  else if (api.state === 'checking') { tone = 'idle'; text = 'Pipeline API · checking…' }
  else if (api.state === 'down') { tone = 'err'; text = 'Pipeline API unreachable'; title = `No answer from ${base}/v1/health` }
  else if (api.live) { tone = 'live'; text = `Pipeline API connected · ${api.provider}` }
  else { tone = 'warn'; text = `Pipeline API connected · ${api.provider} (synthetic)`; title = `${base} — the ${api.provider} provider returns placeholders, not AI generation` }
  const color = { live: 'var(--ok)', warn: 'var(--warn)', err: 'var(--err)', idle: 'var(--text-3)' }[tone]
  return (
    <button className="chip" title={title} disabled={api.state === 'off'} onClick={() => void probeHealth()} style={{ cursor: api.state === 'off' ? 'default' : 'pointer' }}>
      <span className={`dot ${tone === 'live' ? 'live' : ''}`} style={{ background: color, boxShadow: tone === 'idle' ? 'none' : `0 0 10px ${color}` }} />
      {text}
    </button>
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
