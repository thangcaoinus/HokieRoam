import { create } from 'zustand'
import type { GeoResult } from './lib/geo'
import type { FitResult } from './lib/fit'
import type { MeshAsset } from './lib/reconstruct'
import type { JobView } from './lib/api'
import { PRESETS } from './lib/presets'

export type StageId = 'ingest' | 'redesign' | 'reconstruct' | 'fit' | 'explore'
export const STAGES: { id: StageId; title: string; sub: string }[] = [
  { id: 'ingest', title: 'Ingest', sub: 'Address · photos · GIS footprint' },
  { id: 'redesign', title: 'Redesign', sub: 'Image-to-image restyle' },
  { id: 'reconstruct', title: 'Reconstruct', sub: 'Image-to-3D mesh' },
  { id: 'fit', title: 'Fit & Align', sub: 'Footprint snapping engine' },
  { id: 'explore', title: 'Explore', sub: 'Third-person walkthrough' },
]

/** localStorage key for the Pipeline API session (job id, address, footprint) — see lib/pipelineJob.ts. */
export const SESSION_KEY = 'groundtruth.session.v1'

/** Reachability of VITE_API_BASE, from GET /v1/health. 'off' means simulation mode. */
export type ApiState =
  | { state: 'off' }
  | { state: 'checking' }
  | { state: 'down' }
  | { state: 'up'; provider: string; live: boolean }

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
  /** Latest server snapshot of the Pipeline API job, or null in simulation mode. */
  job: JobView | null
  /** Client-side failure talking to the API (unreachable, lost contact). Not a job status. */
  jobError: string | null
  api: ApiState
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
  job: null as JobView | null,
  jobError: null as string | null,
}

export const useStore = create<State>((set) => ({
  ...initial,
  api: { state: import.meta.env.VITE_API_BASE ? 'checking' : 'off' } as ApiState,
  logs: [{ t: Date.now(), msg: 'pipeline › ready', level: 'info' }],
  set: (p) => set(p),
  go: (stage) => set({ stage }),
  log: (msg, level = 'info') => set((s) => ({ logs: [...s.logs.slice(-199), { t: Date.now(), msg, level }] })),
  reset: () => {
    // Drop the saved job so a reload starts clean. The server keeps the job itself.
    try { localStorage.removeItem(SESSION_KEY) } catch { /* ignore */ }
    set({ ...initial, logs: [{ t: Date.now(), msg: 'pipeline › reset', level: 'info' }] })
  },
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
