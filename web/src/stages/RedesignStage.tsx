import { useState } from 'react'
import { AlertTriangle, ArrowRight, Wand2 } from 'lucide-react'
import { useStore } from '../store'
import { PRESETS } from '../lib/presets'
import { REDESIGN_STEPS, simulateRedesign } from '../lib/redesign'
import { apiConfigured, isTerminal } from '../lib/api'
import { startJob } from '../lib/pipelineJob'
import Compare from '../components/Compare'
import Progress from '../components/Progress'
import JobPanel, { ProgressBar, statusText } from './JobPanel'

/** Says what produced the concept on screen, so nothing synthetic reads as AI output. */
export function OriginBanner({ kind }: { kind: 'simulation' | 'fixture' }) {
  return (
    <div className="flag warn" style={{ marginBottom: 10 }}>
      <AlertTriangle size={16} />
      <span>
        {kind === 'simulation'
          ? <><b>Local simulation.</b> A canvas colour restyle stands in for the image model — not AI generation. Set VITE_API_BASE to run the real pipeline.</>
          : <><b>Fixture placeholder.</b> The server is running the synthetic fixture provider — this output is not AI generation.</>}
      </span>
    </div>
  )
}

export default function RedesignStage() {
  const s = useStore()
  const api = apiConfigured()
  const [step, setStep] = useState(-1)
  const [err, setErr] = useState('')
  const [posting, setPosting] = useState(false)
  const preset = PRESETS.find((p) => p.id === s.presetId)!
  const source = s.photos[s.primaryPhoto]
  const job = s.job
  const jobActive = !!job && !isTerminal(job.status)
  const unknown = job?.status === 'submission-unknown'

  const runSimulation = async () => {
    setErr('')
    s.log(`redesign › [simulation] "${preset.name}" · strength ${s.strength.toFixed(2)}`)
    try {
      const out = await simulateRedesign(source, preset, s.strength, setStep)
      s.set({ concept: out, mesh: null, fit: null })
      s.log('redesign › [simulation] concept generated', 'ok')
    } catch (e) {
      setErr((e as Error).message)
      s.log(`redesign › ${(e as Error).message}`, 'warn')
    } finally {
      setStep(-1)
    }
  }

  const runJob = async () => {
    setPosting(true)
    try {
      await startJob({ regenerate: !!job })
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setPosting(false)
    }
  }

  const busy = api ? posting || jobActive : step >= 0
  const label = api
    ? jobActive ? `Job ${statusText(job!)}` : job ? 'Regenerate concept' : 'Generate concept'
    : s.concept ? 'Regenerate concept' : 'Generate concept'

  return (
    <div className="stage">
      <div className="eyebrow">Stage 02 · Generative redesign</div>
      <h1 className="h1">Reimagine it. <em>Keep the bones.</em></h1>
      <p className="lede">An image-to-image pass restyles materials and surfaces while holding the original architectural geometry, so the concept still maps onto the real footprint.</p>

      <div className="grid-2">
        <div className="stack">
          <div className="card card-pad">
            <div className="card-title"><span className="n">A</span> Aesthetic direction</div>
            <div className="presets">
              {PRESETS.map((p) => (
                <button key={p.id} className={`preset ${p.id === s.presetId ? 'on' : ''}`} disabled={busy} onClick={() => s.set({ presetId: p.id, prompt: p.prompt })}>
                  <div className="sw" style={{ background: `linear-gradient(120deg, ${p.swatch[0]}, ${p.swatch[1]} 60%, ${p.swatch[2]})` }} />
                  <span className="track">{p.track}</span>
                  <b>{p.name}</b>
                  <span>{p.tagline}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="card card-pad stack">
            <div>
              <div className="label"><span>Prompt</span><span>{s.prompt.length} chars</span></div>
              <textarea className="textarea" value={s.prompt} disabled={busy} onChange={(e) => s.set({ prompt: e.target.value })} />
            </div>
            <div>
              <div className="label"><span>Restyle strength</span><span className="mono">{s.strength.toFixed(2)}</span></div>
              <input className="slider" type="range" min={0.2} max={1} step={0.01} value={s.strength} disabled={busy} onChange={(e) => s.set({ strength: +e.target.value })} />
              <div className="row dimmer" style={{ justifyContent: 'space-between', fontSize: 11 }}><span>Faithful geometry</span><span>Bold restyle</span></div>
            </div>
            {unknown ? (
              // Deliberately no button: a submission-unknown job may already be billed.
              <div className="dimmer" style={{ fontSize: 12.5 }}>Generation is paused until this job is reconciled — see the job panel. Use <b>New</b> in the header to start a separate project.</div>
            ) : (
              <button className="btn primary lg block" onClick={api ? runJob : runSimulation} disabled={busy || !source}>
                <Wand2 size={17} /> {label}
              </button>
            )}
            {api && !job && (
              <div className="dimmer" style={{ fontSize: 12 }}>
                Starts one pipeline job on the server: redesign, then image-to-3D from the concept. Same photo, prompt and strength re-attach to the existing job instead of paying twice.
              </div>
            )}
            {err && <div className="err-text">{err}</div>}
          </div>

          {api && <JobPanel focus="redesign" />}
        </div>

        <div className="stack">
          <div>
            {s.concept && !api && <OriginBanner kind="simulation" />}
            {s.concept && api && job?.provider === 'fixture' && <OriginBanner kind="fixture" />}
            <div className="card" style={{ padding: 6, position: 'relative' }}>
              {source && <Compare before={source} after={s.concept} />}
              {!api && step >= 0 && <Progress title="Simulating" steps={REDESIGN_STEPS} current={step} />}
              {api && jobActive && !s.concept && (
                <div className="progress-overlay">
                  <div className="progress-box">
                    <div className="eyebrow">{job!.provider} · {job!.stage}</div>
                    <div style={{ font: '600 16px var(--display)', margin: '10px 0 2px' }}>Waiting for the concept image</div>
                    <div className="mono dimmer" style={{ fontSize: 12 }}>{statusText(job!)}</div>
                    <ProgressBar job={job!} />
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="next-bar" style={{ marginTop: 0 }}>
            {api && jobActive && s.concept && <span className="dimmer" style={{ fontSize: 12.5, alignSelf: 'center' }}>The server is already building the mesh from this concept.</span>}
            <button className="btn primary lg" disabled={!s.concept} onClick={() => s.go('reconstruct')}>
              {api ? 'Follow the 3D build' : 'Build 3D mesh'} <ArrowRight size={17} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
