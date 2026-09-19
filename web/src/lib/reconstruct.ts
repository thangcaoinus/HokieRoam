// Mesh assets for the Reconstruct stage.
// - `loadMeshUrl`: the GLB a Pipeline API job stored on the server (lib/pipelineJob.ts).
// - `loadMeshFile`: a user-supplied .glb / .obj.
// - `simulateReconstruct`: LOCAL SIMULATION ONLY (VITE_API_BASE unset). Procedurally builds a
//   textured building from the concept image. It is not image-to-3D and is labelled as such.
//   It is emitted like a typical reconstruction export — Z-up, centimetres, off-origin and
//   arbitrarily rotated — so the fitting engine has real work to undo. Keep that quirk.
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'

export interface MeshAsset {
  object: THREE.Object3D
  normalization: THREE.Matrix4
  meta: {
    source: string
    format: string
    upAxis: 'Y' | 'Z'
    units: 'm' | 'cm' | 'mm'
    vertices: number
    triangles: number
    /** Set when the bytes came from a Pipeline API job. */
    jobId?: string
    provider?: string
    /** True for the local procedural stand-in — never image-to-3D output. */
    simulated?: boolean
  }
}

/** Timed steps for the simulation's progress walk. Never shown over a real server job. */
export const RECON_STEPS = [
  'Synthesising novel views (6 × 320px)',
  'Sparse-view reconstruction · triplane decode',
  'Mesh extraction · marching cubes',
  'UV unwrap & texture bake',
]

function countStats(o: THREE.Object3D) {
  let vertices = 0, triangles = 0
  o.traverse((c) => {
    const m = c as THREE.Mesh
    if (!m.isMesh) return
    const g = m.geometry as THREE.BufferGeometry
    vertices += g.attributes.position.count
    triangles += g.index ? g.index.count / 3 : g.attributes.position.count / 3
  })
  return { vertices, triangles }
}

function unitHeuristic(o: THREE.Object3D): { units: 'm' | 'cm' | 'mm'; scale: number } {
  const size = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3())
  const m = Math.max(size.x, size.y, size.z)
  if (m > 5000) return { units: 'mm', scale: 0.001 }
  if (m > 500) return { units: 'cm', scale: 0.01 }
  return { units: 'm', scale: 1 }
}

async function loadMesh(url: string, ext: string, meta: Pick<MeshAsset['meta'], 'source' | 'jobId' | 'provider'>): Promise<MeshAsset> {
  let object: THREE.Object3D
  if (ext === 'obj') object = await new OBJLoader().loadAsync(url)
  else object = (await new GLTFLoader().loadAsync(url)).scene
  object.traverse((c) => { if ((c as THREE.Mesh).isMesh) { c.castShadow = true; c.receiveShadow = true } })
  const { units, scale } = unitHeuristic(object)
  return {
    object,
    // glTF is Y-up by specification, so only the unit scale is inferred.
    normalization: new THREE.Matrix4().makeScale(scale, scale, scale),
    meta: { ...meta, format: ext.toUpperCase(), upAxis: 'Y', units, ...countStats(object) },
  }
}

export async function loadMeshFile(file: File): Promise<MeshAsset> {
  const url = URL.createObjectURL(file)
  try {
    return await loadMesh(url, file.name.split('.').pop()!.toLowerCase(), { source: file.name })
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** The GLB a pipeline job stored on the server. */
export const loadMeshUrl = (url: string, meta: Pick<MeshAsset['meta'], 'source' | 'jobId' | 'provider'>) =>
  loadMesh(url, 'glb', meta)

export async function simulateReconstruct(concept: string, style: string, onStep: (i: number) => void): Promise<MeshAsset> {
  for (let i = 0; i < RECON_STEPS.length; i++) {
    onStep(i)
    await new Promise((r) => setTimeout(r, 700 + Math.random() * 500))
  }
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = concept
  })
  const building = buildProcedural(img, style)
  // Bake a "raw export" frame: Z-up, centimetres, off-origin, rotated.
  const offset = new THREE.Matrix4().makeTranslation(14, 0.8, -9).multiply(new THREE.Matrix4().makeRotationY(0.41))
  const toRaw = new THREE.Matrix4().makeScale(100, 100, 100).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)).multiply(offset)
  const raw = new THREE.Group()
  raw.name = 'reconstruction'
  building.updateMatrixWorld(true)
  building.traverse((c) => {
    const m = c as THREE.Mesh
    if (!m.isMesh) return
    const g = (m.geometry as THREE.BufferGeometry).clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(toRaw, m.matrixWorld))
    const mesh = new THREE.Mesh(g, m.material)
    mesh.castShadow = true; mesh.receiveShadow = true
    raw.add(mesh)
  })
  const N = new THREE.Matrix4().makeRotationX(-Math.PI / 2).multiply(new THREE.Matrix4().makeScale(0.01, 0.01, 0.01))
  return { object: raw, normalization: N, meta: { source: 'local procedural simulation', format: 'GLB', upAxis: 'Z', units: 'cm', simulated: true, ...countStats(raw) } }
}

