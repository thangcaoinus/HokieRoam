import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Line, Sky, Sparkles } from '@react-three/drei'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { ArrowLeft, MousePointer2, ShieldAlert } from 'lucide-react'
import { useStore } from '../store'
import { pointInPolygon, unproject, type V2, type GeoResult } from '../lib/geo'
import type { WalkModel } from '../lib/sandbox'
import { derivedScene, placementScene, type ScenePlacement } from '../lib/placement'
import DerivedScene from '../components/DerivedScene'
import ExamplePicker from '../components/ExamplePicker'
import { PlacedAsset } from '../components/PlacedScene'
import PlacedScene from '../components/PlacedScene'
import type { MeshAsset } from '../lib/reconstruct'

const RADIUS = 0.45

/**
 * The walkable avatar: a real Meshy `multi-image-to-3d` generation from four HokieBird photos
 * (`samples/hokiebird-npc/`, reduced for the browser by `scripts/prepare-npc.mjs`).
 *
 * Two facts about the asset that this code depends on, both measured rather than assumed:
 *  - it is **Y-up and faces +Z**, which is exactly the convention `st.heading` drives
 *    (`body.rotation.y = atan2(dx, dz)`), so no yaw correction is applied here. Verified from the
 *    mesh: the head and beak lean +0.49 toward +Z against the torso, and the beak is the mesh's
 *    maximum z.
 *  - like every image-to-3D output it is **unit-normalised**, not metric (raw 1.71 x 1.90 x 1.12),
 *    so its height is declared here rather than trusted from the file.
 */
const AVATAR_URL = `${import.meta.env.BASE_URL}npc/hokiebird.glb`
const AVATAR_HEIGHT_M = 1.9

/**
 * Loads and normalises the avatar: centred in plan, base on y = 0, scaled to AVATAR_HEIGHT_M.
 * Returns null until it is ready, and stays null if it fails — the caller keeps drawing the
 * capsule in that case, so a missing or corrupt asset costs the demo its mascot, never its
 * ability to walk around the building.
 */
function useAvatar() {
  const [model, setModel] = useState<THREE.Group | null>(null)
  useEffect(() => {
    let alive = true
    new GLTFLoader().load(AVATAR_URL, (gltf) => {
      if (!alive) return
      const object = gltf.scene
      object.traverse((c) => {
        const m = c as THREE.Mesh
        if (m.isMesh) { m.castShadow = true; m.receiveShadow = false }
      })
      const box = new THREE.Box3().setFromObject(object)
      const size = box.getSize(new THREE.Vector3())
      const centre = box.getCenter(new THREE.Vector3())
      // Translate in model units first, then scale the wrapper: scaling about the origin after
      // grounding keeps the base on y = 0 (0 * s = 0) and the plan centre on the origin.
      object.position.set(-centre.x, -box.min.y, -centre.z)
      const group = new THREE.Group()
      group.add(object)
      group.scale.setScalar(AVATAR_HEIGHT_M / (size.y || 1))
      setModel(group)
    }, undefined, () => { /* keep the capsule fallback */ })
    return () => { alive = false }
  }, [])
  return model
}
const WALK = 5.5
const SPRINT = 11

type Keys = Record<string, boolean>
export interface PlayerState { pos: THREE.Vector3; heading: number; camYaw: number; camPitch: number; vy: number; speed: number; blocked: string | null }

// ---------- collision ----------
function distToSegment(p: V2, a: V2, b: V2) {
  const dx = b.x - a.x, dz = b.z - a.z
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)))
  return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz))
}
function hits(p: V2, poly: V2[]) {
  if (pointInPolygon(p, poly)) return true
  for (let i = 0; i < poly.length; i++) if (distToSegment(p, poly[i], poly[(i + 1) % poly.length]) < RADIUS) return true
  return false
}

