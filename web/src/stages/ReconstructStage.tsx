import { useRef, useState } from 'react'
import { ArrowRight, Box, Upload } from 'lucide-react'
import * as THREE from 'three'
import { useStore } from '../store'
import { RECON_STEPS, loadMeshFile, simulateReconstruct } from '../lib/reconstruct'
import { apiConfigured, isTerminal } from '../lib/api'
import MeshPreview, { type ShadeMode } from '../components/MeshPreview'
import Progress from '../components/Progress'
import JobPanel, { ProgressBar, statusText } from './JobPanel'
import { OriginBanner } from './RedesignStage'

export default function ReconstructStage() {
  const s = useStore()
  const api = apiConfigured()
  const [step, setStep] = useState(-1)
  const [mode, setMode] = useState<ShadeMode>('shaded')
  const [err, setErr] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const job = s.job
  const jobActive = !!job && !isTerminal(job.status)
  // The job has produced a model the store has not finished downloading yet.
  const modelPending = api && !!job?.artifacts.model && s.mesh?.meta.jobId !== job.job_id

  const runSimulation = async () => {
    if (!s.concept) return
    setErr('')
    s.log('reconstruct › [simulation] procedural stand-in, not image-to-3D')
    try {
      const mesh = await simulateReconstruct(s.concept, s.presetId, setStep)
      s.set({ mesh, fit: null })
      s.log(`reconstruct › [simulation] ${mesh.meta.triangles.toLocaleString()} tris · ${mesh.meta.upAxis}-up · ${mesh.meta.units}`, 'ok')
    } catch (e) {
      setErr((e as Error).message)
      s.log(`reconstruct › ${(e as Error).message}`, 'warn')
    } finally {
      setStep(-1)
    }
  }

  const upload = async (f?: File) => {
    if (!f) return
    setErr('')
    try {
      const mesh = await loadMeshFile(f)
      s.set({ mesh, fit: null })
      s.log(`reconstruct › loaded ${f.name} (${mesh.meta.triangles.toLocaleString()} tris, units ${mesh.meta.units})`, 'ok')
    } catch (e) {
      setErr(`Could not read ${f.name}: ${(e as Error).message}`)
    }
  }

  const raw = s.mesh && new THREE.Box3().setFromObject(s.mesh.object).getSize(new THREE.Vector3())
  const meta = s.mesh?.meta
  const origin = !meta ? null
    : meta.simulated ? 'simulation'
    : meta.provider === 'fixture' ? 'fixture'
    : null

  return (
    <div className="stage">
      <div className="eyebrow">Stage 03 · 3D mesh generation</div>
      <h1 className="h1">From concept to <em>geometry</em>.</h1>
      <p className="lede">The restyled concept is lifted into a textured mesh through automated image-to-3D reconstruction. You can also bring your own <span className="mono">.glb</span> or <span className="mono">.obj</span>.</p>

      <div className="grid-2">
        <div className="stack">
          <div className="card card-pad">
            <div className="card-title"><span className="n">A</span> Input concept</div>
            {s.concept ? (
              <img src={s.concept} alt="" style={{ width: '100%', borderRadius: 10, display: 'block', aspectRatio: '3/2', objectFit: 'cover' }} />
            ) : (
              <div className="dimmer" style={{ fontSize: 13 }}>No concept yet. Generate one in Redesign, or upload a mesh below.</div>
            )}
            <div className="row" style={{ marginTop: 14 }}>
              {api ? (
                // With the API, the pipeline job builds the mesh from its own concept — there is no
                // separate "reconstruct" click that could start (and pay for) a second job.
                <div className="dimmer" style={{ flex: 1, fontSize: 12.5 }}>
                  {!job ? 'Start a job in Redesign; it builds the mesh from its concept automatically.'
                    : jobActive ? 'The server builds the mesh from this concept — progress below.'
                    : job.artifacts.model ? 'Mesh delivered by the pipeline job.'
                    : 'This job ended without a mesh — see the job panel.'}
                </div>
              ) : (
                <button className="btn primary" style={{ flex: 1 }} onClick={runSimulation} disabled={!s.concept || step >= 0}>
                  <Box size={16} /> {s.mesh ? 'Rebuild (simulated)' : 'Build mesh (simulated)'}
                </button>
              )}
              <button className="btn" onClick={() => fileRef.current?.click()} title="Upload .glb / .obj">
                <Upload size={16} /> Upload
              </button>
              <input ref={fileRef} type="file" accept=".glb,.gltf,.obj" hidden onChange={(e) => upload(e.target.files?.[0])} />
            </div>
            {err && <div className="err-text" style={{ marginTop: 10 }}>{err}</div>}
          </div>

          {api && <JobPanel focus="reconstruct" />}

          {s.mesh && meta && (
            <div className="card card-pad">
              <div className="card-title"><span className="n">B</span> Asset report <span className="right chip mono" style={{ height: 22 }}>{meta.format}</span></div>
              <div className="kv" style={{ marginBottom: 12 }}><span>Source</span><span title={meta.source}>{meta.source}</span></div>
              <div className="stats">
                <div className="stat"><div className="v">{(meta.vertices / 1000).toFixed(1)}<small>k</small></div><div className="k">Vertices</div></div>
                <div className="stat"><div className="v">{(meta.triangles / 1000).toFixed(1)}<small>k</small></div><div className="k">Triangles</div></div>
                <div className="stat hl"><div className="v">{meta.upAxis}-up</div><div className="k">Source axis</div></div>
                <div className="stat hl"><div className="v">{meta.units}</div><div className="k">Source units{meta.simulated ? '' : ' (inferred)'}</div></div>
              </div>
              {raw && (
                <div className="formula" style={{ marginTop: 12 }}>
                  raw extent <b>{raw.x.toFixed(meta.units === 'm' ? 2 : 0)} × {raw.y.toFixed(meta.units === 'm' ? 2 : 0)} × {raw.z.toFixed(meta.units === 'm' ? 2 : 0)}</b> {meta.units} — as delivered, before fitting
                </div>
              )}
            </div>
          )}
        </div>

        <div className="stack">
          <div>
            {origin && <OriginBanner kind={origin} />}
            <div className="card" style={{ padding: 6 }}>
              <div className="viewer">
                <MeshPreview asset={s.mesh} mode={mode} />
                <div className="viewer-hud">
                  <div className="seg">
                    {(['shaded', 'clay', 'wire'] as ShadeMode[]).map((m) => (
                      <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>{m}</button>
                    ))}
                  </div>
                  <span style={{ flex: 1 }} />
                  <span className="chip" style={{ background: 'rgba(8,8,10,.7)' }}>Preview · auto-oriented</span>
                </div>
                {!s.mesh && step < 0 && !(api && (jobActive || modelPending)) && (
                  <div className="map-empty"><div><div style={{ fontFamily: 'var(--display)', fontSize: 16, color: 'var(--text-2)' }}>No mesh yet</div><div style={{ fontSize: 12.5 }}>{api ? 'The pipeline job delivers it here when reconstruction finishes' : 'Run the simulated build, or upload a mesh'}</div></div></div>
                )}
                {!api && step >= 0 && <Progress title="Simulating" steps={RECON_STEPS} current={step} />}
                {api && (jobActive || modelPending) && !s.mesh && (
                  <div className="progress-overlay">
                    <div className="progress-box">
                      <div className="eyebrow">{job!.provider} · {modelPending ? 'download' : job!.stage}</div>
                      <div style={{ font: '600 16px var(--display)', margin: '10px 0 2px' }}>
                        {modelPending ? 'Loading the GLB from the server' : job!.stage === 'redesign' ? 'Waiting for the concept first' : 'Reconstructing the mesh'}
                      </div>
                      <div className="mono dimmer" style={{ fontSize: 12 }}>{modelPending ? 'model artifact ready' : statusText(job!)}</div>
                      <ProgressBar job={job!} />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="next-bar" style={{ marginTop: 0 }}>
            <button className="btn primary lg" disabled={!s.mesh} onClick={() => s.go('fit')}>
              Fit to footprint <ArrowRight size={17} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