// ---------- procedural building ----------
function avgColor(img: HTMLImageElement) {
  const c = document.createElement('canvas'); c.width = c.height = 16
  const ctx = c.getContext('2d')!
  ctx.drawImage(img, 0, 0, 16, 16)
  const d = ctx.getImageData(0, 0, 16, 16).data
  let r = 0, g = 0, b = 0
  for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2] }
  const n = d.length / 4
  return new THREE.Color(r / n / 255, g / n / 255, b / n / 255)
}

const STYLE = {
  scorched: { glass: '#2a1a12', lit: '#ff7a2a', litRate: 0.12, broken: 0.35, roof: '#2b2420' },
  campus: { glass: '#1d3c55', lit: '#fff1d0', litRate: 0.3, broken: 0, roof: '#34512f' },
  overgrown: { glass: '#1b2a20', lit: '#d9f2a0', litRate: 0.04, broken: 0.25, roof: '#2f4a26' },
  noir: { glass: '#120c24', lit: '#ff3cc8', litRate: 0.35, broken: 0.05, roof: '#15111f' },
} as const

function facadeTextures(wall: THREE.Color, style: keyof typeof STYLE, floors: number, bays: number, seed: number) {
  const s = STYLE[style]
  const W = 512, H = 512
  const make = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c }
  const albedo = make(), glow = make()
  const a = albedo.getContext('2d')!, g = glow.getContext('2d')!
  a.fillStyle = `#${wall.getHexString()}`; a.fillRect(0, 0, W, H)
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H)
  let r = seed
  const rand = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296)
  for (let i = 0; i < 900; i++) {
    a.fillStyle = `rgba(0,0,0,${rand() * 0.08})`
    a.fillRect(rand() * W, rand() * H, 2 + rand() * 18, 2 + rand() * 6)
  }
  const fh = H / floors, bw = W / bays
  for (let f = 0; f < floors; f++) {
    a.fillStyle = 'rgba(0,0,0,0.25)'; a.fillRect(0, f * fh, W, 3)
    for (let b = 0; b < bays; b++) {
      const x = b * bw + bw * 0.18, y = f * fh + fh * 0.22, w = bw * 0.64, h = fh * 0.56
      const broken = rand() < s.broken
      a.fillStyle = broken ? '#0b0806' : s.glass
      a.fillRect(x, y, w, h)
      a.fillStyle = 'rgba(255,255,255,0.08)'; a.fillRect(x, y, w, h * 0.35)
      if (!broken && rand() < s.litRate) {
        g.fillStyle = s.lit; g.fillRect(x, y, w, h)
        a.fillStyle = s.lit; a.globalAlpha = 0.6; a.fillRect(x, y, w, h); a.globalAlpha = 1
      }
    }
  }
  if (style === 'scorched') {
    for (let i = 0; i < 40; i++) {
      const x = rand() * W
      const grd = a.createLinearGradient(x, 0, x, H * 0.7)
      grd.addColorStop(0, 'rgba(15,8,4,0.7)'); grd.addColorStop(1, 'rgba(15,8,4,0)')
      a.fillStyle = grd; a.fillRect(x, 0, 4 + rand() * 20, H * 0.7)
    }
  }
  const t1 = new THREE.CanvasTexture(albedo), t2 = new THREE.CanvasTexture(glow)
  t1.colorSpace = THREE.SRGBColorSpace; t2.colorSpace = THREE.SRGBColorSpace
  t1.anisotropy = 8
  return { map: t1, emissiveMap: t2, lit: s.lit }
}

function block(w: number, h: number, d: number, wall: THREE.Color, style: keyof typeof STYLE, front: THREE.Texture | null, seed: number) {
  const floors = Math.max(2, Math.round(h / 4))
  const side = facadeTextures(wall, style, floors, Math.max(2, Math.round(d / 4)), seed)
  const long = facadeTextures(wall, style, floors, Math.max(3, Math.round(w / 4)), seed + 11)
  const mk = (t: ReturnType<typeof facadeTextures>) =>
    new THREE.MeshStandardMaterial({ map: t.map, emissiveMap: t.emissiveMap, emissive: new THREE.Color(t.lit), emissiveIntensity: 1.4, roughness: 0.85, metalness: 0.05 })
  const roof = new THREE.MeshStandardMaterial({ color: STYLE[style].roof, roughness: 0.95 })
  const frontMat = front ? new THREE.MeshStandardMaterial({ map: front, roughness: 0.8 }) : mk(long)
  const mats = [mk(side), mk(side), roof, roof, mk(long), frontMat] // +x -x +y -y +z -z
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats)
  m.position.y = h / 2
  return m
}

