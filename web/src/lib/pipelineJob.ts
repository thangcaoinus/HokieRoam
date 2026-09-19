// Drives one Pipeline API job from the UI (work-split.md P2). Only used when VITE_API_BASE is set;
// with it unset the stages keep their local simulation path.
//
// One `pipeline` job covers both Redesign and Reconstruct: the server runs redesign → reconstruct
// in a single job, so the concept and the mesh share one provenance record and one export bundle.
// The Redesign stage starts the job; the Reconstruct stage re-attaches to the same job.
//
// Money rules this file exists to keep:
// - The Idempotency-Key is derived from the inputs (photo bytes + prompt + strength) and persisted
//   BEFORE the POST. A retried click, or a reload that lost the response, re-sends the same key and
//   the server returns the job it already has instead of paying for a second generation.
// - Only an explicit "Regenerate" on a finished job with identical inputs bumps the attempt counter
//   and therefore the key.
// - Reloading never POSTs. It re-attaches with GET, which never starts work on the server.
// - `submission-unknown` is terminal. Nothing here retries past it.
import {
  apiConfigured,
  artifactUrl,
  createJob,
  getJob,
  health,
  isTerminal,
  pollJob,
  ApiError,
  type JobView,
} from './api'
import type { GeoResult } from './geo'
import { loadMeshUrl } from './reconstruct'
import { SESSION_KEY, useStore, type StageId } from '../store'

// ---------------------------------------------------------------------------
// Session persistence (localStorage is enough — work-split.md P2)
// ---------------------------------------------------------------------------


interface Session {
  jobId: string | null
  /** sha256 of the inputs behind the current key; see `jobKey`. */
  fingerprint: string | null
  attempt: number
  address: string
  geo: GeoResult | null
  presetId: string
  prompt: string
  strength: number
  stage: StageId
}

function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null
  }
}

function writeSession(patch: Partial<Session>) {
  const s = useStore.getState()
  const prev = readSession()
  const next: Session = {
    jobId: prev?.jobId ?? null,
    fingerprint: prev?.fingerprint ?? null,
    attempt: prev?.attempt ?? 0,
    address: s.address,
    geo: s.geo,
    presetId: s.presetId,
    prompt: s.prompt,
    strength: s.strength,
    stage: s.stage,
    ...patch,
  }
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(next))
  } catch {
    // Private mode or quota: the job still runs, only reload re-attachment is lost.
  }
}

// Keep the small, cheap parts of the project in the session as they change, so a refresh
// mid-job comes back to the same address, footprint and stage. Photos and meshes are not stored
// here — they come back from the job's own artifacts.
let persisting = false
function startPersisting() {
  if (persisting || !apiConfigured()) return
  persisting = true
  useStore.subscribe((s, prev) => {
    // "New project" clears the job (store.reset also drops the saved session): stop following it.
    if (prev.job && !s.job) { stopFollowing(); modelLoadedFor = null; return }
    if (
      s.address !== prev.address || s.geo !== prev.geo || s.presetId !== prev.presetId ||
      s.prompt !== prev.prompt || s.strength !== prev.strength || s.stage !== prev.stage
    ) writeSession({})
  })
}

// ---------------------------------------------------------------------------
// Idempotency key
// ---------------------------------------------------------------------------

