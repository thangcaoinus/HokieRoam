// Live status of the Pipeline API job (work-split.md P2). Renders ONLY what the server reports —
// stage, status, progress — never a timed animation. Progress the provider does not report is
// shown as an indeterminate bar, not a guessed percentage.
import { AlertTriangle, Check, Download, RefreshCw, XCircle } from 'lucide-react'
import { exportUrl, isTerminal, type JobView } from '../lib/api'
import { reattach } from '../lib/pipelineJob'
import { useStore } from '../store'

type Step = 'redesign' | 'reconstruct'
const STEPS: { id: Step; label: string; artifact: 'concept' | 'model' }[] = [
  { id: 'redesign', label: 'Redesign → concept image', artifact: 'concept' },
  { id: 'reconstruct', label: 'Reconstruct → GLB mesh', artifact: 'model' },
]

function stepState(job: JobView, step: Step, artifact: 'concept' | 'model') {
  if (job.artifacts[artifact]) return 'done'
  if (job.stage !== step) return STEPS.findIndex((s) => s.id === step) < STEPS.findIndex((s) => s.id === job.stage) ? 'done' : 'pending'
  if (job.status === 'failed') return 'failed'
  if (job.status === 'submission-unknown') return 'unknown'
  return 'active'
}

export function ProgressBar({ job }: { job: JobView }) {
  const known = job.status === 'running' && job.progress !== null
  return (
    <div className="bar" style={{ marginTop: 8, position: 'relative' }}>
      {known ? (
        <i style={{ width: `${job.progress}%` }} />
      ) : (
        // Indeterminate: queued/submitting, or the provider reports no percentage.
        <i style={{ width: '100%', background: 'linear-gradient(90deg, transparent, var(--ember), transparent)', animation: 'sweep 1.3s linear infinite' }} />
      )}
    </div>
  )
}

export const statusText = (job: JobView) =>
  job.status === 'running' && job.progress !== null ? `running · ${job.progress}%` : job.status

export default function JobPanel({ focus }: { focus: Step }) {
  const job = useStore((s) => s.job)
  const jobError = useStore((s) => s.jobError)
  if (!job) {
    return jobError ? <div className="flag error"><XCircle size={16} /><span>{jobError}</span></div> : null
  }
  const synthetic = job.provider === 'fixture'

  return (
    <div className="card card-pad">
      <div className="card-title">
        <span className="n">JOB</span> Pipeline job
        <span className="right row" style={{ gap: 6 }}>
          <span className="chip mono" style={{ height: 22 }} title={job.job_id}>{job.job_id.slice(0, 8)}</span>
          <span className="chip mono" style={{ height: 22, color: synthetic ? 'var(--warn)' : 'var(--ok)' }}>
            {synthetic ? 'fixture · synthetic' : job.provider}
          </span>
        </span>
      </div>

      <ul className="plist" style={{ marginTop: 0 }}>
        {STEPS.map((st) => {
          const state = stepState(job, st.id, st.artifact)
          return (
            <li key={st.id} className={state === 'done' ? 'done' : state === 'pending' ? '' : 'on'} style={{ display: 'block' }}>
              <div className="row" style={{ gap: 10 }}>
                {state === 'done' ? <Check size={14} />
                  : state === 'active' ? <span className="spinner" />
                  : state === 'failed' ? <XCircle size={14} color="var(--err)" />
                  : state === 'unknown' ? <AlertTriangle size={14} color="var(--warn)" />
                  : <span style={{ width: 14 }} />}
                <span style={{ fontWeight: st.id === focus ? 600 : 400 }}>{st.label}</span>
                {state === 'active' && <span className="mono dimmer" style={{ marginLeft: 'auto', fontSize: 11.5 }}>{statusText(job)}</span>}
              </div>
              {state === 'active' && <ProgressBar job={job} />}
            </li>
          )
        })}
      </ul>

      {job.status === 'submission-unknown' && (
        <div className="flag warn" style={{ marginTop: 14, borderColor: 'rgba(255,209,102,.35)' }}>
          <AlertTriangle size={16} />
          <span>
            <b>Submission status unknown.</b> The provider may already have accepted — and billed — this
            request, but no task id was recorded. It will not be retried automatically. Check the provider
            account and reconcile it by hand before starting another generation.
            {job.error && <div className="dimmer mono" style={{ fontSize: 11.5, marginTop: 6 }}>{job.error}</div>}
          </span>
        </div>
      )}
      {job.status === 'failed' && (
        <div className="flag error" style={{ marginTop: 14 }}>
          <XCircle size={16} />
          <span>{job.error ?? 'The job failed without a reason.'}</span>
        </div>
      )}
      {jobError && (
        <div className="flag error" style={{ marginTop: 14 }}>
          <XCircle size={16} />
          <span style={{ flex: 1 }}>{jobError}</span>
          {!isTerminal(job.status) && (
            // A GET, not a new job: re-attaching can never start or pay for a generation.
            <button className="btn sm" onClick={() => void reattach()}><RefreshCw size={13} /> Re-attach</button>
          )}
        </div>
      )}
      {job.warnings.map((w) => (
        <div key={w} className="flag warn" style={{ marginTop: 10 }}><AlertTriangle size={16} /><span>{w}</span></div>
      ))}

      {Object.keys(job.artifacts).length > 1 && (
        <a className="btn sm" style={{ marginTop: 14, textDecoration: 'none' }} href={exportUrl(job.job_id)}>
          <Download size={13} /> Export bundle (.zip)
        </a>
      )}
    </div>
  )
}
