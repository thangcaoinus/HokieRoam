import { promptError } from './creativePrompt'
// Client for the Groundtruth pipeline API — the frozen v1 contract (work-split.md P0).
//
// The types below mirror `server/app/schemas.py` character for character. If a name changes on one
// side it changes on the other, in the same commit: these two files are the shared contract and
// every other lane codes against them.
//
// This is an ASYNCHRONOUS JOB API, not the synchronous blob endpoints the UI originally assumed.
// Meshy generation takes minutes, so a blocking request would time out. `createJob` returns a job
// id promptly and `pollJob` follows it to a terminal state.

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Backend origin, or '' when unset — in which case the UI runs its local simulation path. */
export const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '')

/** Drives the header's honesty chip: 'Pipeline API connected' vs 'Local AI simulation'. */
export const apiConfigured = () => API_BASE.length > 0

function base(): string {
  if (!API_BASE) throw new ApiError(0, 'VITE_API_BASE is not set; the pipeline API is unavailable')
  return API_BASE
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly detail?: unknown) {
    super(message)
    this.name = 'ApiError'
  }
}

// ---------------------------------------------------------------------------
// Coordinate frames — the single easiest thing in this repo to get backwards
// ---------------------------------------------------------------------------

/**
 * A point in PLAN coordinates: (East, North) in metres. This is what every polygon in the API
 * carries. It is NOT the scene frame.
 *
 * Scene frame is X = East, Y = Up, Z = South (three.js convention, so -z points north).
 * Plan coordinates are therefore (East, North) = (scene.x, -scene.z).
 *
 * The same flip appears as `* [1, -1]` in `server/app/geometry/fit.py` and as `-z` in
 * `web/src/lib/fit.ts`. All three must agree. Do not "simplify" the sign away.
 */
export type PlanPoint = [number, number]

/** Scene-frame point, structurally compatible with `geo.ts`'s `V2`. */
export interface ScenePoint {
  x: number
  z: number
}

export const planFromScene = (p: ScenePoint): PlanPoint => [p.x, -p.z]
export const sceneFromPlan = ([east, north]: PlanPoint): ScenePoint => ({ x: east, z: -north })
export const planRing = (ring: ScenePoint[]): PlanPoint[] => ring.map(planFromScene)
export const sceneRing = (ring: PlanPoint[]): ScenePoint[] => ring.map(sceneFromPlan)

// ---------------------------------------------------------------------------
// Contract types (responses) — every field required, exactly as the server sends it
// ---------------------------------------------------------------------------

export type JobKind = 'redesign' | 'reconstruct' | 'pipeline'
export type JobStatus =
  | 'queued'
  | 'submitting'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'submission-unknown'
export type JobStage = 'redesign' | 'reconstruct' | 'fit' | 'complete'
/**
 * Meshy's reconstruction is a sparse-view model taking 1-4 views of the same building. A job
 * therefore carries up to four source photos and the four styled concepts derived from them.
 * View 1 keeps the unsuffixed name so single-view callers are unaffected.
 */
export const MAX_VIEWS = 4
export type ArtifactName =
  | 'source' | 'source_2' | 'source_3' | 'source_4'
  | 'concept' | 'concept_2' | 'concept_3' | 'concept_4'
  | 'model'

/** Artifact name for view `index` (0-based). View 0 keeps the unsuffixed legacy name. */
export const viewArtifact = (kind: 'source' | 'concept', index: number): ArtifactName =>
  (index === 0 ? kind : `${kind}_${index + 1}`) as ArtifactName

export type UpAxis = 'Y' | 'Z'
export type ProvenanceSource = 'county-gis' | 'osm' | 'user-provided' | 'synthetic'
export type PlanFit = 'accepted' | 'review' | 'rejected'
export type NeighborCheck = 'performed' | 'not-provided'

export interface Polygon2D {
  exterior: PlanPoint[]
  holes: PlanPoint[][]
}

export interface LocalFrame {
  origin_longitude: number
  origin_latitude: number
  origin_height_m: number
  convention: 'X=east,Y=up,Z=south'
  ground_mode: 'flat-assumed'
}

export interface Provenance {
  source: ProvenanceSource
  feature_id: string
  source_url: string | null
  /** False downgrades an otherwise-accepted fit to 'review'. A human confirms this, not code. */
  identity_confirmed: boolean
}

