import { create } from 'zustand'
import type { GeoResult } from './lib/geo'
import type { FitResult } from './lib/fit'
import type { MeshAsset } from './lib/reconstruct'
import type { JobView, PlacementManifest } from './lib/api'
import { placementMatches } from './lib/placement'
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
export const EXAMPLE_KEY = 'groundtruth.example.v1'
export const BUNDLE_KEY = 'groundtruth.bundle.v1'

/** Reachability of VITE_API_BASE, from GET /v1/health. 'off' means simulation mode. */
export type ApiState =
  | { state: 'off' }
  | { state: 'checking' }
  | { state: 'down' }
  | { state: 'up'; provider: string; live: boolean }

export interface LogLine { t: number; msg: string; level: 'info' | 'ok' | 'warn' }

interface State {
  revision: number
  bundle: { name: string; url: string; urls: string[] } | null
  stage: StageId
  address: string
  photos: string[]
  primaryPhoto: number
  geo: GeoResult | null
  presetId: string
  prompt: string
  strength: number
  targetPolycount: number
  concept: string | null
  mesh: MeshAsset | null
  fit: FitResult | null
  placement: PlacementManifest | null
  example: { id: string; title: string } | null
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
  bundle: null,
  stage: 'ingest' as StageId,
  address: '',
  photos: [] as string[],
  primaryPhoto: 0,
  geo: null,
  presetId: PRESETS[0].id,
  prompt: PRESETS[0].prompt,
  strength: 0.8,
  targetPolycount: 60000,
  concept: null,
  mesh: null,
  fit: null,
  placement: null,
  example: null,
  job: null as JobView | null,
  jobError: null as string | null,
}

export const useStore = create<State>((set) => ({
  ...initial,
  revision: 0,
  api: { state: import.meta.env.VITE_API_BASE ? 'checking' : 'off' } as ApiState,
  logs: [{ t: Date.now(), msg: 'pipeline › ready', level: 'info' }],
  set: (p) => set(p),
  go: (stage) => set({ stage }),
  log: (msg, level = 'info') => set((s) => ({ logs: [...s.logs.slice(-199), { t: Date.now(), msg, level }] })),
  reset: () => {
    // Drop the saved job so a reload starts clean. The server keeps the job itself.
    try { localStorage.removeItem(SESSION_KEY); localStorage.removeItem(EXAMPLE_KEY); localStorage.removeItem(BUNDLE_KEY) } catch { /* ignore */ }
    set((s) => ({ ...initial, revision: s.revision + 1, logs: [{ t: Date.now(), msg: 'pipeline › reset', level: 'info' }] }))
  },
}))

/** Which stages are reachable given current artefacts. */
export function unlocked(s: Pick<State, 'geo' | 'photos' | 'concept' | 'mesh' | 'fit' | 'placement'>): Record<StageId, boolean> {
  return {
    ingest: true,
    redesign: !!s.geo && s.photos.length > 0,
    reconstruct: !!s.geo,
    fit: !!s.mesh && !!s.geo,
    explore: !!s.mesh && !!s.geo && !!(s.placement || s.fit),
  }
}

export function completed(s: Pick<State, 'geo' | 'photos' | 'concept' | 'mesh' | 'fit' | 'placement'>): Record<StageId, boolean> {
  return { ingest: !!s.geo && s.photos.length > 0, redesign: !!s.concept, reconstruct: !!s.mesh, fit: !!(s.fit || s.placement), explore: false }
}

let bundleUrls: string[] = []

// Covers both set() and direct setState() callers, including asynchronous artifact downloads.
useStore.subscribe((s, prev) => {
  if (s.revision !== prev.revision) {
    bundleUrls.forEach(url => URL.revokeObjectURL(url))
    bundleUrls = []
  }
  if (s.bundle && s.bundle !== prev.bundle) bundleUrls.push(...s.bundle.urls)
  const inputsChanged = s.mesh !== prev.mesh || s.geo !== prev.geo
  const invalid = s.placement && (!s.mesh || !s.geo || !placementMatches(s.placement, s.geo, s.mesh))
  if (invalid || (inputsChanged && s.fit)) {
    useStore.setState({
      ...(invalid ? { placement: null } : {}),
      ...(inputsChanged ? { fit: null } : {}),
      ...(s.stage === 'explore' ? { stage: s.geo && s.mesh ? 'fit' : 'ingest' } : {}),
    })
  }
  if (s.example && (!s.mesh?.meta.exampleId || !s.placement || invalid)) {
    try { localStorage.removeItem(EXAMPLE_KEY) } catch { /* ignore */ }
    useStore.setState({ example: null })
  }
  if (s.bundle && (!s.mesh?.meta.bundle || !s.placement || invalid)) {
    try { localStorage.removeItem(BUNDLE_KEY) } catch { /* ignore */ }
    useStore.setState({ bundle: null })
  }
})
