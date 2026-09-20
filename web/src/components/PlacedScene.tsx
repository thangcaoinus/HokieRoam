import { useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { Bounds, Grid, Line, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { MeshAsset } from '../lib/reconstruct'
import type { PlacementManifest } from '../lib/api'
import { sceneRing } from '../lib/api'

/** Raw scene graph below one matrix node. Never also apply asset.normalization. */
export function PlacedAsset({ asset, matrix }: { asset: MeshAsset; matrix: number[] }) {
  const object = useMemo(() => asset.object.clone(true), [asset])
  const transform = useMemo(() => new THREE.Matrix4().fromArray(matrix), [matrix])
  return <group name="asset-placement" matrixAutoUpdate={false} matrix={transform}>
    <primitive object={object} />
  </group>
}

export default function PlacedScene({ asset, placement, raw = false }: {
  asset: MeshAsset; placement: PlacementManifest; raw?: boolean
}) {
  const footprint = sceneRing(placement.request.footprint.exterior)
  const proxy = sceneRing(placement.selected.fitted_proxy.exterior)
  const loop = (p: typeof footprint, y: number): [number, number, number][] =>
    [...p, p[0]].map((v) => [v.x, y, v.z])
  return <Canvas frameloop="demand" camera={{ position: [75, 65, 95], fov: 45 }} dpr={[1, 1.5]}>
    <color attach="background" args={['#100e0d']} />
    <hemisphereLight args={['#ffffff', '#66564c', 2]} />
    <directionalLight position={[30, 70, 40]} intensity={2.5} />
    <Bounds fit clip observe margin={1.3} key={`${raw}-${placement.asset_sha256}-${placement.selected.index}`}>
      <PlacedAsset asset={asset} matrix={raw ? new THREE.Matrix4().toArray() : placement.selected.matrix_column_major} />
      {!raw && <>
        <Line points={loop(footprint, 0.08)} color="#ff6b2c" lineWidth={3} />
        {placement.request.footprint.holes.map((ring, i) => <Line key={i} points={loop(sceneRing(ring), 0.08)} color="#ff6b2c" lineWidth={3} />)}
        <Line points={loop(proxy, 0.12)} color="#7dffb2" lineWidth={2} />
      </>}
    </Bounds>
    <Grid infiniteGrid fadeDistance={250} sectionSize={10} cellSize={1} cellColor="#342b25" sectionColor="#72523c" />
    <OrbitControls makeDefault />
  </Canvas>
}
