# Groundtruth progress report

Updated September 19, 2026. This report describes the current working tree, including uncommitted
changes. It separates implemented behavior from the remaining pitch goals.

## Current outcome

The app can load a genuine cached Meshy building, inspect it in orbit or exterior walk mode, show its
geographic placement, export its artifacts, and reopen a saved export locally. API-generated models
use the backend placement throughout the connected workflow. Users can choose the polygon target
for a new API generation.

The engineering workflow is substantially more complete. The creative demo is not yet complete:
DDS has only a subtle restyle, and its model does not fit the real building footprint sufficiently.
The app continues to show that rejection. No new paid generation was run during these implementation
and verification steps.

## Product direction and plan alignment

`pitch-plan.md` remains the product direction: **Reimagine a place. Walk into your idea.**
The experience should connect photos, a creative prompt, a visibly redesigned concept, an explorable
model, and reusable geographic placement. `implementation-plan.md` records the original time-boxed
implementation plan; its countdown is historical. `mvp-next-steps.md` tracks the updated completion
sequence. This report records the actual work and evidence in more detail.

Google-style reconstruction was considered as a possible technique, rather than as a map feature to
copy. No Google map renderer, photogrammetry pipeline, COLMAP/OpenMVS, or VGGT integration has been
added. Those would require a new capture/processing workflow; the existing hosted pipeline and export
contract were the more immediate integration gaps. There is no verified Procedura/Scorched Nebraska
import endpoint in this implementation. The ZIP is currently a handoff artifact.

## 1. Authoritative placement through Fit, Explore, export, and refresh

Previously, the frontend could display a browser-computed fit even for a server-generated model,
while the backend had its own placement endpoint and manifest. The integration now connects them.

- `ServerFitStage.tsx` requests backend fitting for pipeline assets and displays the returned
  accepted/review/rejected status, footprint IoU, coverage, spill, neighbor overlap, warnings, and
  selected matrix.
- `placement.ts` defines the common scene representation and checks the asset hash and fit inputs.
  Plan coordinates are East/North; the viewer uses East/Up/South.
- `PlacedScene.tsx` applies the saved column-major matrix once to the raw asset root. It does not
  bake another normalization into the model.
- API Fit, orbit Explore, exterior walk, export, and refresh share that placement. The raw-model
  toggle permits inspection without the placement transform.
- Changing relevant mesh/footprint inputs invalidates stale placement. Restoration checks the hash
  and request rather than assuming a saved manifest belongs to the current inputs.
- Before downloading a live job's ZIP, the frontend checks that the server's saved placement still
  matches the displayed placement, including changes made from another tab.
- Browser fitting remains available for local simulations and manual imports and is separate from
  the backend placement path.

Explore opens in orbit mode, offers exterior walk-around, and provides a reset-camera action.
Source imagery and the prompt remain accessible. Heading is unverified and height is inferred.
Walk mode does not establish reconstructed interiors or architectural accuracy.

## 2. A smaller genuine cached example

The original DDS generation is preserved under `samples/live/`. The source building is Data and
Decision Sciences at Virginia Tech, 727 Prices Fork Road, associated with OSM way/1174211880.
The recorded input identity was operator-confirmed.

| Measurement | Original Meshy GLB | Browser derivative |
| --- | ---: | ---: |
| Triangles | 1,746,050 | 59,962 |
| GLB bytes | 62,465,636 | 12,907,244 |
| Approximate decimal MB | 62.5 | 12.9 |
| Footprint IoU | 52.6067% | 52.6204% |
| Placement result | Rejected | Rejected |

`web/scripts/prepare-example.mjs` welds and simplifies the original geometry using meshoptimizer,
with a 60,000-triangle target and 0.005 error limit. It reruns the backend fitter for the changed GLB,
records original/derived hashes and settings, and writes the static example and its ZIP.

The derivative is a new asset with its own manifest. The original placement was not copied onto
changed bytes, thresholds were not relaxed, and the source asset was not overwritten.

Visual inspection found recognizable facade/roof detail and surrounding paving. The concept is a
subtle material restyle, not yet the striking creative transformation described by the pitch.
The generated massing does not reproduce the full concave DDS footprint; the conservative convex
proxy also limits concave-footprint assessment. These observations do not establish that adopting a
new generator would resolve the problem. A laptop frame-rate target has not yet been measured.

## 3. One-click static example

Ingest includes **Load completed real example**. `/?example=dds` opens it directly into Explore.
The source, concept, simplified GLB, placement, generation record, and ZIP are served from
`web/public/examples/dds/`.

This path does not need generation, the backend API, or a fresh geocoder/OSM response. It checks the
model/placement association and remembers the selected example for refresh. The cached provider is
explicitly labeled. The separate synthetic sample remains labeled as synthetic.

Ingest also enforces a maximum of four PNG/JPEG photographs, matching the current provider contract.
OSM footprint lookup, synthetic fallback, and browser-local spatial indexing are identified more
accurately; they are not presented as sponsor-world registration.

## 4. Reopening exported ZIPs

Ingest now includes **Open saved ZIP**. The importer opens a completed Groundtruth export into
Explore and restores its original model, source photos, concept, prompt, and placement.

- Validates the ZIP's supported filenames and size bounds.
- Requires model, placement, generation provenance, and source imagery.
- Checks exported artifact SHA-256 values and the model hash in the placement manifest.
- Checks the placement structure and finite scene values before rendering.
- Requires a self-contained GLB, so model loading does not fetch external buffers or textures.
- Uses the existing placement matrix; importing does not rerun fitting or generation.
- Retains the original ZIP for byte-for-byte re-export.
- Stores the last imported archive in IndexedDB for refresh; `New` clears the active import marker.
  If browser persistence is unavailable, the current session still works and the ZIP can be reopened.