// ---------- scene pieces ----------
const GROUND: Record<string, [string, string]> = {
  scorched: ['#6b4a30', '#3a2616'], campus: ['#4d6b3a', '#2f4424'], overgrown: ['#3f5a2c', '#243418'], noir: ['#1b1a22', '#0c0b10'],
}
function groundTexture(style: string) {
  const [a, b] = GROUND[style] ?? GROUND.scorched
  const c = document.createElement('canvas'); c.width = c.height = 512
  const x = c.getContext('2d')!
  x.fillStyle = a; x.fillRect(0, 0, 512, 512)
  let s = 9
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
  for (let i = 0; i < 5000; i++) { x.fillStyle = r() < 0.5 ? b : 'rgba(255,255,255,0.05)'; x.globalAlpha = r() * 0.35; x.fillRect(r() * 512, r() * 512, 1 + r() * 4, 1 + r() * 4) }
  x.globalAlpha = 0.5; x.strokeStyle = b; x.lineWidth = 1.2
  for (let i = 0; i < 40; i++) {
    let px = r() * 512, py = r() * 512
    x.beginPath(); x.moveTo(px, py)
    for (let k = 0; k < 8; k++) { px += (r() - 0.5) * 60; py += (r() - 0.5) * 60; x.lineTo(px, py) }
    x.stroke()
  }
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(40, 40)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

function Extruded({ poly, h, color }: { poly: V2[]; h: number; color: string }) {
  const geo = useMemo(() => {
    const s = new THREE.Shape()
    poly.forEach((p, i) => (i ? s.lineTo(p.x, -p.z) : s.moveTo(p.x, -p.z)))
    const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false })
    g.rotateX(-Math.PI / 2)
    return g
  }, [poly, h])
  return <mesh geometry={geo} castShadow receiveShadow><meshStandardMaterial color={color} roughness={0.95} /></mesh>
}

const loop = (p: V2[], y: number): [number, number, number][] => [...p, p[0]].map((v) => [v.x, y, v.z])

export function Player({ state, keys, colliders }: { state: React.MutableRefObject<PlayerState>; keys: React.MutableRefObject<Keys>; colliders: { poly: V2[]; name: string }[] }) {
  const body = useRef<THREE.Group>(null)
  const sun = useRef<THREE.DirectionalLight>(null)
  const { camera, scene } = useThree()
  const look = useRef(new THREE.Vector3())
  const bob = useRef(0)
  const avatar = useAvatar()

  useEffect(() => {
    const target = sun.current?.target
    if (target) scene.add(target)
    return () => { if (target) scene.remove(target) }
  }, [scene])

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    const st = state.current
    const k = keys.current
    if (k.q) st.camYaw += dt * 2
    if (k.e) st.camYaw -= dt * 2
    const ix = (k.d ? 1 : 0) - (k.a ? 1 : 0)
    const iz = (k.s ? 1 : 0) - (k.w ? 1 : 0)
    const speed = k.shift ? SPRINT : WALK
    let moving = false
    st.blocked = null
    if (ix || iz) {
      const len = Math.hypot(ix, iz)
      const c = Math.cos(st.camYaw), sn = Math.sin(st.camYaw)
      // camera-relative: forward = (-sin yaw, -cos yaw)
      const dx = ((ix * c + iz * sn) / len) * speed * dt
      const dz = ((-ix * sn + iz * c) / len) * speed * dt
      const tryMove = (x: number, z: number) => {
        const p = { x, z }
        for (const col of colliders) if (hits(p, col.poly)) { st.blocked = col.name; return false }
        return true
      }
      const { x, z } = st.pos
      if (tryMove(x + dx, z + dz)) { st.pos.x += dx; st.pos.z += dz }
      else if (tryMove(x + dx, z)) st.pos.x += dx
      else if (tryMove(x, z + dz)) st.pos.z += dz
      const target = Math.atan2(dx, dz)
      let diff = target - st.heading
      diff = Math.atan2(Math.sin(diff), Math.cos(diff))
      st.heading += diff * Math.min(1, dt * 12)
      moving = true
    }
    // jump + gravity
    if (k[' '] && st.pos.y <= 0.0001) st.vy = 6.2
    st.vy -= 18 * dt
    st.pos.y = Math.max(0, st.pos.y + st.vy * dt)
    if (st.pos.y === 0) st.vy = Math.max(0, st.vy)
    st.speed = moving ? speed : 0

    bob.current += dt * (moving ? speed * 1.6 : 2)
    if (body.current) {
      body.current.position.set(st.pos.x, st.pos.y + (moving && st.pos.y === 0 ? Math.abs(Math.sin(bob.current)) * 0.08 : 0), st.pos.z)
      body.current.rotation.y = st.heading
    }

    // Over-the-shoulder chase camera. camPitch drives BOTH the camera height and how far up the
    // look target rides, because a chase camera that always looks at the player can never show the
    // top of a 20-50 m building. Negative pitch (mouse up) drops the camera and lifts the gaze.
    const lookLift = Math.max(0, -st.camPitch) * 42
    const dist = 7.5, h = Math.max(1.1, 2.4 + st.camPitch * 6)
    const cy = Math.cos(st.camYaw), sy = Math.sin(st.camYaw)
    const shoulder = 0.9
    const desired = new THREE.Vector3(st.pos.x + sy * dist + cy * shoulder, st.pos.y + h, st.pos.z + cy * dist - sy * shoulder)
    const a = 1 - Math.exp(-dt * 7)
    camera.position.lerp(desired, a)
    const tgt = new THREE.Vector3(st.pos.x + cy * shoulder * 0.6, st.pos.y + 1.6 + lookLift, st.pos.z - sy * shoulder * 0.6)
    look.current.lerp(tgt, 1 - Math.exp(-dt * 10))
    camera.lookAt(look.current)

    if (sun.current) {
      sun.current.position.set(st.pos.x + 40, 70, st.pos.z + 25)
      sun.current.target.position.set(st.pos.x, 0, st.pos.z)
    }
  })

  return (
    <>
      <directionalLight ref={sun} intensity={2.4} color="#ffd6a8" castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-60} shadow-camera-right={60} shadow-camera-top={60} shadow-camera-bottom={-60} shadow-bias={-0.0004} />
      {/* `name` is load-bearing, not decoration: check-sandbox.mjs finds the player by it and
          reads its position, so it stays on the group whatever the body is drawn from. */}
      <group ref={body} name="walk-player">
        {avatar
          ? <primitive object={avatar} />
          // Fallback only. The facing marker exists because a bare capsule has no front; the
          // mascot does, so it is not drawn over the model.
          : <>
              <mesh position-y={0.95} castShadow>
                <capsuleGeometry args={[RADIUS, 1.0, 8, 16]} />
                <meshStandardMaterial color="#e8e2d8" roughness={0.4} metalness={0.1} />
              </mesh>
              <mesh position={[0, 1.45, RADIUS - 0.04]}>
                <boxGeometry args={[0.52, 0.14, 0.12]} />
                <meshStandardMaterial color="#c2341d" emissive="#c2341d" emissiveIntensity={2.2} />
              </mesh>
            </>}
        {/* Ground ring: the avatar's plan position is what the minimap and collider use, and the
            mascot's spread wings make its silhouette a poor guide to where it actually stands. */}
        <mesh rotation-x={-Math.PI / 2} position-y={0.02}>
          <ringGeometry args={[0.66, 0.78, 44]} />
          <meshBasicMaterial color="#c2341d" transparent opacity={0.6} />
        </mesh>
      </group>
    </>
  )
}

