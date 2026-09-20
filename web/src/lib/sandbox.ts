import { create } from 'zustand'
import * as THREE from 'three'
import type { MeshAsset } from './reconstruct'
import { deriveSite } from './deriveSite'
import { minAreaOBB } from './fit'
import type { V2 } from './geo'
import type { ScenePlacement } from './placement'
import { useStore } from '../store'
import { adjustedMatrix } from './placement'

export interface WalkModel { id: string; asset: MeshAsset; fit: ScenePlacement }
const outlines = new WeakMap<MeshAsset, { poly: V2[]; matrix: number[] }>()

/** Use the same measured silhouette as single-model Explore, transformed with the visible mesh. */
export function sandboxWalkModels(models: SandboxModel[]): WalkModel[] {
  return models.map(model => {
    let outline = outlines.get(model.asset)
    if (!outline) {
      const { fit } = deriveSite(model.asset, model.asset.meta.source)
      outline = { poly: fit.chosen.poly, matrix: fit.matrices.M }
      outlines.set(model.asset, outline)
    }
    const matrix = new THREE.Matrix4().makeTranslation(model.x, 0, model.z)
      .multiply(new THREE.Matrix4().makeRotationY(model.yaw))
      .multiply(new THREE.Matrix4().makeScale(model.scale, model.scale, model.scale))
      .multiply(new THREE.Matrix4().fromArray(model.matrix))
    const outlineTransform = matrix.clone().multiply(new THREE.Matrix4().fromArray(outline.matrix).invert())
    const poly = outline.poly.map(p => {
      const v = new THREE.Vector3(p.x, 0, p.z).applyMatrix4(outlineTransform)
      return { x: v.x, z: v.z }
    })
    return { id: model.id, asset: model.asset, fit: { matrices: { M: matrix.toArray() }, chosen: { poly }, footprintOBB: minAreaOBB(poly) } }
  })
}

export interface SandboxModel {
  id: string
  asset: MeshAsset
  matrix: number[]
  size: [number, number, number]
  x: number
  z: number
  yaw: number
  scale: number
  scaleSource: string
}

export function prepareSandboxModel(asset: MeshAsset): SandboxModel {
  const project = useStore.getState()
  const sameAsset = project.mesh === asset || (!!asset.meta.sha256 && asset.meta.sha256 === project.mesh?.meta.sha256)
  const fittedMatrix = project.placement ? adjustedMatrix(project.placement, project.adjust) : project.fit?.matrices.M
  const base = sameAsset && fittedMatrix ? new THREE.Matrix4().fromArray(fittedMatrix) : asset.normalization
  const root = new THREE.Group()
  root.applyMatrix4(base)
  root.add(asset.object.clone(true))
  const box = new THREE.Box3().setFromObject(root)
  const size = box.getSize(new THREE.Vector3())
  if (box.isEmpty() || ![...size.toArray(), ...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite) || size.length() === 0) {
    throw new Error('The model has no usable geometry.')
  }
  const center = box.getCenter(new THREE.Vector3())
  const matrix = new THREE.Matrix4().makeTranslation(-center.x, -box.min.y, -center.z).multiply(base)
  let scale = 1
  let scaleSource = sameAsset && fittedMatrix ? 'Same dimensions as Explore · fitted building scale' : 'File dimensions'
  if (!(sameAsset && fittedMatrix) && Math.max(size.x, size.y, size.z) < 5 && size.y > 0) {
    let height = project.geo?.heightM ?? 0
    if (project.mesh && fittedMatrix) {
      const reference = new THREE.Group()
      reference.applyMatrix4(new THREE.Matrix4().fromArray(fittedMatrix))
      reference.add(project.mesh.object.clone(true))
      height = new THREE.Box3().setFromObject(reference).getSize(new THREE.Vector3()).y
    }
    const hasReference = Number.isFinite(height) && height >= 5
    const target = hasReference ? height : 20
    scale = target / size.y
    scaleSource = hasReference
      ? `Estimated from current building · ${target.toFixed(1)} m height`
      : 'Estimated building height · 20 m (no fitted reference)'
  }
  return { id: crypto.randomUUID(), asset, matrix: matrix.toArray(), size: [size.x, size.y, size.z], x: 0, z: 0, yaw: 0, scale, scaleSource }
}

export const useSandbox = create<{
  models: SandboxModel[]
  selected: string | null
  add: (model: SandboxModel) => void
  update: (id: string, patch: Partial<Pick<SandboxModel, 'x' | 'z' | 'yaw' | 'scale' | 'scaleSource'>>) => void
  remove: (id: string) => void
}>((set) => ({
  models: [], selected: null,
  add: (model) => set((s) => {
    const edge = s.models.length ? Math.max(...s.models.map(m => m.x + Math.hypot(m.size[0], m.size[2]) * m.scale / 2)) : null
    const x = edge === null ? 0 : edge + Math.hypot(model.size[0], model.size[2]) * model.scale / 2 + 3
    return { models: [...s.models, { ...model, x }], selected: model.id }
  }),
  update: (id, patch) => set(s => ({ models: s.models.map(m => m.id === id ? { ...m, ...patch } : m) })),
  remove: (id) => set(s => ({ models: s.models.filter(m => m.id !== id), selected: s.selected === id ? null : s.selected })),
}))
