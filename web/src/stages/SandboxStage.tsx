import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { Grid, OrbitControls, TransformControls } from '@react-three/drei'
import * as THREE from 'three'
import { PlacedAsset } from '../components/PlacedScene'
import { loadMeshFile } from '../lib/reconstruct'
import { prepareSandboxModel, sandboxWalkModels, useSandbox, type SandboxModel, type WalkModel } from '../lib/sandbox'
import { useStore } from '../store'
import { WalkStage } from './ExploreStage'

function sceneBounds(models: SandboxModel[]) {
  const box = new THREE.Box3()
  for (const m of models) {
    const r = Math.hypot(m.size[0], m.size[2]) * m.scale / 2
    box.expandByPoint(new THREE.Vector3(m.x - r, 0, m.z - r))
    box.expandByPoint(new THREE.Vector3(m.x + r, m.size[1] * m.scale, m.z + r))
  }
  if (box.isEmpty()) box.set(new THREE.Vector3(-10, 0, -10), new THREE.Vector3(10, 10, 10))
  return box
}

function FrameScene({ version }: { version: number }) {
  const { camera, controls } = useThree()
  useEffect(() => {
    const box = sceneBounds(useSandbox.getState().models)
    const center = box.getCenter(new THREE.Vector3())
    const radius = Math.max(box.getSize(new THREE.Vector3()).length(), 8)
    camera.position.copy(center).add(new THREE.Vector3(0.65, 0.5, 0.85).multiplyScalar(radius))
    camera.far = Math.max(2000, radius * 10)
    camera.updateProjectionMatrix()
    const orbit = controls as unknown as { target: THREE.Vector3; update: () => void } | null
    orbit?.target.copy(center)
    orbit?.update()
    camera.lookAt(center)
  }, [camera, controls, version])
  return null
}

function Model({ model, selected, editing }: { model: SandboxModel; selected: boolean; editing: boolean }) {
  const group = useRef<THREE.Group>(null!)
  const content = <group ref={group} position={[model.x, 0, model.z]} rotation={[0, model.yaw, 0]} scale={model.scale}
    onClick={e => { if (editing) { e.stopPropagation(); useSandbox.setState({ selected: model.id }) } }}>
    <PlacedAsset asset={model.asset} matrix={model.matrix} />
    {selected && editing && <mesh position-y={0.025} rotation-x={-Math.PI / 2}>
      <ringGeometry args={[Math.max(model.size[0], model.size[2]) * 0.55, Math.max(model.size[0], model.size[2]) * 0.55 + 0.1, 64]} />
      <meshBasicMaterial color="#ff9b50" side={THREE.DoubleSide} />
    </mesh>}
  </group>
  return <>{content}{selected && editing && <TransformControls object={group} mode="translate" showY={false} size={0.85}
    onMouseUp={() => {
      if (group.current) useSandbox.getState().update(model.id, { x: group.current.position.x, z: group.current.position.z })
    }} onObjectChange={() => {
      if (!group.current) return
      // Keep the transform live on the object; commit to scene state when the drag ends.
      group.current.position.y = 0
    }} />}</>
}

