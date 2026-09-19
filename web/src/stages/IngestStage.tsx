import { useRef, useState } from 'react'
import { ArrowRight, ImagePlus, Loader2, MapPin, Sparkles, X } from 'lucide-react'
import { useStore } from '../store'
import { registerBucket, resolveAddress } from '../lib/geo'
import { samplePhoto } from '../lib/redesign'
import MapView from '../components/MapView'

const SUGGESTIONS = ['Newman Library, Blacksburg, VA', 'Burruss Hall, Blacksburg, VA', 'Flatiron Building, New York', 'Nebraska State Capitol, Lincoln']

export default function IngestStage() {
  const s = useStore()
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const resolve = async (q = s.address) => {
    if (!q.trim()) return
    s.set({ address: q, geo: null, fit: null })
    setBusy(true)
    try {
      const geo = await resolveAddress(q, (m) => s.log(m))
      const n = registerBucket(geo)
      s.log(`world › registered bucket ${geo.bucket} (${n} in world state)`, 'ok')
      s.set({ geo })
    } finally {
      setBusy(false)
    }
  }

  const addFiles = (files: FileList | null) => {
    if (!files) return
    const imgs = [...files].filter((f) => f.type.startsWith('image/'))
    const readers = imgs.map((f) => new Promise<string>((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result as string); fr.readAsDataURL(f) }))
    Promise.all(readers).then((urls) => {
      useStore.setState((st) => ({ photos: [...st.photos, ...urls].slice(0, 8) }))
      s.log(`ingest › ${urls.length} photo${urls.length === 1 ? '' : 's'} added`)
    })
  }

  const ready = !!s.geo && s.photos.length > 0

  return (
    <div className="stage">
      <div className="eyebrow">Stage 01 · Ingestion & spatial resolution</div>
      <h1 className="h1">Start from a <em>real place</em>.</h1>
      <p className="lede">Give us a street address and a photo of what stands there. We resolve it to coordinates, pull the authoritative GIS footprint and register the location in the persistent world.</p>

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
                <div style={{ color: 'var(--ok)', fontWeight: 600, marginBottom: 2 }}>Resolved</div>
                <div className="dim">{s.geo.displayName}</div>
              </div>
            )}
          </div>

          <div className="card card-pad">
            <div className="card-title">
              <span className="n">B</span> Baseline photos
              <span className="right dimmer mono" style={{ fontSize: 11 }}>{s.photos.length}/8</span>
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
              <div className="dimmer" style={{ fontSize: 12.5 }}>Front elevation works best · JPG / PNG</div>
              <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => addFiles(e.target.files)} />
            </div>
            {s.photos.length === 0 && (
              <button className="btn sm ghost" style={{ marginTop: 10 }} onClick={() => { s.set({ photos: [samplePhoto()], primaryPhoto: 0 }); s.log('ingest › sample facade loaded') }}>
                <Sparkles size={13} /> Use a sample facade
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
