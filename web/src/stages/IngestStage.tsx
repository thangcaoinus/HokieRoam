import { useRef, useState } from 'react'
import { ArrowRight, ImagePlus, Loader2, MapPin, Sparkles, X } from 'lucide-react'
import { useStore } from '../store'
import { registerBucket, resolveAddress } from '../lib/geo'
import { samplePhoto } from '../lib/redesign'
import MapView from '../components/MapView'
import { EXAMPLE_PATH, loadCompletedExample } from '../lib/cachedExample'
import { MAX_VIEWS } from '../lib/api'

const SUGGESTIONS = ['Newman Library, Blacksburg, VA', 'Burruss Hall, Blacksburg, VA', 'Flatiron Building, New York', 'Nebraska State Capitol, Lincoln']

export default function IngestStage() {
  const s = useStore()
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  const [exampleBusy, setExampleBusy] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const bundleRef = useRef<HTMLInputElement>(null)
  const [bundleBusy, setBundleBusy] = useState(false)

  const resolve = async (q = s.address) => {
    if (!q.trim()) return
    s.set({ address: q, geo: null, fit: null })
    setBusy(true)
    try {
      const geo = await resolveAddress(q, (m) => s.log(m))
      const n = registerBucket(geo)
      s.log(`location › saved local bucket ${geo.bucket} (${n} on this browser)`, 'ok')
      s.set({ geo })
    } finally {
      setBusy(false)
    }
  }

  const addFiles = (files: FileList | null) => {
    if (!files) return
    setError('')
    const imgs = [...files].filter((f) => ['image/png', 'image/jpeg'].includes(f.type))
    if (imgs.length !== files.length) { setError('Use JPG or PNG images.'); return }
    if (s.photos.length + imgs.length > MAX_VIEWS) { setError(`Use at most ${MAX_VIEWS} photos of the same building.`); return }
    const readers = imgs.map((f) => new Promise<string>((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result as string); fr.readAsDataURL(f) }))
    Promise.all(readers).then((urls) => {
      if (useStore.getState().photos.length + urls.length > MAX_VIEWS) { setError(`Use at most ${MAX_VIEWS} photos.`); return }
      useStore.setState((st) => ({ photos: [...st.photos, ...urls] }))
      s.log(`ingest › ${urls.length} photo${urls.length === 1 ? '' : 's'} added`)
    })
  }

  const ready = !!s.geo && s.photos.length > 0

  return (
    <div className="stage">
      <div className="eyebrow">Stage 01 · Ingestion & spatial resolution</div>
      <h1 className="h1">Start from a <em>real place</em>.</h1>
      <p className="lede">Reimagine a familiar place with building photos and a style prompt. We look up its OpenStreetMap footprint so you can inspect the design at its real location.</p>

      <div className="card card-pad row wrap" style={{ marginBottom: 24, gap: 22 }}>
        <img src={`${EXAMPLE_PATH}/source.png`} alt="Data and Decision Sciences Building at Virginia Tech" style={{ width: 180, height: 105, objectFit: 'cover', borderRadius: 10 }} />
        <div style={{ flex: 1, minWidth: 240 }}>
          <div className="eyebrow">Try a completed real example</div>
          <h2 style={{ fontSize: 20, margin: '8px 0' }}>Walk around a Virginia Tech building</h2>
          <p className="dimmer" style={{ margin: '0 0 12px' }}>Cached Meshy generation · about 60k triangles · placement needs review. Opens without generation or geographic lookup.</p>
          <button className="btn primary" disabled={exampleBusy || bundleBusy} onClick={async () => {
            setExampleBusy(true); setError('')
            try { await loadCompletedExample() } catch (e) { setError((e as Error).message) }
            finally { setExampleBusy(false) }
          }}>{exampleBusy ? 'Loading completed example…' : 'Load completed real example'}</button>
        </div>
      </div>
      <div className="card card-pad" style={{ marginBottom: 24 }}>
        <div className="card-title">Reopen a saved design</div>
        <p className="dimmer">Open a Groundtruth ZIP exported after placement. Your model, photos, prompt and saved placement stay on this device. No generation or geographic lookup.</p>
        <button className="btn" disabled={bundleBusy || exampleBusy} onClick={() => bundleRef.current?.click()}>{bundleBusy ? 'Checking saved design…' : 'Open saved ZIP'}</button>
        <input ref={bundleRef} aria-label="Saved Groundtruth ZIP" type="file" accept=".zip,application/zip" hidden onChange={async (e) => {
          const file = e.target.files?.[0]; e.target.value = ''
          if (!file) return
          setBundleBusy(true); setError('')
          try { await (await import('../lib/savedBundle')).openSavedBundle(file) }
          catch (err) { setError((err as Error).message) }
          finally { setBundleBusy(false) }
        }} />
      </div>
      {error && <div role="alert" className="err-text" style={{ marginBottom: 16 }}>{error}</div>}
      {s.jobError && <div role="alert" className="err-text">{s.jobError}</div>}

      <div className="grid-2">
        <div className="stack">
          <div className="card card-pad">
            <div className="card-title"><span className="n">A</span> Street address</div>
            <form className="row" onSubmit={(e) => { e.preventDefault(); resolve() }}>
              <div className="input-wrap" style={{ flex: 1 }}>
                <MapPin size={17} />
                <input className="input" placeholder="e.g. 560 Drillfield Dr, Blacksburg, VA" value={s.address} onChange={(e) => s.set({ address: e.target.value })} />
              </div>
              <button className="btn primary" style={{ height: 48 }} disabled={busy || !s.address.trim()}>
                {busy ? <Loader2 size={16} className="spin" style={{ animation: 'spin 1s linear infinite' }} /> : 'Resolve'}
              </button>
            </form>
            <div className="suggest">
              {SUGGESTIONS.map((q) => <button key={q} onClick={() => resolve(q)} disabled={busy}>{q}</button>)}
            </div>
            {s.geo && (
              <div style={{ marginTop: 16, padding: 12, borderRadius: 12, background: 'rgba(125,255,178,.05)', border: '1px solid rgba(125,255,178,.2)', fontSize: 12.5 }}>
                <div style={{ color: s.geo.source === 'osm' ? 'var(--ok)' : 'var(--warn)', fontWeight: 600, marginBottom: 2 }}>{s.geo.source === 'osm' ? 'OpenStreetMap footprint' : 'Synthetic demo footprint — real geometry unavailable'}</div>
                <div className="dim">{s.geo.displayName}</div>
              </div>
            )}
          </div>

          <div className="card card-pad">
            <div className="card-title">
              <span className="n">B</span> Baseline photos
              <span className="right dimmer mono" style={{ fontSize: 11 }}>{s.photos.length}/{MAX_VIEWS}</span>
            </div>
            <div
              className={`dropzone ${over ? 'over' : ''}`}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setOver(true) }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files) }}
            >
              <div className="ico"><ImagePlus size={22} /></div>
              <div style={{ fontWeight: 600 }}>Drop building photos here</div>
              <div className="dimmer" style={{ fontSize: 12.5 }}>Up to four consistent views of one building · JPG / PNG</div>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg" multiple hidden onChange={(e) => addFiles(e.target.files)} />
            </div>
            {s.photos.length === 0 && (
              <button className="btn sm ghost" style={{ marginTop: 10 }} onClick={() => { s.set({ photos: [samplePhoto()], primaryPhoto: 0 }); s.log('ingest › sample facade loaded') }}>
                <Sparkles size={13} /> Use a synthetic facade
              </button>
            )}
            {s.photos.length > 0 && (
              <div className="thumbs">
                {s.photos.map((p, i) => (
                  <div key={i} className={`thumb ${i === s.primaryPhoto ? 'on' : ''}`} onClick={() => s.set({ primaryPhoto: i })} title="Use as primary">
                    <img src={p} alt="" />
                    <button className="x" onClick={(e) => { e.stopPropagation(); s.set({ photos: s.photos.filter((_, j) => j !== i), primaryPhoto: 0 }) }}><X size={12} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button className="btn primary lg block" disabled={!ready} onClick={() => s.go('redesign')}>
            Continue to redesign <ArrowRight size={17} />
          </button>
          {!ready && <div className="dimmer" style={{ fontSize: 12, textAlign: 'center', marginTop: -6 }}>Resolve an address and add at least one photo</div>}
        </div>

        <div className="card" style={{ padding: 6 }}>
          <MapView geo={s.geo} loading={busy} />
        </div>
      </div>
    </div>
  )
}
