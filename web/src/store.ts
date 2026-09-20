import { create } from 'zustand'
import type { GeoResult } from './lib/geo'
import type { FitResult } from './lib/fit'
import type { DerivedMeta } from './lib/deriveSite'
import type { MeshAsset } from './lib/reconstruct'
import type { JobView, PlacementManifest } from './lib/api'
import { placementMatches } from './lib/placement'
import { PRESETS } from './lib/presets'

export type StageId = 'ingest' | 'redesign' | 'reconstruct' | 'fit' | 'explore' | 'sandbox'
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

/** Plan-space nudge about the footprint centroid: metres east/south and a yaw in radians. */
export interface Adjustment { dx: number; dz: number; dyaw: number }
export const NO_ADJUST: Adjustment = { dx: 0, dz: 0, dyaw: 0 }
export const isAdjusted = (a: Adjustment | null): a is Adjustment =>
  !!a && (Math.abs(a.dx) > 1e-6 || Math.abs(a.dz) > 1e-6 || Math.abs(a.dyaw) > 1e-6)

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
  /** Free-import only: a real-world height the person states for an imported object, in metres.
   *  A generated mesh carries no recoverable scale and there is no footprint to fit it to, so
   *  this is a declared claim rather than a measurement and is labelled that way everywhere. */
  declaredHeightM: number | null
  /** How the current derived site was produced. Null on the scored path. */
  derived: DerivedMeta | null
  placement: PlacementManifest | null
  /** Manual placement correction applied on top of the computed one, in scene metres/radians.
   *  Never merged into the manifest: the server fit stays the authoritative, exportable result
   *  and this is an explicitly labelled review overlay (deck p.58, "manual review"). */
  adjust: Adjustment | null
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
  declaredHeightM: null as number | null,
  derived: null as DerivedMeta | null,
  placement: null,
  adjust: null as Adjustment | null,
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
    sandbox: true,
    ingest: true,
    redesign: !!s.geo && s.photos.length > 0,
    reconstruct: !!s.geo,
    fit: !!s.mesh && !!s.geo,
    explore: !!s.mesh && !!s.geo && !!(s.placement || s.fit),
  }
}

export function completed(s: Pick<State, 'geo' | 'photos' | 'concept' | 'mesh' | 'fit' | 'placement'>): Record<StageId, boolean> {
  // A freely imported object brings its own site and never needs photos, so Ingest is complete
  // for it as soon as the outline exists.
  return {
    sandbox: false,
    ingest: !!s.geo && (s.photos.length > 0 || s.geo.source === 'derived'),
    redesign: !!s.concept, reconstruct: !!s.mesh, fit: !!(s.fit || s.placement), explore: false,
  }
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
  // A manual correction is expressed relative to one computed placement. If that placement is
  // replaced or invalidated the correction means nothing, so it is dropped rather than reapplied
  // to a different transform.
  // The derived (free-import) path has no manifest, so its correction is expressed against the
  // FitResult instead; changing the mesh or the site invalidates it for exactly the same reason.
  const staleAdjust = s.adjust && (invalid || s.placement !== prev.placement || inputsChanged)
  if (invalid || staleAdjust || (inputsChanged && s.fit)) {
    useStore.setState({
      ...(invalid ? { placement: null } : {}),
      ...(staleAdjust ? { adjust: null } : {}),
      ...(inputsChanged ? { fit: null, derived: null } : {}),
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
