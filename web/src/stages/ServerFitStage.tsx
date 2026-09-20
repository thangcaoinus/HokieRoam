import { useEffect, useRef, useState } from 'react'
import { NO_ADJUST, isAdjusted, useStore } from '../store'
import { exportUrl, getJob, requestFit } from '../lib/api'
import { fitRequest, placementMatches } from '../lib/placement'
import PlacedScene from '../components/PlacedScene'
import MatrixView from '../components/MatrixView'
import PlanEditor from '../components/PlanEditor'
import { EXAMPLE_PATH } from '../lib/cachedExample'

export default function ServerFitStage() {
  const s = useStore()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [raw, setRaw] = useState(false)
  const [camera, setCamera] = useState(0)
  const [review, setReview] = useState(false)
  const manual = isAdjusted(s.adjust)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const p = s.placement
  const mesh = s.mesh!, geo = s.geo!
  const cached = !!mesh.meta.exampleId || !!mesh.meta.bundle

  const run = async () => {
    const jobId = mesh.meta.jobId!
    setBusy(true); setError('')
    try {
      const result = await requestFit(jobId, fitRequest(geo, mesh))
      const current = useStore.getState()
      if (current.mesh !== mesh || current.geo !== geo || current.job?.job_id !== jobId) return
      if (!placementMatches(result, geo, mesh)) throw new Error('Placement does not match this asset and footprint. Reload the model and try again.')
      current.set({ placement: result, fit: null, job: { ...current.job, placement: result, stage: 'complete' } })
      current.log(`fit › server placement ${result.plan_fit} · IoU ${(result.selected.metrics.iou * 100).toFixed(1)}%`)
    } catch (e) {
      if (mounted.current) setError((e as Error).message)
    } finally { if (mounted.current) setBusy(false) }
  }

  const download = async () => {
    if (!p) return
    setError('')
    try {
      if (cached) {
        const a = document.createElement('a')
        a.href = s.bundle?.url ?? `${EXAMPLE_PATH}/bundle.zip`; a.download = s.bundle?.name ?? 'groundtruth-dds.zip'; a.click()
        return
      }
      // Another tab may have refitted this job. Never export a different matrix silently.
      const job = await getJob(mesh.meta.jobId!)
      if (JSON.stringify(job.placement) !== JSON.stringify(p)) throw new Error('The saved placement changed. Re-run placement before exporting.')
      const current = useStore.getState()
      if (current.placement !== p || current.mesh !== mesh) return
      const a = document.createElement('a')
      a.href = exportUrl(job.job_id); a.download = `groundtruth-${job.job_id}.zip`; a.click()
    } catch (e) { if (mounted.current) setError((e as Error).message) }
  }

  return <div className="stage">
    <div className="eyebrow">Stage 04 · Geographic placement</div>
    <h1 className="h1">Place your <em>design.</em></h1>
    <p className="lede">Fit the generated building to its footprint. The saved server placement is shared by exploration and export.</p>
    {mesh.meta.provider === 'fixture' && <div className="flag warn">Synthetic fixture model — not AI generation.</div>}
    {cached && <div className="flag warn">{s.bundle ? "Imported result · saved placement and provenance, checked against the model bytes." : "Completed real generation · simplified copy with recomputed placement. No new generation is running."}</div>}
    <div className="row wrap" style={{ marginBottom: 18 }}>
      {!cached && <button className="btn primary" disabled={busy} onClick={() => void run()}>{busy ? 'Calculating placement…' : p ? 'Re-run placement' : 'Fit building to footprint'}</button>}
      {p && <>
        <button className="btn primary" onClick={() => s.go('explore')}>Explore this design</button>
        <button className="btn" onClick={() => void download()}>Export model + placement</button>
      </>}
    </div>
    <label className="toggle" style={{ marginBottom: 16 }}>
      <input type="checkbox" checked={!!geo.identityConfirmed} disabled={cached || busy || geo.source !== 'osm'} onChange={(e) => s.set({ geo: { ...geo, identityConfirmed: e.target.checked } })} />
      I confirm this {geo.source === 'osm' ? 'OpenStreetMap' : 'synthetic demo'} footprint identifies the building in my photos
    </label>
    {error && <div className="err-text" role="alert">{error}</div>}
    {p ? <>
      {manual && <div className="flag warn" role="status" data-testid="manual-placement">
        Manually corrected — moved {Math.hypot(s.adjust!.dx, s.adjust!.dz).toFixed(1)} m and turned{' '}
        {(s.adjust!.dyaw * 180 / Math.PI).toFixed(1)}° from the computed placement. Explore shows this
        correction; the export and the verdict below still describe the computed result.
      </div>}
      <div className={`flag ${p.plan_fit === 'accepted' ? 'ok' : p.plan_fit === 'rejected' ? 'error' : 'warn'}`} role="status" data-testid="placement-status">
        Placement: {p.plan_fit}. {p.plan_fit === 'rejected' ? 'Outside the fit constraints; explore for inspection, not as an approved placement.' : p.plan_fit === 'review' ? 'Inspect the fit before using this result.' : 'Plan fit passed.'} Heading unverified · {p.height === 'inferred' ? 'height inferred from the mesh' : `height ${p.request.measured_height_m?.toFixed(1)} m from the ${p.provenance.source.toUpperCase()} record`}.
      </div>
      <div className="card" style={{ padding: 6, marginTop: 16 }}>
        <div className="row" style={{ padding: 10 }}>
          <button className="btn sm" onClick={() => setRaw(!raw)}>{raw ? 'Show fitted model' : 'Show raw model'}</button>
          <button className="btn sm" onClick={() => setCamera((n) => n + 1)}>Reset camera</button>
          <span className="dimmer">{raw ? 'Unchanged source coordinates' : 'Orange: footprint · green: conservative mesh hull'}</span>
        </div>
        <div className="viewer"><PlacedScene key={camera} asset={mesh} placement={p} raw={raw} adjust={s.adjust} /></div>
      </div>
      <div className="card card-pad" style={{ marginTop: 18 }}>
        <div className="row wrap" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <strong>Adjust placement by hand</strong>
            <div className="dimmer" style={{ fontSize: 12 }}>
              For when the measured fit is wrong and you can see why. Reviewed, not certified.
            </div>
          </div>
          <div className="row">
            {manual && <button className="btn sm" onClick={() => { s.set({ adjust: null }); s.log('fit › manual correction cleared; showing the computed placement') }}>Reset to computed</button>}
            <button className="btn sm" onClick={() => setReview(!review)}>{review ? 'Hide' : 'Adjust'}</button>
          </div>
        </div>
        {review && <div style={{ marginTop: 14 }}>
          <PlanEditor placement={p} adjust={s.adjust ?? NO_ADJUST}
            onChange={(a) => s.set({ adjust: a })} />
        </div>}
      </div>

      <details className="card card-pad" style={{ marginTop: 18 }}>
        <summary>Inspect placement, metrics and transform</summary>
        <div className="stats" style={{ marginTop: 16 }}>
          {([['Footprint IoU', `${(p.selected.metrics.iou * 100).toFixed(1)}%`], ['Coverage', `${(p.selected.metrics.coverage * 100).toFixed(1)}%`], ['Spill', `${p.selected.metrics.spill_area_m2.toFixed(2)} m²`], ['Neighbor overlap', `${p.selected.metrics.neighbor_overlap_m2.toFixed(2)} m²`]]).map(([k, v]) => <div className="stat" key={k}><div className="v">{v}</div><div className="k">{k}</div></div>)}
        </div>
        <p>Plan scale: {p.selected.scale.toFixed(3)}{p.selected.scale_y ? ` · Vertical scale: ${p.selected.scale_y.toFixed(3)} (from the recorded height, not the plan fit)` : ' · Vertical scale: uniform'} · Yaw: {(p.selected.yaw_radians * 180 / Math.PI).toFixed(1)}° · Neighbors: {p.neighbor_check}</p>
        <p className="dimmer">Fitted size: {p.fitted_dimensions_m.map((v) => v.toFixed(1)).join(' × ')} m (length × height × width)</p>
        <p>Source: {p.provenance.source} / {p.provenance.feature_id} · Sponsor world: not integrated</p>
        <MatrixView m={p.selected.matrix_column_major} />
        <p className="dimmer">Column-major matrix applied once to the displayed GLB. The export includes this manifest and {s.bundle ? 'the unchanged imported model and provenance' : cached ? 'the simplified model with its derivation record' : 'the original model'}.</p>
        {p.warnings.map((warning) => <div className="flag warn" key={warning}>{warning}</div>)}
      </details>
    </> : <div className="card card-pad">{cached ? 'The footprint changed. Return to Ingest and reopen the saved ZIP or completed example to restore its saved placement, or start a new project.' : 'Run placement to inspect the fit and open the design in Explore. No generation credits are used.'}</div>}
  </div>
}
