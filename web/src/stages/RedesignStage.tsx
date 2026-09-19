import { useState } from 'react'
import { ArrowRight, Wand2 } from 'lucide-react'
import { useStore } from '../store'
import { PRESETS } from '../lib/presets'
import { REDESIGN_STEPS, redesign } from '../lib/redesign'
import Compare from '../components/Compare'
import Progress from '../components/Progress'

export default function RedesignStage() {
  const s = useStore()
  const [step, setStep] = useState(-1)
  const [err, setErr] = useState('')
  const preset = PRESETS.find((p) => p.id === s.presetId)!
  const source = s.photos[s.primaryPhoto]

  const run = async () => {
    setErr('')
    s.log(`redesign › "${preset.name}" · strength ${s.strength.toFixed(2)}`)
    try {
      const out = await redesign(source, preset, s.prompt, s.strength, setStep)
      s.set({ concept: out, mesh: null, fit: null })
      s.log('redesign › concept generated', 'ok')
    } catch (e) {
      setErr((e as Error).message)
      s.log(`redesign › ${(e as Error).message}`, 'warn')
    } finally {
      setStep(-1)
    }
  }

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
                <button key={p.id} className={`preset ${p.id === s.presetId ? 'on' : ''}`} onClick={() => s.set({ presetId: p.id, prompt: p.prompt })}>
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
              <textarea className="textarea" value={s.prompt} onChange={(e) => s.set({ prompt: e.target.value })} />
            </div>
            <div>
              <div className="label"><span>Restyle strength</span><span className="mono">{s.strength.toFixed(2)}</span></div>
              <input className="slider" type="range" min={0.2} max={1} step={0.01} value={s.strength} onChange={(e) => s.set({ strength: +e.target.value })} />
              <div className="row dimmer" style={{ justifyContent: 'space-between', fontSize: 11 }}><span>Faithful geometry</span><span>Bold restyle</span></div>
            </div>
            <button className="btn primary lg block" onClick={run} disabled={step >= 0 || !source}>
              <Wand2 size={17} /> {s.concept ? 'Regenerate concept' : 'Generate concept'}
            </button>
            {err && <div className="err-text">{err}</div>}
          </div>
        </div>

        <div className="stack">
          <div className="card" style={{ padding: 6, position: 'relative' }}>
            {source && <Compare before={source} after={s.concept} />}
            {step >= 0 && <Progress title="Diffusing" steps={REDESIGN_STEPS} current={step} />}
          </div>
          <div className="next-bar" style={{ marginTop: 0 }}>
            <button className="btn primary lg" disabled={!s.concept} onClick={() => s.go('reconstruct')}>
              Build 3D mesh <ArrowRight size={17} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
