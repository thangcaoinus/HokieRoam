// One place to switch between the cached examples, because typing ?example=<id> is not a demo.
//
// The five Burruss rows share one building, one set of four photographs and one authoritative
// footprint (OSM way/32963472) and differ only by the prompt, so putting their IoU side by side is
// a measurement of what each restyle cost the geometry. That comparison is the reason this exists;
// it is not a gallery.
//
// Verdict and IoU come from each example's own manifest via exampleSummaries(), never from a table
// in the source. A measurement copied into a second place is a second thing that can go stale, and
// this repo has already shipped that bug once with the example's title and photo filename.
import { useEffect, useState } from 'react'
import {
  EXAMPLE_IDS, EXAMPLE_POSTERS, exampleSummaries, loadCompletedExample,
  type ExampleId, type ExampleSummary,
} from '../lib/cachedExample'
import { useStore } from '../store'

const BURRUSS = EXAMPLE_IDS.filter((id) => EXAMPLE_POSTERS[id].title === 'Burruss Hall')
const OTHERS = EXAMPLE_IDS.filter((id) => !BURRUSS.includes(id))

/** accepted / review / rejected map onto the survey inks already defined for exactly this. */
const TONE: Record<string, string> = { accepted: 'ok', review: 'warn', rejected: 'err' }

export default function ExamplePicker({ variant }: { variant: 'gallery' | 'strip' }) {
  const current = useStore((s) => s.example?.id)
  const [summaries, setSummaries] = useState<ExampleSummary[] | null>(null)
  const [busy, setBusy] = useState<ExampleId | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    // A failed read must not blank the picker: the labels are static, only the numbers are fetched.
    exampleSummaries().then((s) => live && setSummaries(s)).catch(() => live && setSummaries([]))
    return () => { live = false }
  }, [])

  const open = async (id: ExampleId) => {
    if (id === current || busy) return
    setBusy(id); setError('')
    try { await loadCompletedExample(id) }
    catch (e) { setError((e as Error).message) }
    finally { setBusy(null) }
  }

  const row = (id: ExampleId) => {
    const poster = EXAMPLE_POSTERS[id]
    const found = summaries?.find((s) => s.id === id)
    return (
      <button
        key={id}
        className={`exrow ${id === current ? 'active' : ''}`}
        disabled={!!busy}
        onClick={() => void open(id)}
      >
        <span className="exrow-style">{poster.style}</span>
        {variant === 'gallery' && <span className="exrow-title">{poster.title}</span>}
        {found && <span className={`exrow-fit ${TONE[found.verdict] ?? ''}`}>{found.verdict}</span>}
        <span className="exrow-iou">{busy === id ? '…' : found ? `${(found.iou * 100).toFixed(1)}%` : ''}</span>
      </button>
    )
  }

  if (variant === 'strip') {
    return (
      <div className="exstrip">
        {BURRUSS.map(row)}
        {OTHERS.map(row)}
        {error && <span role="alert" className="err-text">{error}</span>}
      </div>
    )
  }

  return (
    <div className="exgrid">
      <div className="exgrid-head">
        One building, five prompts — same four photographs, same footprint
      </div>
      {BURRUSS.map(row)}
      <div className="exgrid-head">Other buildings</div>
      {OTHERS.map(row)}
      {error && <div role="alert" className="err-text" style={{ padding: '8px 14px' }}>{error}</div>}
    </div>
  )
}
