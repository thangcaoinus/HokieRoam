import { Canvas } from '@react-three/fiber'
import { Bounds, Grid, Line, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { MeshAsset } from '../lib/reconstruct'
import type { V2 } from '../lib/geo'
import { PlacedAsset } from './PlacedScene'

/**
 * Orbit view for a derived site. `PlacedScene` is the equivalent for a server placement, but it
 * reads a `PlacementManifest` — and there is none here, because nothing was fitted to an
 * authoritative footprint. Only the object and its own outline are drawn: no footprint overlay to
 * compare against, and no neighbour parcels, because neither exists on this path.
 */
export default function DerivedScene({ asset, matrix, outline, raw = false }: {
  asset: MeshAsset
  matrix: number[]
  outline: V2[]
  raw?: boolean
}) {
  const loop: [number, number, number][] = [...outline, outline[0]].map((v) => [v.x, 0.1, v.z])
  return <Canvas frameloop="demand" camera={{ position: [68, 34, 92], fov: 45 }} dpr={[1, 1.5]}>
    <color attach="background" args={['#100e0d']} />
    <hemisphereLight args={['#ffffff', '#66564c', 2]} />
    <directionalLight position={[30, 70, 40]} intensity={2.5} />
    <Bounds fit clip observe margin={1.08} key={`${raw}-${asset.meta.sha256}`}>
      <PlacedAsset asset={asset} matrix={raw ? new THREE.Matrix4().toArray() : matrix} />
      {!raw && <Line points={loop} color="#7dffb2" lineWidth={2.5} />}
    </Bounds>
    <Grid infiniteGrid fadeDistance={250} sectionSize={10} cellSize={1} cellColor="#342b25" sectionColor="#72523c" />
    <OrbitControls makeDefault />
  </Canvas>
}
