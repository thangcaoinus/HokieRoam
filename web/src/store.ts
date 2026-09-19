import { create } from 'zustand'
import type { GeoResult } from './lib/geo'
import type { FitResult } from './lib/fit'
import type { MeshAsset } from './lib/reconstruct'
import { PRESETS } from './lib/presets'

export type StageId = 'ingest' | 'redesign' | 'reconstruct' | 'fit' | 'explore'
export const STAGES: { id: StageId; title: string; sub: string }[] = [
  { id: 'ingest', title: 'Ingest', sub: 'Address · photos · GIS footprint' },
  { id: 'redesign', title: 'Redesign', sub: 'Image-to-image restyle' },
  { id: 'reconstruct', title: 'Reconstruct', sub: 'Image-to-3D mesh' },
  { id: 'fit', title: 'Fit & Align', sub: 'Footprint snapping engine' },
  { id: 'explore', title: 'Explore', sub: 'Third-person walkthrough' },
]

export interface LogLine { t: number; msg: string; level: 'info' | 'ok' | 'warn' }

interface State {
  stage: StageId
  address: string
  photos: string[]
  primaryPhoto: number
  geo: GeoResult | null
  presetId: string
  prompt: string
  strength: number
  concept: string | null
  mesh: MeshAsset | null
  fit: FitResult | null
  logs: LogLine[]
  set: (p: Partial<State>) => void
  go: (s: StageId) => void
  log: (msg: string, level?: LogLine['level']) => void
  reset: () => void
}

const initial = {
  stage: 'ingest' as StageId,
  address: '',
  photos: [] as string[],
  primaryPhoto: 0,
  geo: null,
  presetId: PRESETS[0].id,
  prompt: PRESETS[0].prompt,
  strength: 0.8,
  concept: null,
  mesh: null,
  fit: null,
}

export const useStore = create<State>((set) => ({
  ...initial,
  logs: [{ t: Date.now(), msg: 'pipeline › ready', level: 'info' }],
  set: (p) => set(p),
  go: (stage) => set({ stage }),
  log: (msg, level = 'info') => set((s) => ({ logs: [...s.logs.slice(-199), { t: Date.now(), msg, level }] })),
  reset: () => set({ ...initial, logs: [{ t: Date.now(), msg: 'pipeline › reset', level: 'info' }] }),
}))

/** Which stages are reachable given current artefacts. */
export function unlocked(s: Pick<State, 'geo' | 'photos' | 'concept' | 'mesh' | 'fit'>): Record<StageId, boolean> {
  return {
    ingest: true,
    redesign: !!s.geo && s.photos.length > 0,
    reconstruct: !!s.geo,
    fit: !!s.mesh && !!s.geo,
    explore: !!s.fit,
  }
}

export function completed(s: Pick<State, 'geo' | 'photos' | 'concept' | 'mesh' | 'fit'>): Record<StageId, boolean> {
  return { ingest: !!s.geo && s.photos.length > 0, redesign: !!s.concept, reconstruct: !!s.mesh, fit: !!s.fit, explore: false }
}
