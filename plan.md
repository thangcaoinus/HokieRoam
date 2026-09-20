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
  and ground, proportion-preserving (uniform only, and only to a size the person states), a
  reproducible stored transform, and a human placement surface.
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
| Scale | identity by default. **Revised 2026-09-20**: optionally uniform to a *declared* real height — see below |
| Orientation | the author's. No rotation search runs |

**Why the scale row changed.** The plan assumed the imported file carries its own real-world
size. Running it proved otherwise: the Burruss GLB is normalised to a unit box (raw bbox
1.898 x 0.973 x 1.281, no node scale), which is what image-to-3D generators emit, so free import
measured a 1.9 m building. The scored path never hits this because it scales to the authoritative
footprint; the free path has nothing to scale to. Inventing a size would be the dishonest fix, so
the size is **asked for**: an optional real height, applied **uniformly** (deck p.58 prefers
proportion-preserving scaling), reported everywhere as `user-declared` and never as measured.
Declaring 48.4 m for Burruss yields 94.4 x 63.7 m in plan — its real dimensions per `CLAUDE.md`,
which is an independent confirmation that the uniform scaling is right. `as-authored` remains the
default, and the UI says so when a file looks unit-normalised.

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
  with `source: 'derived'` plus a `FitResult` whose transform is `S · T_ground · N` (`S` is
  identity unless a real height was declared; it comes last so scaling never un-grounds the base).
- `web/src/components/DerivedScene.tsx` *(new)* — orbit view for a site with no manifest.
- `web/scripts/check-free-import.mjs`, `web/scripts/check-derive-site.ts` *(new)* — the two checks.
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

1. `deriveSite.ts` + the `placement.ts` / `PlanEditor` generalisation. **Done 2026-09-20.**
   `fit.ts` now exports `signedArea` / `toRootMatrix` and widens `authority` to
   `'preview-only' | 'derived-site'`; `geo.ts` widens `source` to include `'derived'`;
   `placement.ts` splits the manifest-bound nudge into `nudgeMatrix` / `nudgeRing` /
   `planMetrics` / `ringCentroid` plus a `PlanModel` the editor renders instead of a
   `PlacementManifest`. `tsc -b` clean.
   **`deriveSite` was verified by running it, and that found a real bug** — see the note in
   `CLAUDE.md`: `fillVoids` seeded its exterior flood from cell 0, which an edge stamp at
   `box.min` could occupy, after which every empty cell read as an interior void and the
   silhouette filled solid. An L came out as its bounding box (1627 m² against a true 1200).
   Fixed with two-cell padding and seeding from every empty border cell; an L now traces 6
   corners at 1217.8 m², a courtyard block fills its void to 1617.8 m², and a Z-up/centimetre/
   off-origin box normalises, grounds and centres with no scaling.
2. `SandboxFitStage`, Ingest entry, Fit dispatch, Explore/App/MapView readouts. **Done 2026-09-20.**
   Ingest has a third no-backend entry (**Import your own model**, .glb/.obj); `FitStage` checks
   `geo.source === 'derived'` *before* the server-mesh check and renders `SandboxFitStage`;
   `components/DerivedScene.tsx` is the orbit view (`PlacedScene` needs a manifest, and there is
   none); Explore now shares its toolbar with the derived path instead of dropping straight into a
   walk view with no way back. Honesty fixes found while wiring: the rail printed **IoU 100.0 %**
   from the derived FitResult's placeholder `iou: 1`; the header printed **0.00000°, 0.00000°**;
   `MapView` fetched **OSM basemap tiles for Null Island**; and Explore offered "Source photo and
   prompt" showing the idle preset. All four are suppressed for `source === 'derived'`.
3. `tsc -b`, then a Playwright check (`check-free-import.mjs`). **Done 2026-09-20** — it asserts
   the absence of IoU/coverage/spill/accepted/rejected and of fabricated coordinates at three
   points in the flow, and that nothing reaches Nominatim, Overpass, the tile server or `/v1/`.
   `scripts/check-derive-site.ts` was added alongside it as a headless geometry check, because the
   `fillVoids` bug from slice 1 is invisible to a browser test.
4. Re-run `check-example` / `check-bundle` / `check-manual-placement` — the scored path must be
   untouched. Re-sync `CLAUDE.md`. **Done 2026-09-20**: all five browser checks pass
   (`check-polycount` needs an API-mode build), plus `check-derive-site`. `server/` is untouched.

**Then stop adding features.** Slices 1–4 are complete as of 2026-09-20.

## After that, in priority order

1. **Devpost entry** — description, demo links judges can open, the honest limits stated. Hard gate.
2. **Three-minute script** + a backup recording of the verified path.
3. **Measure the demo laptop** — load time, orbit/walk responsiveness and memory at the real display
   size. Headless Chromium proves plumbing, not frame rate, and this is the one unmeasured thing
   that can embarrass the demo live.
4. `web/README.md` and `samples/README.md` still describe the DDS-only example set.

Items 1 and 2 are not optional and come before any further code. If time runs short, 3 and 4 go.
