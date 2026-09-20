// Free-import review (plan.md slice 2). The scored path asks "does this mesh fit the
// authoritative footprint?"; there is no authoritative footprint here, so this stage asks a
// smaller and honestly answerable question instead: what are the object's real dimensions, where
// is its outline, and where do you want it to sit?
//
// Everything it must NOT claim is enforced by what it does not render: no IoU, no coverage, no
// spill, no accepted/review/rejected verdict, no latitude and longitude. Deck p.58's steps 1, 2,
// 5 and 8 are about matching an independent record, and this path cannot do them.
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Copy, Download, Package, Sparkles } from 'lucide-react'
import * as THREE from 'three'
import { NO_ADJUST, isAdjusted, useStore } from '../store'
import { deriveSite } from '../lib/deriveSite'
import { derivedPlan, derivedScene, nudgeMatrix, ringCentroid } from '../lib/placement'
import { exportGLB } from '../lib/reconstruct'
import DerivedScene from '../components/DerivedScene'
import PlanEditor from '../components/PlanEditor'
import MatrixView from '../components/MatrixView'

function download(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

/** Re-derives whenever the object changes; the store clears `fit` on exactly that event. */
export function deriveIntoStore(label: string) {
  const { mesh, declaredHeightM, set, log } = useStore.getState()
  if (!mesh) return
  const t0 = performance.now()
  const site = deriveSite(mesh, label, declaredHeightM)
  const ms = performance.now() - t0
  // Two writes on purpose: the store drops `fit` whenever `geo` or `mesh` changes, so a single
  // combined write would invalidate the very result it is carrying.
  const { geo, fit, ...meta } = site
  set({ geo, adjust: null })
  set({ fit, derived: meta })
  log(`site › outline derived in ${ms.toFixed(0)} ms · ${site.method} · ${site.geo.footprint.length} vertices · ${site.geo.areaM2.toFixed(0)} m² · scale ${site.scale.toFixed(3)}x ${site.scaleProvenance}`, 'ok')
  return site
}

export default function SandboxFitStage() {
  const s = useStore()
  const mesh = s.mesh!, geo = s.geo!
  const [copied, setCopied] = useState(false)
  const [raw, setRaw] = useState(false)
  const deriving = useRef(false)
  // Provenance lives in the store because the derivation usually ran back on Ingest; component
  // state would be null by the time this stage mounts.
  const site = s.derived

  // The outline belongs to the object, so a swapped model must re-derive rather than keep a
  // silhouette measured from a different mesh.
  useEffect(() => {
    if (s.fit || deriving.current) return
    deriving.current = true
    try { deriveIntoStore(mesh.meta.source) }
    finally { deriving.current = false }
  }, [s.fit, mesh])

  const declare = (metres: number | null) => {
    s.set({ declaredHeightM: metres && metres > 0 ? metres : null })
    deriveIntoStore(mesh.meta.source)
  }

  const fit = s.fit
  const adjust = s.adjust ?? NO_ADJUST
  const manual = isAdjusted(s.adjust)
  const plan = useMemo(() => fit && derivedPlan(fit), [fit])
  const scene = useMemo(() => fit && derivedScene(fit, s.adjust), [fit, s.adjust])
  const pivot = useMemo(() => fit && ringCentroid(fit.chosen.poly), [fit])

  if (!fit || !plan || !scene || !pivot) {
    return <div className="stage"><div className="card card-pad">Measuring the object’s outline…</div></div>
  }

  const M = nudgeMatrix(fit.matrices.M, pivot, s.adjust)
  const size = {
    x: fit.groundedAABB.max[0] - fit.groundedAABB.min[0],
    y: fit.height,
    z: fit.groundedAABB.max[2] - fit.groundedAABB.min[2],
  }

  const transformJSON = () => ({
    version: 1,
    generator: 'hokieroam',
    // Named differently from the scored path's `anchor` on purpose: nothing here is anchored.
    site: {
      kind: 'derived-from-mesh',
      frame: 'local site frame · x=east, y=up, z=south · meters · origin at the outline centroid',
      geographic_anchor: null,
      world_registration: 'not-integrated',
      note: 'Outline measured from the object itself. No address, no authoritative footprint, and no overlap score.',
    },
    transform: {
      composition: [manual && 'A_manual', fit.scale.uniform !== 1 && 'S', 'T_ground', 'N'].filter(Boolean).join(' · '),
      matrix_column_major: M,
      matrix_row_major: new THREE.Matrix4().fromArray(M).transpose().toArray(),
      factors: { N: fit.matrices.N, Tground: fit.matrices.Tground, S: fit.matrices.S },
      manual_placement: manual
        ? { dx_m: adjust.dx, dz_m: adjust.dz, dyaw_rad: adjust.dyaw, pivot }
        : null,
    },
    derived_footprint: {
      provenance: 'user-provided',
      derived_from: 'mesh-plan-silhouette',
      method: site?.method ?? 'plan-silhouette',
      area_m2: geo.areaM2,
      exterior_scene_xz: geo.footprint,
      latlon: [],
    },
    measurements: {
      length_m: size.x, width_m: size.z, height_m: size.y,
      // The distinction that keeps this honest: nothing here was measured against an independent
      // record. `as-authored` trusts the file's units; `user-declared` is a stated claim.
      scale_applied: fit.scale.uniform,
      scale_mode: 'uniform',
      scale_provenance: site?.scaleProvenance ?? 'as-authored',
      authored_height_m: site?.authoredHeightM ?? size.y,
      declared_height_m: s.declaredHeightM,
      note: 'Units and axes normalised and the base grounded. Any scale is uniform and stated, never fitted, and no rotation search ran.',
    },
    source_mesh: mesh.meta,
  })

  return (
    <div className="stage">
      <div className="row wrap" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <h1 className="h1">Your object, <em>measured and grounded</em>.</h1>
          <p className="lede" style={{ marginBottom: 22 }}>
            No address was used, so there is no authoritative footprint to score against. The outline below
            was measured from the object’s own top-down silhouette, its units and axes were normalised and
            its base grounded — and where it sits is yours to choose.
          </p>
        </div>
      </div>

      <div className="flag warn" style={{ marginBottom: 18 }} data-testid="derived-site-banner">
        <Sparkles size={16} />
        <span>
          Derived site — footprint provenance <b>user-provided</b>, derived from the mesh silhouette.
          No geographic anchor, <b>no overlap score and no placement verdict</b>. For a validated placement,
          resolve a real address on Ingest instead.
        </span>
      </div>

      <div className="fit-grid">
        <div className="card" style={{ padding: 6 }}>
          <div className="viewer">
            <DerivedScene asset={mesh} matrix={M} outline={scene.chosen.poly} raw={raw} />
            <div className="viewer-hud">
              <div className="glass row" style={{ padding: '8px 12px' }}>
                <label className="toggle">
                  <input type="checkbox" checked={raw} onChange={(e) => setRaw(e.target.checked)} />
                  Raw model (no transform)
                </label>
              </div>
            </div>
          </div>
        </div>

        <div className="stack">
          <div className="card card-pad">
            <div className="card-title"><span className="n">M</span> Measured object</div>
            <div className="stats" style={{ marginTop: 12 }}>
              <div className="stat"><div className="v">{size.x.toFixed(1)}<small>m</small></div><div className="k">Length</div></div>
              <div className="stat"><div className="v">{size.z.toFixed(1)}<small>m</small></div><div className="k">Width</div></div>
              <div className="stat"><div className="v">{size.y.toFixed(1)}<small>m</small></div><div className="k">Height</div></div>
              <div className="stat hl"><div className="v">{geo.areaM2.toFixed(0)}<small>m²</small></div><div className="k">Outline area</div></div>
            </div>
            <div className="divider" style={{ margin: '14px 0' }} />
            <label className="label" htmlFor="declared-height">
              <span>Real-world height</span>
              <span className="mono">{site?.scaleProvenance === 'user-declared' ? 'declared' : 'as authored'}</span>
            </label>
            <div className="row">
              <input id="declared-height" className="input" type="number" min={0.1} max={2000} step={0.1}
                placeholder={site ? site.authoredHeightM.toFixed(2) : ''}
                value={s.declaredHeightM ?? ''}
                onChange={(e) => declare(e.target.value === '' ? null : Number(e.target.value))} />
              <span className="dimmer mono">m</span>
              {s.declaredHeightM !== null && <button className="btn sm" onClick={() => declare(null)}>Use file units</button>}
            </div>
            <p className="dimmer" style={{ fontSize: 12, marginTop: 8 }} data-testid="scale-note">
              {site?.scaleProvenance === 'user-declared'
                ? <>Scaled <b>uniformly</b> by {fit.scale.uniform.toFixed(3)}× from the file’s {site.authoredHeightM.toFixed(2)} m.
                  Proportions are untouched. This size is <b>your claim, not a measurement</b> — nothing here verifies it.</>
                : site?.looksUnscaled
                  ? <>This file looks <b>unit-normalised</b> ({site.authoredHeightM.toFixed(2)} m tall), which is what image-to-3D
                    generators usually emit. It carries no recoverable real-world scale, and with no authoritative footprint there is
                    nothing to fit it to — so state the real height to get a true-to-life site.</>
                  : <>Using the file’s own units. No scaling is applied.</>}
            </p>
            <div className="divider" style={{ margin: '14px 0' }} />
            <div className="stack" style={{ gap: 6 }}>
              <div className="kv"><span>Outline method</span><span>{site?.method ?? 'plan-silhouette'}</span></div>
              <div className="kv"><span>Outline vertices</span><span>{geo.footprint.length}</span></div>
              <div className="kv"><span>Source units / axis</span><span>{mesh.meta.units} · {mesh.meta.upAxis}-up</span></div>
              <div className="kv"><span>Scale applied</span><span>{fit.scale.uniform.toFixed(3)}× uniform · {site?.scaleProvenance ?? 'as-authored'}</span></div>
              <div className="kv"><span>Location</span><span>local site frame · no anchor</span></div>
            </div>
          </div>

          <div className="card card-pad">
            <div className="card-title"><span className="n">QA</span> What was and was not checked</div>
            <div className="flags">
              {fit.flags.map((f, i) => (
                <div key={i} className={`flag ${f.level}`}><span>{f.text}</span></div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="card card-pad" style={{ marginTop: 18 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <strong>Place it on the site</strong>
            <div className="dimmer" style={{ fontSize: 12 }}>
              Drag to move, shift-drag to rotate. This is the placement, not a correction to one —
              it is carried into the export and into Explore.
            </div>
          </div>
          {manual && <button className="btn sm" onClick={() => { s.set({ adjust: null }); s.log('site › placement reset to the grounded default') }}>Reset placement</button>}
        </div>
        <div style={{ marginTop: 14 }}>
          <PlanEditor plan={plan} adjust={adjust} onChange={(a) => s.set({ adjust: a })} />
        </div>
      </div>

      <div className="fit-grid" style={{ marginTop: 18 }}>
        <div className="card card-pad">
          <div className="card-title"><span className="n">4×4</span> Transform inspector
            <span className="right row">
              <button className="btn sm" onClick={async () => {
                await navigator.clipboard.writeText(JSON.stringify(transformJSON(), null, 2))
                setCopied(true); setTimeout(() => setCopied(false), 1400)
              }}><Copy size={13} /> {copied ? 'Copied' : 'Copy JSON'}</button>
              <button className="btn sm" onClick={() => download(new Blob([JSON.stringify(transformJSON(), null, 2)], { type: 'application/json' }), 'transform-derived-site.json')}><Download size={13} /> transform.json</button>
              <button className="btn sm" onClick={async () => {
                s.log('export › writing grounded GLB…')
                const blob = await exportGLB(mesh, new THREE.Matrix4().fromArray(M))
                download(blob, 'hokieroam-derived-site.glb')
                s.log(`export › GLB ${(blob.size / 1024).toFixed(0)} KB`, 'ok')
              }}><Package size={13} /> GLB</button>
            </span>
          </div>
          <div className="formula" style={{ marginBottom: 12 }}>
            <b>M</b> = {manual ? 'A_manual · ' : ''}{fit.scale.uniform !== 1 ? 'S · ' : ''}T_ground · N
            <span className="dimmer"> — {fit.scale.uniform === 1 ? 'no scale' : `uniform ${fit.scale.uniform.toFixed(3)}× (declared)`}, no rotation search</span>
          </div>
          <MatrixView m={M} />
          <p className="dimmer" style={{ marginTop: 10 }}>
            The export carries the derived outline as a footprint with provenance <b>user-provided</b> and
            <b> derived_from: mesh-plan-silhouette</b>, and no coordinates. It is a handoff artifact, not a
            placement manifest.
          </p>
        </div>

        <div className="card card-pad">
          <div className="card-title"><span className="n">→</span> Next</div>
          <p className="dimmer">
            Explore walks the object on its derived site. Everything the scored path proves about being in the
            right place on a real map is exactly what this path does not claim.
          </p>
          <div className="stack" style={{ gap: 6, marginBottom: 16 }}>
            <div className="kv"><span>Placement offset</span><span>{Math.hypot(adjust.dx, adjust.dz).toFixed(2)} m</span></div>
            <div className="kv"><span>Placement yaw</span><span>{(adjust.dyaw * 180 / Math.PI).toFixed(1)}°</span></div>
            <div className="kv"><span>Overlap score</span><span>not measured</span></div>
            <div className="kv"><span>Verdict</span><span>none</span></div>
          </div>
          <button className="btn primary lg block" onClick={() => s.go('explore')}>
            Walk the site <ArrowRight size={17} />
          </button>
        </div>
      </div>
    </div>
  )
}
