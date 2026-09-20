# plan.md — free import & the run to Devpost

Written 2026-09-20 00:40. **Devpost entry due 08:00 Sun 2026-09-20 — ~7.3 h from now.**
This is the active plan; `mvp-next-steps.md` holds the older scope and `CLAUDE.md` the standing rules.

## Where this came from

The instruction was: *"the address selection is only for convenient when we want to clone a build
there. Allow use have a free import object and then make the outline based on the object."* Two
decisions were confirmed before starting:

1. **Add alongside — keep the scored address path.** Free import does not replace it.
2. **Also export the derived outline as a derived footprint**, provenance `user-provided`, labelled
   derived-from-mesh.

## Does this match what the sponsor asked for?

Partly, and the split matters — it is the thing to say out loud to judges rather than blur.

Deck p.58's ten steps are written against an **authoritative** footprint: geocode the address, match
the footprint, then normalise / ground / orient / scale / **validate overlap and collisions** /
store the transform / flag for review. Steps 5, 8 and 10 only mean something when the target came
from somewhere other than the mesh.

So free import is **not** the rubric path, and must never be dressed as one:

- It covers p.58 steps 3, 4, 6, 9 and 10 honestly — normalise units/axes/orientation/pivot, centre
  and ground, proportion-preserving (no scaling at all, in fact), a reproducible stored transform,
  and a human placement surface.
- It cannot cover steps 1, 2, 5 or 8. The outline **is** the object's silhouette, so overlap against
  it is a tautology. It reports **no IoU, no accept/reject verdict and no coordinates.**
- The scored Burruss path stays the headline demo. Free import is the answer to *"what if I already
  have the asset?"* and to *"what distinguishes this from invoking Meshy?"* — Meshy hands back a
  mesh in nowhere-space; this hands back a grounded mesh, a measured outline, an inspectable 4x4,
  an export and a walkable site.

## Design

**Honesty contract for the derived path** — every one of these is load-bearing:

| Claim | Free import |
| --- | --- |
| Footprint provenance | `user-provided`, `derived_from: mesh-plan-silhouette` |
| Geographic anchor | none. `lat/lon` unset, `footprintLatLon: []`, `world_registration: not-integrated` |
| IoU / coverage / spill | **not reported** — the target is the mesh's own outline |
| Verdict | **none**. No accepted / review / rejected |
| Scale | identity. Only units, axes and grounding are applied |
| Orientation | the author's. No rotation search runs |

**The outline is the top-down silhouette, not a convex hull.** Every triangle is projected to plan
and rasterised (edges stamped explicitly, since walls project to slivers), interior voids are
flooded solid, the occupied/empty boundary is traced into closed loops, the largest is kept and
simplified with Ramer-Douglas-Peucker at ~1 cell. An L-shaped Blender object therefore gets an
L-shaped outline. Convex hull is the fallback if the trace degenerates, and the method is reported.

This is deliberately the opposite choice from the scored path, where a **more** faithful concave
proxy measured *worse* (Burruss 73.13 % → 58.72 %, DDS 64.32 % → 30.02 %; see CLAUDE.md). That
result is about matching a mesh to a footprint it does not share. Here the outline only has to
describe the object, so faithfulness is strictly better.

**Files**

- `web/src/lib/deriveSite.ts` *(new)* — rasterise → fill → trace → simplify; returns a `GeoResult`
  with `source: 'derived'` plus a `FitResult` whose transform is exactly `T_ground · N`.
- `web/src/lib/placement.ts` — generalise the manual nudge to `nudgeMatrix` / `nudgeRing` /
  `planMetrics` so the free path reuses the review surface instead of copying it.
- `web/src/components/PlanEditor.tsx` — take a `PlanModel` instead of a `PlacementManifest`;
  metrics become optional so the derived path can show offset and yaw with no IoU.
- `web/src/stages/SandboxFitStage.tsx` *(new)* — derived-site review, free placement, export.
- `IngestStage` (third no-backend entry), `FitStage` (dispatch + derived `transform.json`),
  `ExploreStage` / `App` / `MapView` (local readout instead of Null Island coordinates).

**The v1 HTTP contract is untouched.** No server call happens on this path, so `schemas.py`,
`api.ts` and `savedBundle.ts` are not widened and `PlacementManifest`'s literals keep meaning what
they already mean. The derived footprint ships in the preview `transform-*.json`, which is a
handoff artifact, not a manifest.

## Order of work

1. `deriveSite.ts` + the `placement.ts` / `PlanEditor` generalisation. **(in progress)**
2. `SandboxFitStage`, Ingest entry, Fit dispatch, Explore/App/MapView readouts.
3. `tsc -b`, then a Playwright check (`check-free-import.mjs`): import a GLB with no address,
   reach Explore, drag, export, and assert **no API and no GIS request** and no IoU on screen.
4. Re-run `check-example` / `check-bundle` / `check-manual-placement` — the scored path must be
   untouched. Re-sync `CLAUDE.md`.

**Then stop adding features.** Estimate for 1–4: ~1.5 h.

## After that, in priority order

1. **Devpost entry** — description, demo links judges can open, the honest limits stated. Hard gate.
2. **Three-minute script** + a backup recording of the verified path.
3. **Measure the demo laptop** — load time, orbit/walk responsiveness and memory at the real display
   size. Headless Chromium proves plumbing, not frame rate, and this is the one unmeasured thing
   that can embarrass the demo live.
4. `web/README.md` and `samples/README.md` still describe the DDS-only example set.

Items 1 and 2 are not optional and come before any further code. If time runs short, 3 and 4 go.
