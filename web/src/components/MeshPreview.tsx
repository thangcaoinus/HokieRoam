import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { ContactShadows, Grid, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { MeshAsset } from '../lib/reconstruct'

export type ShadeMode = 'shaded' | 'wire' | 'clay'

function Model({ asset, mode }: { asset: MeshAsset; mode: ShadeMode }) {
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, -1, 0), 0), [])
  const ring = useRef<THREE.Mesh>(null)
  const t0 = useRef(performance.now())

  const { object, height, radius } = useMemo(() => {
    const obj = asset.object.clone(true)
    const holder = new THREE.Group()
    const inner = new THREE.Group()
    inner.matrixAutoUpdate = false
    inner.matrix.copy(asset.normalization)
    inner.add(obj)
    holder.add(inner)
    holder.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(holder)
    const c = box.getCenter(new THREE.Vector3())
    holder.position.set(-c.x, -box.min.y, -c.z)
    const size = box.getSize(new THREE.Vector3())
    return { object: holder, height: size.y, radius: Math.hypot(size.x, size.z) / 2 }
  }, [asset])

  useEffect(() => {
    t0.current = performance.now()
    const clay = new THREE.MeshStandardMaterial({ color: '#d9d2c6', roughness: 0.75, clippingPlanes: [plane] })
    const wire = new THREE.MeshBasicMaterial({ color: '#5ee1ff', wireframe: true, transparent: true, opacity: 0.55, clippingPlanes: [plane] })
    object.traverse((c) => {
      const m = c as THREE.Mesh
      if (!m.isMesh) return
      m.castShadow = true
      m.userData.orig ??= m.material
      const orig = m.userData.orig as THREE.Material | THREE.Material[]
      const withClip = (mat: THREE.Material) => { const k = mat.clone(); k.clippingPlanes = [plane]; return k }
      m.material = mode === 'clay' ? clay : mode === 'wire' ? wire : Array.isArray(orig) ? orig.map(withClip) : withClip(orig)
    })
  }, [object, mode, plane])

  useFrame(() => {
    const t = Math.min(1, (performance.now() - t0.current) / 2600)
    const e = 1 - Math.pow(1 - t, 3)
    plane.constant = e * (height + 0.5)
    if (ring.current) {
      ring.current.position.y = plane.constant
      ring.current.visible = t < 1
    }
  })

  return (
    <>
      <primitive object={object} />
      <mesh ref={ring} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[radius * 1.05, radius * 1.12, 96]} />
        <meshBasicMaterial color="#ff6b2c" transparent opacity={0.85} side={THREE.DoubleSide} />
      </mesh>
    </>
  )
}

export default function MeshPreview({ asset, mode }: { asset: MeshAsset | null; mode: ShadeMode }) {
  return (
    <Canvas shadows camera={{ position: [52, 34, 58], fov: 38 }} gl={{ localClippingEnabled: true, antialias: true }} dpr={[1, 2]}>
      <color attach="background" args={['#0b0a0a']} />
      <fog attach="fog" args={['#0b0a0a', 90, 220]} />
      <hemisphereLight args={['#ffe2c4', '#1a1210', 0.7]} />
      <directionalLight position={[40, 60, 25]} intensity={2.2} color="#ffd2a6" castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-50} shadow-camera-right={50} shadow-camera-top={50} shadow-camera-bottom={-50} />
      <directionalLight position={[-30, 20, -40]} intensity={0.6} color="#6fb7ff" />
      {asset && <Model asset={asset} mode={mode} />}
      <Grid args={[200, 200]} cellSize={2} cellThickness={0.6} cellColor="#2a2522" sectionSize={10} sectionThickness={1} sectionColor="#4a3326" fadeDistance={160} fadeStrength={1.5} infiniteGrid />
      <ContactShadows position={[0, 0.01, 0]} opacity={0.6} scale={120} blur={2.4} far={40} />
      <OrbitControls makeDefault autoRotate autoRotateSpeed={0.6} maxPolarAngle={Math.PI / 2.05} target={[0, 9, 0]} enableDamping />
    </Canvas>
  )
}