function World({ fit, asset, footprint, neighbors, style, state, keys, show, models }: {
  fit: ScenePlacement; asset: MeshAsset; footprint: V2[]; neighbors: V2[][]; style: string
  state: React.MutableRefObject<PlayerState>; keys: React.MutableRefObject<Keys>; show: { footprint: boolean; bbox: boolean }
  models?: WalkModel[]
}) {
  const tex = useMemo(() => groundTexture(style), [style])
  useEffect(() => () => tex.dispose(), [tex])
  const groundSpan = models ? Math.max(800, ...models.flatMap(m => m.fit.chosen.poly.flatMap(p => [Math.abs(p.x) * 2 + 100, Math.abs(p.z) * 2 + 100]))) : 800
  // The footprint ring is a DRAWN REFERENCE, not geometry: blocking it walled the player out of
  // empty ground wherever the building did not fill its own footprint. Only real volume collides.
  const colliders = useMemo(() => [
    ...(models ? models.map(m => ({ poly: m.fit.chosen.poly, name: m.asset.meta.source })) : [{ poly: fit.chosen.poly, name: 'building' }]),
    ...neighbors.map((n) => ({ poly: n, name: 'adjacent building' })),
  ], [fit, neighbors, models])
  const night = style === 'noir'
  const fogColor = night ? '#0b0816' : style === 'scorched' ? '#c79a6f' : '#b9c7cf'
  return (
    <>
      <color attach="background" args={[fogColor]} />
      <fog attach="fog" args={[fogColor, 30, night ? 140 : 220]} />
      {!night && <Sky sunPosition={[80, style === 'scorched' ? 18 : 40, 50]} turbidity={style === 'scorched' ? 14 : 6} rayleigh={style === 'scorched' ? 3 : 1.2} mieCoefficient={0.01} />}
      <hemisphereLight args={[night ? '#5a3cff' : '#ffe9d0', night ? '#0a0610' : '#3b2a1c', night ? 0.35 : 0.8]} />
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[groundSpan, groundSpan]} />
        <meshStandardMaterial map={tex} roughness={night ? 0.35 : 1} metalness={night ? 0.3 : 0} />
      </mesh>
      {models ? models.map(m => <PlacedAsset key={m.id} asset={m.asset} matrix={m.fit.matrices.M} />) : <PlacedAsset asset={asset} matrix={fit.matrices.M} />}
      {neighbors.map((n, i) => <Extruded key={i} poly={n} h={6 + ((i * 7) % 9)} color={night ? '#1c1a26' : '#5b5048'} />)}
      {show.footprint && (models ? models.map(m => <Line key={m.id} points={loop(m.fit.chosen.poly, 0.05)} color="#e8503a" lineWidth={3} />) : <Line points={loop(footprint, 0.05)} color="#e8503a" lineWidth={3} />)}
      {show.bbox && (models ?? [{ id: 'primary', fit }]).map(m => <Line key={m.id} points={loop(m.fit.chosen.poly, 0.07)} color="#f4f2ed" lineWidth={2} dashed dashSize={0.8} gapSize={0.5} />)}
      {style === 'scorched' && <Sparkles count={260} scale={[120, 20, 120]} position={[0, 8, 0]} size={3} speed={0.5} color="#ffb35c" opacity={0.6} />}
      {night && <Sparkles count={200} scale={[120, 30, 120]} position={[0, 10, 0]} size={2} speed={0.3} color="#2ef2ff" />}
      <Player state={state} keys={keys} colliders={colliders} />
    </>
  )
}