async function sha256Hex(parts: (ArrayBuffer | string)[]): Promise<string> {
  const enc = new TextEncoder()
  const chunks = parts.map((p) => (typeof p === 'string' ? enc.encode(p) : new Uint8Array(p)))
  const all = new Uint8Array(chunks.reduce((n, c) => n + c.length + 1, 0))
  let o = 0
  for (const c of chunks) { all.set(c, o); o += c.length + 1 } // +1: a zero separator byte
  const digest = await crypto.subtle.digest('SHA-256', all)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const jobKey = (fingerprint: string, attempt: number) => `gt-${fingerprint.slice(0, 32)}-a${attempt}`

// ---------------------------------------------------------------------------
// Following a job
// ---------------------------------------------------------------------------

let follower: AbortController | null = null
/** job id whose model is loaded (or loading) into the store, so a poll does not reload it. */
let modelLoadedFor: string | null = null

function stopFollowing() {
  follower?.abort()
  follower = null
}

/** Mirror one server snapshot into the store. Only reports what the server says. */
function applyJob(job: JobView) {
  const s = useStore.getState()
  const prev = s.job?.job_id === job.job_id ? s.job : null
  // A fresh snapshot proves contact, so any earlier "lost contact" message is stale.
  const patch: Partial<ReturnType<typeof useStore.getState>> = { job, jobError: null }

  const concept = artifactUrl(job, 'concept')
  if (concept && s.concept !== concept) {
    patch.concept = concept
    if (!prev?.artifacts.concept) s.log(`job › concept stored on server (${job.provider})`, 'ok')
  }
  const source = artifactUrl(job, 'source')
  if (source && s.photos.length === 0) patch.photos = [source]

  if (prev && (prev.stage !== job.stage || prev.status !== job.status)) {
    s.log(`job › ${job.stage} · ${job.status}`, job.status === 'failed' || job.status === 'submission-unknown' ? 'warn' : 'info')
  }
  if (job.status === 'failed' && prev?.status !== 'failed') s.log(`job › failed: ${job.error ?? 'no reason given'}`, 'warn')
  if (job.status === 'submission-unknown' && prev?.status !== 'submission-unknown') {
    s.log('job › submission-unknown — reconcile in the provider account; not retried', 'warn')
  }
  useStore.setState(patch)

  if (artifactUrl(job, 'model') && modelLoadedFor !== job.job_id) void loadModel(job)
}

async function loadModel(job: JobView) {
  const url = artifactUrl(job, 'model')
  if (!url) return
  modelLoadedFor = job.job_id
  try {
    const mesh = await loadMeshUrl(url, {
      source: `pipeline job ${job.job_id.slice(0, 8)} · ${job.provider}`,
      jobId: job.job_id,
      provider: job.provider,
    })
    // A newer job may have started while the GLB was downloading.
    if (useStore.getState().job?.job_id !== job.job_id) return
    useStore.setState({ mesh, fit: null })
    useStore.getState().log(`job › model loaded from server (${mesh.meta.triangles.toLocaleString()} tris)`, 'ok')
  } catch (e) {
    modelLoadedFor = null
    useStore.getState().log(`job › could not load model: ${(e as Error).message}`, 'warn')
  }
}

function follow(jobId: string) {
  stopFollowing()
  const ctl = new AbortController()
  follower = ctl
  pollJob(jobId, { onUpdate: applyJob, intervalMs: 1500, signal: ctl.signal })
    .then((job) => {
      if (job.status === 'succeeded') useStore.getState().log(`job › ${job.job_id.slice(0, 8)} succeeded`, 'ok')
    })
    .catch((e) => {
      // Check the signal, not the error: api.ts wraps an aborted fetch as "unreachable".
      if (ctl.signal.aborted) return
      // Lost the server mid-poll. Say so; do not guess at the job's state.
      useStore.setState({ jobError: `Lost contact with the pipeline API: ${(e as Error).message}` })
      useStore.getState().log(`job › polling stopped: ${(e as Error).message}`, 'warn')
    })
    .finally(() => {
      if (follower === ctl) follower = null
    })
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/**
 * Start (or re-attach to) the generation job for the current photo + prompt + strength.
 * `regenerate` asks for a fresh generation with identical inputs; it is only honoured once the
 * current job has finished, because a running job must not be abandoned and paid for twice.
 */
export async function startJob({ regenerate = false } = {}) {
  const s = useStore.getState()
  const source = s.photos[s.primaryPhoto]
  if (!source) throw new Error('No source photo')
  useStore.setState({ jobError: null })

  const image = await (await fetch(source)).blob()
  const fingerprint = await sha256Hex([await image.arrayBuffer(), s.prompt, s.strength.toFixed(3)])

  const session = readSession()
  let attempt = session?.fingerprint === fingerprint ? session.attempt : 0
  const current = s.job
  if (regenerate && current && isTerminal(current.status) && session?.fingerprint === fingerprint) attempt += 1

  const key = jobKey(fingerprint, attempt)
  // Persist the key BEFORE the request: if the response is lost, the next click re-sends it.
  writeSession({ fingerprint, attempt })

  const startedAt = Date.now()
  s.log(`job › POST /v1/jobs (key ${key.slice(0, 14)}…)`)
  let job: JobView
  try {
    job = await createJob({
      image,
      prompt: s.prompt,
      strength: s.strength,
      idempotencyKey: key,
      kind: 'pipeline',
      filename: image.type === 'image/jpeg' ? 'source.jpg' : 'source.png',
    })
  } catch (e) {
    const msg = e instanceof ApiError && e.status === 0
      ? `Pipeline API unreachable — nothing was submitted. ${e.message}`
      : (e as Error).message
    useStore.setState({ jobError: msg })
    s.log(`job › create failed: ${msg}`, 'warn')
    return
  }

  const replayed = Date.parse(job.created_at) < startedAt - 2000
  s.log(replayed ? `job › same inputs → re-attached to existing job ${job.job_id.slice(0, 8)}` : `job › ${job.job_id.slice(0, 8)} accepted (${job.provider})`, 'ok')
  if (s.job?.job_id !== job.job_id) {
    modelLoadedFor = null
    useStore.setState({ concept: null, mesh: null, fit: null })
  }
  writeSession({ jobId: job.job_id })
  applyJob(job)
  if (!isTerminal(job.status)) follow(job.job_id)
}

/** Probe /v1/health for the header chip. Never throws. */
export async function probeHealth() {
  if (!apiConfigured()) return
  useStore.setState({ api: { state: 'checking' } })
  try {
    const h = await health(AbortSignal.timeout(4000))
    useStore.setState({ api: { state: 'up', provider: h.provider, live: h.live } })
  } catch {
    useStore.setState({ api: { state: 'down' } })
  }
}

/** On page load: restore the saved project and re-attach to its job. Never POSTs. */
let resumed = false
export async function resumeSession() {
  // Once per page load (React StrictMode runs mount effects twice in development).
  if (!apiConfigured() || resumed) return
  resumed = true
  const session = readSession()
  startPersisting()
  if (!session) return
  const s = useStore.getState()
  s.set({
    address: session.address,
    geo: session.geo,
    presetId: session.presetId,
    prompt: session.prompt,
    strength: session.strength,
  })
  if (!session.jobId) {
    if (session.geo) s.set({ stage: 'ingest' })
    return
  }
  let job: JobView
  try {
    job = await getJob(session.jobId)
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      s.log(`job › saved job ${session.jobId.slice(0, 8)} is not on this server any more`, 'warn')
      writeSession({ jobId: null })
    } else {
      useStore.setState({ jobError: `Could not re-attach to job ${session.jobId.slice(0, 8)}: ${(e as Error).message}` })
      s.log(`job › re-attach failed: ${(e as Error).message}`, 'warn')
    }
    return
  }
  s.log(`job › re-attached to ${job.job_id.slice(0, 8)} after reload (${job.status})`, 'ok')
  applyJob(job)
  // Return to the stage the user was on, as long as its inputs came back with the job.
  const back: StageId = session.stage === 'redesign' || session.stage === 'reconstruct' ? session.stage
    : artifactUrl(job, 'model') ? 'reconstruct' : 'redesign'
  s.set({ stage: session.geo ? back : 'ingest' })
  if (!isTerminal(job.status)) follow(job.job_id)
}

/** Re-attach to the current job after polling lost the server. A GET only — never a new job. */
export async function reattach() {
  const job = useStore.getState().job
  if (!job) return
  useStore.setState({ jobError: null })
  try {
    applyJob(await getJob(job.job_id))
    if (!isTerminal(useStore.getState().job!.status)) follow(job.job_id)
  } catch (e) {
    useStore.setState({ jobError: `Still cannot reach the pipeline API: ${(e as Error).message}` })
  }
}