export interface FitRequest {
  footprint: Polygon2D
  frame: LocalFrame
  provenance: Provenance
  neighbors: Polygon2D[] | null
  up_axis: UpAxis
  unit_scale: number
  min_iou: number
  numerical_tolerance_m: number
  /** Plan area the best placement may spill outside the footprint before it is unusable.
   *  A real roof eave always spills, so exact containment is reported, never enforced. */
  max_spill_fraction: number
  /** An independently recorded building height (e.g. OSM `height`). null means the vertical
   *  scale follows the plan fit, which is proportion-preserving but inherits its error. */
  measured_height_m: number | null
  /** How far vertical scale may depart from the uniform plan scale before the recorded height is
   *  reported rather than applied. Deck p.58 prefers proportion-preserving uniform scaling. */
  max_height_correction: number
}

export interface FitMetrics {
  iou: number
  coverage: number
  spill_fraction: number
  spill_area_m2: number
  contained: boolean
  neighbor_overlap_m2: number
}

export interface FitCandidate {
  index: number
  yaw_radians: number
  scale: number
  /** null means vertical scale equals `scale` (uniform, proportion-preserving). */
  scale_y: number | null
  /** 4x4, COLUMN-major — feed straight into THREE.Matrix4.fromArray, which expects column-major. */
  matrix_column_major: number[]
  fitted_proxy: Polygon2D
  metrics: FitMetrics
}

export interface PlacementManifest {
  schema_version: 1
  asset_sha256: string
  applies_to: 'unchanged-source-glb-asset-root'
  frame: LocalFrame
  provenance: Provenance
  request: FitRequest
  selected: FitCandidate
  candidates: FitCandidate[]
  plan_fit: PlanFit
  // The next four are claims about what was and was not verified. Surface them on screen; they are
  // the honest edges a judge will probe, not weaknesses to hide.
  heading: 'ambiguous'
  height: 'measured' | 'source-record' | 'inferred'
  proxy: 'projected-convex-hull'
  neighbor_check: NeighborCheck
  source_dimensions_m: [number, number, number]
  fitted_dimensions_m: [number, number, number]
  warnings: string[]
  world_registration: 'not-integrated'
}

export interface JobView {
  schema_version: 1
  job_id: string
  kind: JobKind
  provider: string
  status: JobStatus
  stage: JobStage
  provider_task_id: string | null
  provider_tasks: Record<string, string>
  /** 0-100 from the provider, or null when it reports none. Render this; never fake it. */
  progress: number | null
  target_polycount?: number | null
  /** { artifact name -> url path on this server }. Resolve with `artifactUrl`. */
  artifacts: Partial<Record<ArtifactName, string>>
  placement: PlacementManifest | null
  error: string | null
  warnings: string[]
  created_at: string
  updated_at: string
}

export interface HealthView {
  schema_version: 1
  provider: string
  /** True only for a keyed paid provider. The fixture adapter is synthetic and reports false. */
  live: boolean
  submissions_used: number
}

// ---------------------------------------------------------------------------
// Contract types (request bodies) — server-side defaults are optional here
// ---------------------------------------------------------------------------

export interface Polygon2DInit {
  exterior: PlanPoint[]
  holes?: PlanPoint[][]
}

export interface LocalFrameInit {
  origin_longitude: number
  origin_latitude: number
  origin_height_m?: number
  convention?: 'X=east,Y=up,Z=south'
  ground_mode?: 'flat-assumed'
}

export interface ProvenanceInit {
  source: ProvenanceSource
  feature_id: string
  source_url?: string | null
  identity_confirmed?: boolean
}

/**
 * Body for `requestFit`. `FitRequest` is echoed back inside `PlacementManifest.request`, so the
 * full type stays required; this one mirrors the pydantic defaults instead.
 */