function buildProcedural(img: HTMLImageElement, styleId: string) {
  const style = (styleId in STYLE ? styleId : 'scorched') as keyof typeof STYLE
  const wall = avgColor(img).multiplyScalar(1.15)
  const front = new THREE.Texture(img)
  front.colorSpace = THREE.SRGBColorSpace
  front.needsUpdate = true
  const g = new THREE.Group()

  const main = block(36, 20, 15, wall, style, front, 1)
  g.add(main)
  const wing = block(15, 13, 8.5, wall.clone().multiplyScalar(0.92), style, null, 5)
  wing.position.set(-10.5, 6.5, 11.75)
  g.add(wing)

  const dark = new THREE.MeshStandardMaterial({ color: '#2a2724', roughness: 0.9 })
  const metal = new THREE.MeshStandardMaterial({ color: '#6b6660', roughness: 0.5, metalness: 0.6 })
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, ry = 0) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.y = ry; g.add(m); return m
  }
  // parapets
  add(new THREE.BoxGeometry(36.6, 1.2, 0.5), dark, 0, 20.6, -7.6)
  add(new THREE.BoxGeometry(36.6, 1.2, 0.5), dark, 0, 20.6, 7.6)
  add(new THREE.BoxGeometry(0.5, 1.2, 15), dark, -18.2, 20.6, 0)
  add(new THREE.BoxGeometry(0.5, 1.2, 15), dark, 18.2, 20.6, 0)
  // plinth
  add(new THREE.BoxGeometry(36.8, 1.2, 15.8), dark, 0, 0.6, 0)
  // rooftop plant
  add(new THREE.BoxGeometry(5, 2.4, 3.5), metal, 9, 21.2, -2)
  add(new THREE.BoxGeometry(3, 1.8, 3), metal, -6, 20.9, 2)
  add(new THREE.CylinderGeometry(1.6, 1.6, 3.6, 20), metal, 13.5, 21.8, 3.5)
  add(new THREE.CylinderGeometry(0.08, 0.08, 7, 6), metal, -14, 23.5, -4)

  if (style === 'campus') {
    const pv = new THREE.MeshStandardMaterial({ color: '#10223f', roughness: 0.25, metalness: 0.7 })
    for (let i = 0; i < 6; i++) {
      const p = add(new THREE.BoxGeometry(3.2, 0.12, 2), pv, -14 + i * 3.6, 21, -5)
      p.rotation.x = -0.35
    }
  }
  if (style === 'scorched') {
    const rubble = new THREE.MeshStandardMaterial({ color: '#3a2a1e', roughness: 1 })
    for (let i = 0; i < 14; i++) {
      const s = 0.6 + ((i * 37) % 10) / 6
      const m = add(new THREE.BoxGeometry(s, s * 0.6, s * 1.3), rubble, -17 + ((i * 53) % 34), s * 0.3, -8.6 - ((i * 7) % 3))
      m.rotation.set(i * 0.7, i * 1.3, i * 0.4)
    }
  }
  if (style === 'noir') {
    const neon = new THREE.MeshStandardMaterial({ color: '#2ef2ff', emissive: '#2ef2ff', emissiveIntensity: 3 })
    add(new THREE.BoxGeometry(0.4, 9, 0.4), neon, 18.3, 10, -7.7)
    add(new THREE.BoxGeometry(36, 0.25, 0.25), new THREE.MeshStandardMaterial({ color: '#ff3cc8', emissive: '#ff3cc8', emissiveIntensity: 3 }), 0, 4, -7.75)
  }
  if (style === 'overgrown') {
    const leaf = new THREE.MeshStandardMaterial({ color: '#3f7a3a', roughness: 1 })
    for (let i = 0; i < 18; i++) {
      add(new THREE.IcosahedronGeometry(0.9 + (i % 4) * 0.5, 0), leaf, -17 + ((i * 41) % 34), 20.6 + (i % 3) * 0.3, -6 + ((i * 17) % 12))
    }
  }
  return g
}

export async function exportGLB(asset: MeshAsset, M: THREE.Matrix4): Promise<Blob> {
  const root = new THREE.Group()
  const anchor = new THREE.Group()
  anchor.name = 'map_anchor'
  anchor.matrixAutoUpdate = false
  anchor.matrix.copy(M)
  anchor.add(asset.object.clone(true))
  root.add(anchor)
  const buf = (await new GLTFExporter().parseAsync(root, { binary: true })) as ArrayBuffer
  return new Blob([buf], { type: 'model/gltf-binary' })
}
