import { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Grid, Line, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { FitResult } from '../lib/fit'
import type { V2 } from '../lib/geo'
import type { MeshAsset } from '../lib/reconstruct'
import { SCENE } from '../lib/sceneTheme'

export interface Layers { footprint: boolean; aabb: boolean; obb: boolean; neighbors: boolean }

const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t))

/** progress: 0..7 solver timeline; each factor animates during its own window. */
export function factorWeights(p: number) {
  return {
    align: ease(p - 1), // step 1→2
    ground: ease(p - 1.5),
    orient: ease(p - 3),
    target: ease(p - 3),
    scale: ease(p - 4),
  }
}

function AnimatedMesh({ asset, fit, progress }: { asset: MeshAsset; fit: FitResult; progress: React.MutableRefObject<number> }) {
  const g = useRef<Record<string, THREE.Group | null>>({})
  const obj = useMemo(() => {
    const o = asset.object.clone(true)
    o.traverse((c) => { if ((c as THREE.Mesh).isMesh) { c.castShadow = true; c.receiveShadow = true } })
    return o
  }, [asset])
  const N = useMemo(() => new THREE.Matrix4().fromArray(fit.matrices.N), [fit])
  const tg = useMemo(() => new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(fit.matrices.Tground)), [fit])
  const tt = useMemo(() => new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(fit.matrices.Ttarget)), [fit])

  useFrame(() => {
    const w = factorWeights(progress.current)
    const { Ttarget, Ry, S, Tground, Ralign } = g.current
    if (!Ttarget || !Ry || !S || !Tground || !Ralign) return
    Ralign.rotation.y = fit.meshOBB.angle * w.align
    Tground.position.copy(tg).multiplyScalar(w.ground)
    S.scale.set(1 + (fit.scale.sx - 1) * w.scale, 1 + (fit.scale.sy - 1) * w.scale, 1 + (fit.scale.sz - 1) * w.scale)
    Ry.rotation.y = (fit.yawDeg * Math.PI / 180) * w.orient
    Ttarget.position.copy(tt).multiplyScalar(w.target)
  })

  return (
    <group ref={(r) => (g.current.Ttarget = r)}>
      <group ref={(r) => (g.current.Ry = r)}>
        <group ref={(r) => (g.current.S = r)}>
          <group ref={(r) => (g.current.Tground = r)}>
            <group ref={(r) => (g.current.Ralign = r)}>
              <group matrixAutoUpdate={false} matrix={N}>
                <primitive object={obj} />
              </group>
            </group>
          </group>
        </group>
      </group>
    </group>
  )
}

const loop = (p: V2[], y = 0.06): [number, number, number][] => [...p, p[0]].map((v) => [v.x, y, v.z])

function Footprint({ poly }: { poly: V2[] }) {
  const shape = useMemo(() => {
    const s = new THREE.Shape()
    poly.forEach((p, i) => (i ? s.lineTo(p.x, -p.z) : s.moveTo(p.x, -p.z)))
    return s
  }, [poly])
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position-y={0.03}>
        <shapeGeometry args={[shape]} />
        <meshBasicMaterial color={SCENE.footprint} transparent opacity={0.17} depthWrite={false} />
      </mesh>
      <Line points={loop(poly)} color={SCENE.footprint} lineWidth={2.5} />
    </group>
  )
}

function Neighbor({ poly }: { poly: V2[] }) {
  const geo = useMemo(() => {
    const s = new THREE.Shape()
    poly.forEach((p, i) => (i ? s.lineTo(p.x, -p.z) : s.moveTo(p.x, -p.z)))
    const g = new THREE.ExtrudeGeometry(s, { depth: 9, bevelEnabled: false })
    g.rotateX(-Math.PI / 2)
    return g
  }, [poly])
  return (
    <group>
      <mesh geometry={geo} receiveShadow castShadow>
        <meshStandardMaterial color={SCENE.neighbor} roughness={0.95} transparent opacity={0.9} />
      </mesh>
      <Line points={loop(poly, 9.02)} color={SCENE.neighborEdge} lineWidth={1} />
    </group>
  )
}

function Scene({ asset, fit, footprint, neighbors, progress, layers }: Props) {
  const aabb = useMemo(() => {
    const [a, b] = [fit.rawAABB.min, fit.rawAABB.max]
    const box = new THREE.Box3(new THREE.Vector3(...a), new THREE.Vector3(...b))
    return box
  }, [fit])
  const aabbRef = useRef<THREE.Group>(null)
  const obbRef = useRef<THREE.Group>(null)
  useFrame(() => {
    const p = progress.current
    if (aabbRef.current) aabbRef.current.visible = layers.aabb
    if (obbRef.current) obbRef.current.visible = layers.obb && p >= 2
  })
  return (
    <>
      {layers.footprint && <Footprint poly={footprint} />}
      {layers.neighbors && neighbors.map((n, i) => <Neighbor key={i} poly={n} />)}
      <group ref={obbRef}>
        <Line points={loop(fit.footprintOBB.corners, 0.08)} color={SCENE.reference} lineWidth={1.5} dashed dashSize={1.2} gapSize={0.8} />
      </group>
      <group ref={aabbRef}>
        <box3Helper args={[aabb, new THREE.Color(SCENE.reference)]} />
      </group>
      <AnimatedMesh asset={asset} fit={fit} progress={progress} />
    </>
  )
}

interface Props {
  asset: MeshAsset
  fit: FitResult
  footprint: V2[]
  neighbors: V2[][]
  progress: React.MutableRefObject<number>
  layers: Layers
}

export default function FitScene(props: Props) {
  return (
    <Canvas shadows camera={{ position: [-58, 62, 78], fov: 40 }} dpr={[1, 2]}>
      <color attach="background" args={[SCENE.bg]} />
      <fog attach="fog" args={[SCENE.bg, 150, 300]} />
      <hemisphereLight args={[SCENE.skyLight, SCENE.groundLight, 1.9]} />
      <directionalLight position={[50, 80, 30]} intensity={1.9} color={SCENE.keyLight} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0008} shadow-camera-left={-80} shadow-camera-right={80} shadow-camera-top={80} shadow-camera-bottom={-80} />
      <directionalLight position={[-40, 25, -50]} intensity={0.45} color={SCENE.fillLight} />
      <mesh rotation-x={-Math.PI / 2} receiveShadow position-y={-0.01}>
        <planeGeometry args={[400, 400]} />
        <meshStandardMaterial color={SCENE.ground} roughness={1} />
      </mesh>
      <Grid args={[300, 300]} position-y={0.005} cellSize={1} cellThickness={0.5} cellColor={SCENE.gridCell} sectionSize={10} sectionThickness={1} sectionColor={SCENE.gridSection} fadeDistance={220} fadeStrength={1.3} infiniteGrid />
      <Scene {...props} />
      <OrbitControls makeDefault target={[0, 6, 0]} maxPolarAngle={Math.PI / 2.1} enableDamping />
    </Canvas>
  )
}
