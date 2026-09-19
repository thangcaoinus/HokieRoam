import { useRef, useState } from 'react'
import { ArrowRight, Box, Upload } from 'lucide-react'
import * as THREE from 'three'
import { useStore } from '../store'
import { RECON_STEPS, loadMeshFile, reconstruct } from '../lib/reconstruct'
import MeshPreview, { type ShadeMode } from '../components/MeshPreview'
import Progress from '../components/Progress'

export default function ReconstructStage() {
  const s = useStore()
  const [step, setStep] = useState(-1)
  const [mode, setMode] = useState<ShadeMode>('shaded')
  const [err, setErr] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const run = async () => {
    if (!s.concept) return
    setErr('')
    s.log('reconstruct › image-to-3D job started')
    try {
      const mesh = await reconstruct(s.concept, s.presetId, setStep)
      s.set({ mesh, fit: null })
      s.log(`reconstruct › ${mesh.meta.triangles.toLocaleString()} tris · ${mesh.meta.upAxis}-up · ${mesh.meta.units}`, 'ok')
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
              <button className="btn primary" style={{ flex: 1 }} onClick={run} disabled={!s.concept || step >= 0}>
                <Box size={16} /> {s.mesh ? 'Rebuild mesh' : 'Reconstruct mesh'}
              </button>
              <button className="btn" onClick={() => fileRef.current?.click()} title="Upload .glb / .obj">
                <Upload size={16} /> Upload
              </button>
              <input ref={fileRef} type="file" accept=".glb,.gltf,.obj" hidden onChange={(e) => upload(e.target.files?.[0])} />
            </div>
            {err && <div className="err-text" style={{ marginTop: 10 }}>{err}</div>}
          </div>

          {s.mesh && (
            <div className="card card-pad">
              <div className="card-title"><span className="n">B</span> Asset report <span className="right chip mono" style={{ height: 22 }}>{s.mesh.meta.format}</span></div>
              <div className="stats">
                <div className="stat"><div className="v">{(s.mesh.meta.vertices / 1000).toFixed(1)}<small>k</small></div><div className="k">Vertices</div></div>
                <div className="stat"><div className="v">{(s.mesh.meta.triangles / 1000).toFixed(1)}<small>k</small></div><div className="k">Triangles</div></div>
                <div className="stat hl"><div className="v">{s.mesh.meta.upAxis}-up</div><div className="k">Source axis</div></div>
                <div className="stat hl"><div className="v">{s.mesh.meta.units}</div><div className="k">Source units</div></div>
              </div>
              {raw && (
                <div className="formula" style={{ marginTop: 12 }}>
                  raw extent <b>{raw.x.toFixed(0)} × {raw.y.toFixed(0)} × {raw.z.toFixed(0)}</b> {s.mesh.meta.units} — unscaled, off-origin
                </div>
              )}
            </div>
          )}
        </div>

        <div className="stack">
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
              {!s.mesh && step < 0 && (
                <div className="map-empty"><div><div style={{ fontFamily: 'var(--display)', fontSize: 16, color: 'var(--text-2)' }}>No mesh yet</div><div style={{ fontSize: 12.5 }}>Run reconstruction to see it materialise here</div></div></div>
              )}
              {step >= 0 && <Progress title="Reconstructing" steps={RECON_STEPS} current={step} />}
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