- Reports import errors without replacing a successfully opened project.
- Shows saved provenance in Redesign rather than labeling a genuine imported concept as a local
  simulation or offering generation controls over the saved result.

Current support is deliberately bounded to the UI's flat, hole-free OSM/synthetic fit contract,
default fit thresholds, and compatible inferred axis/unit settings. Other valid backend manifests
may be rejected as unsupported rather than silently modified. Only the primary concept is displayed;
other exported view artifacts remain in the unchanged ZIP. IndexedDB retains one last archive, not a
project library. A hash check establishes byte consistency, not the authenticity of the author or
independent correctness of the exported fit evaluation.

## 5. User-adjustable polygon target

**Redesign → Target polygons for 3D** accepts a whole number from **100 to 300,000**, defaulting to
**60,000** in the UI. It applies to the next API generation. Lower counts favor lighter geometry;
higher counts can retain more detail. It does not simplify an already-open cached model.

The selected value is carried through:

1. Frontend state and saved session.
2. The generation fingerprint/idempotency key, so changing the target changes the logical request.
3. Multipart `POST /v1/jobs` as `target_polycount`.
4. Persisted per-job settings and the public job response.
5. The provider submission, including reconstruction after restart.
6. `generation.json` in the export.

A repeated request key returns the existing job and its original target. A server-default change
does not override a target already recorded for a new job. Older records without that setting retain
the previous fallback to the server default; their historical target is not invented in the response.
The Reconstruct screen reports the target recorded for its job.

The backend rejects values outside the supported range and non-integer input before creating a job.
An omitted API field uses the server's configured default. Fixture/simulation geometry does not become
real remeshing merely because a target was selected. Meshy's target is approximate, not a guarantee
of the final count. See [Meshy's remesh parameter documentation](https://docs.meshy.ai/en/api/multi-image-to-3d).

## Verification evidence

| Check | Evidence and scope |
| --- | --- |
| Backend suite | 45 tests passed, including new per-job target tests; fixture/mocked provider calls, no paid generation |
| Provider target | Mocked Meshy request contains the selected target and `should_remesh: true` |
| Target persistence | API tests cover repeated key, separate job targets, changed server default on restart, export, omitted target, and invalid input |
| Frontend build | TypeScript and Vite production build pass; existing large main-JS chunk warning remains |
| Placement integration | Earlier fixture and cached real checks compared rendered matrices in Fit/orbit/walk, refresh, export, and input invalidation |
| Static example | Production browser check exercises load, exploration, export, refresh, and corrupt-hash rejection with API/GIS access blocked |
| ZIP import | Production browser check exercises import, orbit/walk, matrix display, unchanged ZIP re-export, refresh, provenance, reset, and corrupt-file rejection |
| Polygon control | Dedicated browser check uses mocked API routes to verify UI validation, submitted target, refresh, and changed request identity |

The checks distinguish plumbing from output quality. Mocked provider tests do not establish the
quality or exact polygon count of a new live generation. Browser automation uses headless Chromium
and software rendering; it does not prove target-laptop performance.

Scripts:

- `web/scripts/check-placement.mjs`: use an isolated fixture server as documented in `web/README.md`.
- `web/scripts/check-example.mjs`: static production preview, default port 5175.
- `web/scripts/check-bundle.mjs`: static production preview, default port 5175.
- `web/scripts/check-polycount.mjs`: Vite dev frontend with `VITE_API_BASE` configured, default port
  5174; the script intercepts all API calls and never submits a provider job.

The scripts require Playwright plus its Chromium installation. Set `PLAYWRIGHT_MODULE` if the package
is installed outside this repo. Screenshots/exports are written under `/tmp/groundtruth-*`; these are
local verification artifacts, not the permanent sample files.

## How to try it

1. Start the web app using `web/README.md`, or use the running local preview.
2. Click **Load completed real example** to open the real cached DDS model.
3. Orbit, choose **Walk around**, and use **Reset camera** to recover the view.
4. Choose **Inspect / export** to see the rejected fit and download the ZIP.
5. Choose **New**, then **Open saved ZIP**, and select the download. Explore and refresh it.
6. For a new generation, resolve a building, add photos, enter Redesign, and adjust **Target polygons
   for 3D** before generating. Configure the real backend for real Meshy output; the local demo
   backend used for checks is explicitly synthetic.

The existing local sessions use port 5174 for the API-connected dev UI and 5175 for static production
preview. They are local processes, not a public deployment. A later restart may require running the
startup commands again. Rebuild the frontend to update the production preview; restart the backend
to pick up Python changes.

## Remaining MVP work, in priority order

1. **A convincing real transformation.** Choose either a bolder DDS style or a simpler building with
   matching photographs and a confirmed footprint. The building/style choice is still open. The
   existing DDS sample is useful for honest inspection and failure explanation, not a fit success.
2. **A measured useful fit.** Inspect the selected building's actual output, including background
   paving and missing sides. Record coverage/spill/IoU and the final review status. Do not reshape the
   model or lower thresholds to manufacture acceptance.
3. **Demo-laptop measurement.** Check load time, orbit and walking responsiveness, memory, and the
   intended display size. Count reduction alone is not an FPS measurement.
4. **Presentation packaging.** Record a backup of the verified path and finish a three-minute pitch
   that makes the current creative quality and geographic limitations clear.
5. **Sponsor import only with a concrete contract.** Keep exporting a reproducible bundle until an
   actual integration can be implemented and tested.

No multi-style comparison, new reconstruction stack, public paid-generation hosting, or broad
address-quality promise has been added. Those are not prerequisites for finishing the selected
building demonstration.
