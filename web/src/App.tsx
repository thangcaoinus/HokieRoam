import { AnimatePresence, motion } from 'framer-motion'
import { Boxes, Check, RotateCcw, Terminal } from 'lucide-react'
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

  // Sandbox is an aside, not one of the numbered sheets, so findIndex returns -1 there and
  // the header names it instead of indexing STAGES out of bounds.
  const sheetIndex = STAGES.findIndex((st) => st.id === s.stage)
  const sheet = STAGES[sheetIndex]

  return (
    <>
      <div className="shell">
        <header className="topbar">
          <div className="brand">
            <div className="brand-mark">
              {/* HokieBird head in profile. Drawn as a filled silhouette rather than the outline
                  the old house mark used, because a 1.3px stroke closes up and turns to mush at
                  13px; solid masses survive. Three shapes only — skull, beak, punched eye — and
                  the eye is punched in the tile colour so the mark stays a single flat cut. */}
              <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="6.8" cy="8" r="4.5" fill="#fff" />
                {/* The beak's base corners sit well inside the skull (x=8.6 against a circle
                    spanning y 3.9-12.1 there), so the two shapes union without a seam. An
                    earlier version started the wedge at x=10.1 and its lower corner fell
                    outside the arc, which showed as a nick in the silhouette. */}
                <path d="M8.6 6.2 15.2 8.6 8.6 9.8z" fill="#fff" />
                <circle cx="5.2" cy="6.4" r="1.2" fill="var(--vermilion)" />
              </svg>
            </div>
            <div>HOKIEROAM</div>
            <small>{sheet ? `Sheet ${sheetIndex + 1} of ${STAGES.length} · ${sheet.title}` : 'Sandbox · local scene'}</small>
          </div>
          <div className="spacer" />
          {s.geo && (
            <span className="chip chip-aux mono" title={s.geo.displayName}>
              {/* A derived site has no coordinates. Printing 0.00000°, 0.00000° would assert
                  Null Island as a location rather than admit there is none. */}
              {s.geo.source === 'derived' ? 'local frame · no anchor' : `${s.geo.lat.toFixed(5)}°, ${s.geo.lon.toFixed(5)}°`}
            </span>
          )}
          {s.geo && <span className="chip chip-aux mono">bucket · {s.geo.bucket}</span>}
          {s.bundle ? <span className="chip">Imported bundle · {s.mesh?.meta.provider}{s.mesh?.meta.provider === 'fixture' ? ' (synthetic)' : ''}</span> : s.example ? <span className="chip">Cached real example · Meshy</span> : <ApiChip api={s.api} />}
          <button className="btn sm ghost" onClick={s.reset} title="Start a new project">
            <RotateCcw size={14} /> New
          </button>
        </header>

        <aside className="rail">
          <div className="rail-head">Sheet index</div>
          <ol className="steps">
            {STAGES.map((st, i) => (
              <li key={st.id}>
                <button
                  className={`step ${s.stage === st.id ? 'active' : ''} ${done[st.id] ? 'done' : ''}`}
                  disabled={!open[st.id]}
                  onClick={() => s.go(st.id)}
                >
                  <span className={`step-node ${done[st.id] && s.stage !== st.id ? 'step-node-icon' : ''}`}>
                    {done[st.id] && s.stage !== st.id ? <Check size={14} /> : i + 1}
                  </span>
                  <span>
                    <div className="step-title">{st.title}</div>
                    <div className="step-sub">{st.sub}</div>
                  </span>
                </button>
              </li>
            ))}
          </ol>
          {/* An aside, not sheet 6: same ruled row as the index, but a glyph where the others
              carry a number, and banded off by the heavier region rule. */}
          <button
            className={`step step-aside ${s.stage === 'sandbox' ? 'active' : ''}`}
            onClick={() => s.go('sandbox')}
          >
            <span className="step-node step-node-icon"><Boxes size={14} /></span>
            <span>
              <div className="step-title">Sandbox</div>
              <div className="step-sub">Multiple models · local scene</div>
            </span>
          </button>
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
            {/* Operate mode: a sheet change, not a page-load sequence. 180 ms, no blur. */}
            <motion.div
              key={s.stage}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
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
  const color = { live: 'var(--ok)', warn: 'var(--warn)', err: 'var(--err)', idle: 'var(--ink-3)' }[tone]
  return (
    <button className="chip" title={title} disabled={api.state === 'off'} onClick={() => void probeHealth()} style={{ cursor: api.state === 'off' ? 'default' : 'pointer' }}>
      <span className="dot" style={{ background: color }} />
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