export default function SandboxStage() {
  const { models, selected, add, update, remove } = useSandbox()
  const current = useStore(s => s.mesh)
  const [walk, setWalk] = useState(false)
  const [walkModels, setWalkModels] = useState<WalkModel[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [frame, setFrame] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const importing = useRef(false)
  const active = models.find(m => m.id === selected)
  const groundSize = useMemo(() => Math.max(1000, sceneBounds(models).getSize(new THREE.Vector3()).length() * 8), [models])
  const toggleWalk = () => {
    if (document.pointerLockElement) document.exitPointerLock()
    if (walk) { setWalk(false); setFrame(n => n + 1); return }
    try { setWalkModels(sandboxWalkModels(models)); setWalk(true) }
    catch (e) { setError(`Unable to prepare walkthrough: ${e instanceof Error ? e.message : String(e)}`) }
  }
  const importFiles = async (files: File[]) => {
    if (importing.current) return
    importing.current = true; setBusy(true); setError('')
    const failures: string[] = []
    for (const file of files) {
      try {
        if (!/\.(glb|obj)$/i.test(file.name)) throw new Error('Use a GLB or OBJ file (GLB includes textures).')
        add(prepareSandboxModel(await loadMeshFile(file)))
      } catch (e) { failures.push(`${file.name}: ${e instanceof Error ? e.message : 'Import failed'}`) }
    }
    setError(failures.join('\n')); importing.current = false; setBusy(false); setFrame(n => n + 1)
  }
  return <div className="sandbox" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (!walk) void importFiles(Array.from(e.dataTransfer.files)) }}>
    <div className="sandbox-toolbar glass">
      <div><strong>Sandbox</strong><div className="dimmer">{models.length} models · local scene</div></div>
      <button className="btn sm" disabled={busy || walk} onClick={() => input.current?.click()}>{busy ? 'Importing…' : 'Import models'}</button>
      <input ref={input} aria-label="Sandbox models" type="file" accept=".glb,.obj" multiple hidden onChange={e => { void importFiles(Array.from(e.target.files ?? [])); e.target.value = '' }} />
      {current && <button className="btn sm" disabled={walk || busy} onClick={() => { try { add(prepareSandboxModel(current)); setFrame(n => n + 1) } catch (e) { setError(String(e)) } }}>Add current model</button>}
      <button className="btn sm" disabled={!models.length || busy} onClick={toggleWalk}>{walk ? 'Edit scene' : 'Walk scene'}</button>
      <button className="btn sm" disabled={walk} onClick={() => setFrame(n => n + 1)}>Frame all</button>
      <button className="btn sm" disabled={walk || busy || !models.length} onClick={() => {
        try {
          const resized = models.map(m => ({ ...prepareSandboxModel(m.asset), id: m.id, x: m.x, z: m.z, yaw: m.yaw }))
          useSandbox.setState({ models: resized }); setFrame(n => n + 1)
        } catch (e) { setError(String(e)) }
      }}>Recalculate building sizes</button>
    </div>
    <div className="sandbox-body">
      <div className="sandbox-viewport">
        {walk ? <WalkStage sandbox={walkModels} onExit={toggleWalk} /> : <Canvas frameloop="demand" camera={{ position: [25, 20, 30], fov: 50, far: 10000 }} dpr={[1, 1.5]}>
          <color attach="background" args={['#161a20']} />
          <hemisphereLight args={['#fff5e6', '#657080', 2]} />
          <directionalLight position={[30, 60, 40]} intensity={2} />
          <mesh rotation-x={-Math.PI / 2} position-y={-0.025}><planeGeometry args={[groundSize, groundSize]} /><meshStandardMaterial color="#262d32" /></mesh>
          <Grid infiniteGrid fadeDistance={300} sectionSize={10} cellSize={1} cellColor="#465059" sectionColor="#7c858e" position-y={0.005} />
          {models.map(model => <Model key={model.id} model={model} selected={model.id === selected} editing={!walk} />)}
          <OrbitControls makeDefault maxPolarAngle={Math.PI / 2 - 0.02} /><FrameScene version={frame} />
        </Canvas>}
        {!models.length && <div className="sandbox-empty glass"><h2>Build a scene together</h2><p>Drop multiple GLB or OBJ files here, or choose Import models.</p><p>Each model can be moved, rotated, and resized independently.</p></div>}
        {!walk && <div className="sandbox-help glass">Select a model, then drag its arrows or square to move · Drag background to orbit · Scroll to zoom</div>}
      </div>
      {!walk && <aside className="sandbox-panel glass">
        <strong>Scene models</strong>
        <p className="dimmer">GLB with textures or geometry-only OBJ. Uses fitted building scale when available; tiny imports get an estimated building height. Kept while switching views; refresh clears this scene.</p>
        <div className="sandbox-list">{models.map(m => <button key={m.id} className={`btn sm ${m.id === selected ? 'primary' : ''}`} onClick={() => useSandbox.setState({ selected: m.id })}>{m.asset.meta.source}</button>)}</div>
        {active && <div className="stack" style={{ marginTop: 18 }}>
          <p className="dimmer" data-testid="sandbox-scale-source">{active.scaleSource}<br />{(active.size[0] * active.scale).toFixed(1)} × {(active.size[1] * active.scale).toFixed(1)} × {(active.size[2] * active.scale).toFixed(1)} m</p>
          {([
            ['X (m)', active.x, (v: number) => update(active.id, { x: v })],
            ['Z (m)', active.z, (v: number) => update(active.id, { z: v })],
            ['Rotation (°)', active.yaw * 180 / Math.PI, (v: number) => update(active.id, { yaw: v * Math.PI / 180 })],
            ['Height (m)', active.size[1] * active.scale, (v: number) => { if (v > 0 && active.size[1] > 0) update(active.id, { scale: v / active.size[1], scaleSource: 'User-declared height' }) }],
          ] as [string, number, (v: number) => void][]).map(([label, value, change]) => <label key={label} className="label">{label}<input className="input" aria-label={label} type="number" step="0.1" value={Number(value.toFixed(3))} onChange={e => { if (e.target.value !== '' && Number.isFinite(e.target.valueAsNumber)) change(e.target.valueAsNumber) }} /></label>)}
          <button className="btn sm" onClick={() => remove(active.id)}>Remove selected model</button>
        </div>}
      </aside>}
    </div>
    {error && <div role="alert" className="sandbox-error glass">{error}<button className="btn sm" onClick={() => setError('')}>Dismiss</button></div>}
  </div>
}