function spawnPoint(fit: ScenePlacement, colliders: V2[][]): THREE.Vector3 {
  const { center, angle, length } = fit.footprintOBB
  for (let r = length / 2 + 16; r < 120; r += 3)
    for (let a = 0; a < 16; a++) {
      const t = angle + Math.PI / 2 + (a * Math.PI) / 8
      const p = { x: center.x + Math.cos(t) * r, z: center.z + Math.sin(t) * r }
      if (!colliders.some((c) => hits(p, c))) return new THREE.Vector3(p.x, 0, p.z)
    }
  // A multi-model scene can cover the entire search area. Spawn beyond every collider.
  const maxZ = Math.max(center.z, ...colliders.flatMap(poly => poly.map(p => p.z)))
  return new THREE.Vector3(center.x, 0, maxZ + 16)
}

function Minimap({ footprint, neighbors, state, fit }: { footprint: V2[]; neighbors: V2[][]; state: React.MutableRefObject<PlayerState>; fit: ScenePlacement }) {
  const dot = useRef<SVGGElement>(null)
  const c = fit.footprintOBB.center
  const S = Math.max(60, ...[footprint, ...neighbors].flatMap(poly => poly.map(p => Math.hypot(p.x - c.x, p.z - c.z) * 1.15)))
  const P = (p: V2) => `${((p.x - c.x) / S) * 100 + 100},${((p.z - c.z) / S) * 100 + 100}`
  useEffect(() => {
    let id = 0
    const tick = () => {
      const st = state.current
      if (dot.current) {
        const x = Math.max(4, Math.min(196, ((st.pos.x - c.x) / S) * 100 + 100))
        const y = Math.max(4, Math.min(196, ((st.pos.z - c.z) / S) * 100 + 100))
        dot.current.setAttribute('transform', `translate(${x},${y}) rotate(${(-st.heading * 180) / Math.PI + 180})`)
      }
      id = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(id)
  }, [state, c.x, c.z, S])
  return (
    <svg className="minimap" viewBox="0 0 200 200">
      <defs><clipPath id="mm"><circle cx="100" cy="100" r="98" /></clipPath></defs>
      <circle cx="100" cy="100" r="98" fill="#fbfaf7" stroke="#b3ada1" />
      <g clipPath="url(#mm)">
        {[40, 80].map((r) => <circle key={r} cx="100" cy="100" r={r} fill="none" stroke="#dcd8d0" />)}
        {neighbors.map((n, i) => <polygon key={i} points={n.map(P).join(' ')} fill="#dcd7ce" stroke="#b3ada1" strokeWidth=".75" />)}
        <polygon points={footprint.map(P).join(' ')} fill="rgba(194,52,29,.22)" stroke="#c2341d" strokeWidth="1.5" />
        <g ref={dot}>
          <path d="M0-7 5 5 0 2-5 5Z" fill="#16181c" />
        </g>
      </g>
      <text x="100" y="15" textAnchor="middle" fontSize="10" fontWeight="700" fill="#4a4f56" fontFamily="Archivo" letterSpacing="1">N</text>
    </svg>
  )
}

function Readout({ state, geo }: { state: React.MutableRefObject<PlayerState>; geo: GeoResult }) {
  // A derived site is not registered to the world, so the walker's position is reported in metres
  // from the site origin. Unprojecting it would dress an offset from Null Island as a coordinate.
  const anchored = geo.source !== 'derived'
  const [r, setR] = useState({ lat: geo.lat, lon: geo.lon, x: 0, z: 0, speed: 0, blocked: null as string | null })
  useEffect(() => {
    const id = setInterval(() => {
      const st = state.current
      const [lat, lon] = unproject({ x: st.pos.x, z: st.pos.z }, geo.lat, geo.lon)
      setR({ lat, lon, x: st.pos.x, z: st.pos.z, speed: st.speed, blocked: st.blocked })
    }, 120)
    return () => clearInterval(id)
  }, [state, geo])
  return (
    <>
      <div className="glass" style={{ padding: '12px 16px', minWidth: 250 }}>
        <div className="field-label" style={{ fontSize: 10 }}>{anchored ? 'Live · map-anchored' : 'Live · derived site · no anchor'}</div>
        <div style={{ font: '600 17px var(--display)', margin: '4px 0 6px' }}>{geo.displayName.split(',')[0]}</div>
        <div className="kv"><span>Position</span><span>{anchored
          ? `${r.lat.toFixed(6)}, ${r.lon.toFixed(6)}`
          : `${r.x.toFixed(1)} m E, ${(-r.z).toFixed(1)} m N of site origin`}</span></div>
        <div className="kv"><span>Speed</span><span>{r.speed.toFixed(1)} m/s</span></div>
      </div>
      {r.blocked && <div className="glass toast" style={{ marginTop: 8 }}><ShieldAlert size={14} /> Collision · {r.blocked}</div>}
    </>
  )
}

export function WalkStage({ sandbox, onExit }: { sandbox?: WalkModel[]; onExit?: () => void } = {}) {
  const s = useStore()
  const keys = useRef<Keys>({})
  const [pressed, setPressed] = useState<Keys>({})
  const [focused, setFocused] = useState(false)
  const [show, setShow] = useState({ footprint: true, bbox: false })
  const wrap = useRef<HTMLDivElement>(null)
  // On the derived path the nudge IS the placement, not a correction to one, so it composes here
  // the same way a manifest's does.
  const fit = useMemo(() => sandbox ? sandbox[0].fit : s.placement ? placementScene(s.placement, s.adjust)
    : s.geo?.source === 'derived' ? derivedScene(s.fit!, s.adjust)
    : s.fit!, [s.placement, s.adjust, s.fit, s.geo, sandbox])
  const geo = useMemo<GeoResult>(() => sandbox ? {
    query: 'Sandbox', displayName: `Sandbox · ${sandbox.length} models`, source: 'derived',
    lat: 0, lon: 0, footprintLatLon: [], bucket: 'local', areaM2: 0,
    footprint: fit.chosen.poly, neighbors: [],
  } : s.geo!, [sandbox, fit, s.geo])
  const mesh = sandbox ? sandbox[0].asset : s.mesh!
  const collisionPolys = useMemo(() => sandbox ? sandbox.map(m => m.fit.chosen.poly)
    : [fit.chosen.poly, ...geo.neighbors], [sandbox, fit, geo])
  const minimapNeighbors = useMemo(() => sandbox ? sandbox.slice(1).map(m => m.fit.chosen.poly) : geo.neighbors, [sandbox, geo])
  // The derived outline is a property of the object, so it travels with a free placement rather
  // than staying behind where the object was first grounded.
  const siteFootprint = geo.source === 'derived' ? fit.chosen.poly : geo.footprint
  const state = useRef<PlayerState>({
    pos: spawnPoint(fit, collisionPolys),
    heading: 0, camYaw: 0, camPitch: 0.15, vy: 0, speed: 0, blocked: null,
  })
  // face the building on spawn
  useMemo(() => {
    const st = state.current
    st.camYaw = Math.atan2(st.pos.x - fit.footprintOBB.center.x, st.pos.z - fit.footprintOBB.center.z)
    st.heading = st.camYaw + Math.PI
  }, [fit])

  useEffect(() => {
    const lockTarget = wrap.current
    const norm = (e: KeyboardEvent) => (e.key === 'Shift' ? 'shift' : e.key.toLowerCase())
    const down = (e: KeyboardEvent) => {
      if (document.pointerLockElement !== wrap.current) return
      const k = norm(e)
      if (['w', 'a', 's', 'd', ' ', 'shift', 'q', 'e'].includes(k)) e.preventDefault()
      keys.current[k] = true; setPressed({ ...keys.current })
    }
    const up = (e: KeyboardEvent) => { keys.current[norm(e)] = false; setPressed({ ...keys.current }) }
    const blur = () => { keys.current = {}; setPressed({}) }
    const move = (e: MouseEvent) => {
      if (document.pointerLockElement !== wrap.current) return
      state.current.camYaw -= e.movementX * 0.0035
      // Was clamped at -0.2, which capped the gaze just above the horizon.
      state.current.camPitch = Math.max(-0.75, Math.min(1.0, state.current.camPitch + e.movementY * 0.0025))
    }
    const lock = () => { setFocused(document.pointerLockElement === wrap.current); blur() }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    window.addEventListener('mousemove', move)
    document.addEventListener('pointerlockchange', lock)
    return () => {
      window.removeEventListener('keydown', down); window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur); window.removeEventListener('mousemove', move)
      document.removeEventListener('pointerlockchange', lock)
      if (document.pointerLockElement === lockTarget) document.exitPointerLock()
    }
  }, [])

  const K = ({ k, label }: { k: string; label?: string }) => <div className={`key ${pressed[k] ? 'on' : ''}`}>{label ?? k.toUpperCase()}</div>

  return (
    <div className="explore" ref={wrap}>
      <Canvas shadows camera={{ fov: 60, near: 0.1, far: 800, position: [0, 20, 60] }} dpr={[1, 2]}>
        <World fit={fit} asset={mesh} footprint={siteFootprint} neighbors={geo.neighbors} style={s.presetId} state={state} keys={keys} show={show} models={sandbox} />
      </Canvas>

      <div className="hud tl"><Readout state={state} geo={geo} /></div>
      <div className="hud tr glass" style={{ padding: 8, borderRadius: '50%' }}>
        <Minimap footprint={siteFootprint} neighbors={minimapNeighbors} state={state} fit={fit} />
      </div>
      <div className="hud bl glass" style={{ padding: 14, display: 'flex', gap: 18, alignItems: 'flex-end' }}>
        <div className="keys">
          <K k="q" /><K k="w" /><K k="e" />
          <K k="a" /><K k="s" /><K k="d" />
        </div>
        <div style={{ display: 'grid', gap: 4 }}>
          <div className={`key ${pressed.shift ? 'on' : ''}`} style={{ width: 70 }}>SHIFT</div>
          <div className={`key ${pressed[' '] ? 'on' : ''}`} style={{ width: 70 }}>SPACE</div>
        </div>
        <div className="dimmer" style={{ fontSize: 11.5, lineHeight: 1.7 }}>
          <div>WASD move · Q/E orbit</div>
          <div>Shift sprint · Space jump</div>
          <div>Mouse look (click to lock)</div>
        </div>
      </div>
      <div className="hud br glass" style={{ padding: '10px 14px', display: 'flex', gap: 14, alignItems: 'center' }}>
        <label className="toggle"><input type="checkbox" checked={show.footprint} onChange={(e) => setShow({ ...show, footprint: e.target.checked })} />Footprint</label>
        <label className="toggle"><input type="checkbox" checked={show.bbox} onChange={(e) => setShow({ ...show, bbox: e.target.checked })} />Mesh hull</label>
        <button className="btn sm" onClick={() => {
          const st = state.current
          st.pos.copy(spawnPoint(fit, collisionPolys))
          st.camYaw = Math.atan2(st.pos.x - fit.footprintOBB.center.x, st.pos.z - fit.footprintOBB.center.z)
          st.heading = st.camYaw + Math.PI
          st.camPitch = 0.15; st.vy = 0; st.speed = 0; st.blocked = null; keys.current = {}; setPressed({})
        }}>Reset position</button>
        <button className="btn sm" onClick={() => { if (document.pointerLockElement) document.exitPointerLock(); if (onExit) onExit(); else s.go('fit') }}><ArrowLeft size={13} /> {sandbox ? 'Edit models' : 'Transform'}</button>
      </div>

      {!focused && (
        <div className="focus-prompt" style={{ pointerEvents: 'none' }}>
          <div className="glass inner" style={{ pointerEvents: 'auto', cursor: 'pointer' }} onClick={() => wrap.current?.requestPointerLock()}>
            <MousePointer2 size={26} color="#c2341d" />
            <div style={{ font: '600 20px var(--display)', margin: '8px 0 4px' }}>Click to enter the site</div>
            <div className="dimmer" style={{ fontSize: 13 }}>Mouse to look · WASD to move · Esc to release</div>
          </div>
        </div>
      )}
    </div>
  )
}