export interface FitRequestInit {
  footprint: Polygon2DInit
  frame: LocalFrameInit
  provenance: ProvenanceInit
  /** null/absent means "no neighbour check was supplied" and the manifest says so. */
  neighbors?: Polygon2DInit[] | null
  up_axis?: UpAxis
  unit_scale?: number
  min_iou?: number
  numerical_tolerance_m?: number
  max_spill_fraction?: number
  measured_height_m?: number | null
  max_height_correction?: number
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${base()}${path}`, init)
  } catch (cause) {
    if (cause instanceof ApiError) throw cause
    throw new ApiError(0, `pipeline api unreachable (${(cause as Error).message})`)
  }
  const body = await response.text()
  let parsed: unknown
  try {
    parsed = body ? JSON.parse(body) : null
  } catch {
    parsed = body
  }
  if (!response.ok) {
    const detail = (parsed as { detail?: unknown } | null)?.detail ?? parsed
    const message = typeof detail === 'string' ? detail : `${path} failed (${response.status})`
    throw new ApiError(response.status, message, detail)
  }
  return parsed as T
}

export const health = (signal?: AbortSignal) => request<HealthView>('/v1/health', { signal })

export interface CreateJobInput {
  /**
   * 1-4 photos of the SAME building from different angles. One photo yields a flat facade with no
   * depth - the model infers volume from the spread of views. The server rejects more than
   * MAX_VIEWS rather than silently dropping any.
   */
  images: Blob[]
  prompt: string
  /** 0..1. Meshy has no numeric strength knob; the server folds it into the prompt text. */
  strength: number
  targetPolycount?: number
  /**
   * Stable per logical request, and supplied by the caller on purpose: a retried POST that
   * generated its own key would become a second paid generation. Reuse the key to re-attach.
   */
  idempotencyKey: string
  kind?: JobKind
  /** Optional per-image filenames, positionally matched to `images`. */
  filenames?: string[]
  signal?: AbortSignal
}

/** Start a job. Resolves with a 202 JobView as soon as the server has persisted it. */
export function createJob(input: CreateJobInput): Promise<JobView> {
  if (input.images.length < 1) throw new ApiError(0, 'At least one photo is required')
  if (input.images.length > MAX_VIEWS) {
    throw new ApiError(0, `At most ${MAX_VIEWS} photos are supported (Meshy's limit)`)
  }
  const issue = promptError(input.prompt)
  if (issue) throw new ApiError(0, issue)
  const form = new FormData()
  // Repeated `image` parts, in view order; the server maps them to source, source_2, ...
  input.images.forEach((blob, i) => {
    form.append('image', blob, input.filenames?.[i] ?? `source-${i + 1}.png`)
  })
  form.append('prompt', input.prompt)
  form.append('strength', String(input.strength))
  if (input.targetPolycount !== undefined) form.append('target_polycount', String(input.targetPolycount))
  form.append('kind', input.kind ?? 'pipeline')
  return request<JobView>('/v1/jobs', {
    method: 'POST',
    body: form,
    headers: { 'Idempotency-Key': input.idempotencyKey },
    signal: input.signal,
  })
}

export const listJobs = (signal?: AbortSignal) => request<JobView[]>('/v1/jobs', { signal })

export const getJob = (jobId: string, signal?: AbortSignal) =>
  request<JobView>(`/v1/jobs/${encodeURIComponent(jobId)}`, { signal })

export const requestFit = (jobId: string, body: FitRequestInit, signal?: AbortSignal) =>
  request<PlacementManifest>(`/v1/jobs/${encodeURIComponent(jobId)}/fit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })

/**
 * Absolute URL for one stored artifact, or null when the job has not produced it yet.
 *
 * Takes the JobView rather than a bare id so the server's own `artifacts` map is the source of
 * truth: a missing entry means "not ready", and returning null stops callers fetching a 404.
 */
export function artifactUrl(job: JobView, name: ArtifactName): string | null {
  const path = job.artifacts[name]
  if (!path) return null
  return path.startsWith('http') ? path : `${base()}${path.startsWith('/') ? '' : '/'}${path}`
}

/** Zip bundle: unchanged artifacts, their sha256s, and the placement manifest. */
export const exportUrl = (jobId: string) =>
  `${base()}/v1/jobs/${encodeURIComponent(jobId)}/export`

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------

const TERMINAL: readonly JobStatus[] = ['succeeded', 'failed', 'submission-unknown']

export const isTerminal = (status: JobStatus) => TERMINAL.includes(status)

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('aborted', 'AbortError'))
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    function onAbort() {
      clearTimeout(timer)
      reject(new DOMException('aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export interface PollOptions {
  /** Called for every snapshot, including the first. Render the job's real stage and progress. */
  onUpdate?: (job: JobView) => void
  intervalMs?: number
  signal?: AbortSignal
}

/**
 * Follow a job to a terminal status.
 *
 * Polling never starts a new generation — it only reads the stored provider_task_id — so it is safe
 * to call after a page reload to re-attach to a job that is already running and already paid for.
 * Resolves on 'succeeded', 'failed' AND 'submission-unknown'; the last is not an error to retry
 * past, it means the remote task may have been accepted and a human must reconcile it.
 */
export async function pollJob(jobId: string, options: PollOptions = {}): Promise<JobView> {
  const { onUpdate, intervalMs = 2000, signal } = options
  for (;;) {
    const job = await getJob(jobId, signal)
    onUpdate?.(job)
    if (isTerminal(job.status)) return job
    await delay(intervalMs, signal)
  }
}