/** Server designs start in orbit mode; walking uses the identical saved matrix. */
export default function ExploreStage() {
  const s = useStore()
  const [mode, setMode] = useState<'orbit' | 'walk'>('orbit')
  const [camera, setCamera] = useState(0)
  if (!s.mesh || !s.geo || !(s.placement || s.fit)) return <div className="stage">Placement is no longer available. Return to Fit to place this design.</div>
  const derived = s.geo.source === 'derived'
  // Simulation output has neither a manifest nor a derived site, so it keeps the bare walk view.
  if (!s.placement && !derived) return <WalkStage />
  const derivedFit = derived ? derivedScene(s.fit!, s.adjust) : null
  return <div className="explore">
    {mode === 'walk'
      ? <WalkStage key={camera} />
      : derivedFit
        ? <DerivedScene key={camera} asset={s.mesh} matrix={derivedFit.matrices.M} outline={derivedFit.chosen.poly} />
        : <PlacedScene key={camera} asset={s.mesh} placement={s.placement!} />}
    <div className="glass" style={{ position: 'absolute', top: 16, left: 16, right: 240, zIndex: 5, padding: 14 }}>
      <div className="row wrap">
        {/* A derived site has no verdict to report, and must not borrow the look of one. */}
        <b>{s.placement ? `Placement: ${s.placement.plan_fit}` : 'Derived site · placement not scored'}</b>
        <button className="btn sm" onClick={() => { document.exitPointerLock(); setMode(mode === 'orbit' ? 'walk' : 'orbit') }}>{mode === 'orbit' ? 'Walk around' : 'Orbit view'}</button>
        <button className="btn sm" onClick={() => { document.exitPointerLock(); setCamera((n) => n + 1) }}>Reset camera</button>
        <button className="btn sm" onClick={() => { document.exitPointerLock(); s.go('fit') }}>Inspect / export</button>
      </div>
      {/* Only for a cached example: offering to switch would otherwise throw away a real job. */}
      {s.example && <ExamplePicker variant="strip" />}
      <div className="dimmer" style={{ marginTop: 6 }}>{!s.placement
        ? `Outline derived from the model · no geographic anchor · size ${s.derived?.scaleProvenance === 'user-declared' ? 'user-declared' : 'as authored in the file'}`
        : <>Heading unverified · {s.placement.height === 'inferred' ? 'height inferred from the mesh' : `height ${s.placement.request.measured_height_m?.toFixed(1)} m from the ${s.placement.provenance.source.toUpperCase()} record`}{s.placement.plan_fit === 'rejected' ? ' · Inspection only: this placement fails the fit constraints.' : ''}</>}</div>
      {/* An imported object was not generated from a prompt here; showing the idle preset text
          would imply it was. */}
      {!derived && <details style={{ marginTop: 8 }}><summary>Source photo and prompt</summary>
        <p>{s.prompt}</p>{s.photos[0] && <img src={s.photos[0]} alt="Original building" style={{ width: 180, borderRadius: 8 }} />}
      </details>}
    </div>
  </div>
}
