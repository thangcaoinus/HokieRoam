# MVP completion plan — repository audit, September 19, 2026

## Outcome

Finish one useful real-building workflow: source photos and a confirmed footprint → generated
concept and GLB → inspectable placement → export → identical placement after reload.
Approximate geometry is acceptable; conflicting transforms, hidden synthetic data, and lost results
are not. This plan updates execution priorities from `implementation-plan.md`; its old 16-hour
countdown is not evidence of how much time remains now.

## Observed state

**Completion update:** the first implementation slice is now connected and browser-checked. API
assets use one backend placement through Fit, orbit/walk Explore, ZIP export, and refresh. Asset hashes
and fit inputs are checked before restoring placement; footprint edits invalidate it. The fixture
passed the complete path with no browser generation submissions. The genuine cached DDS model also
restored its rejected placement consistently in Fit and Explore. The source/concept/model inspection
found recognizable facade detail, surrounding paving, and only a subtle visual redesign.

**Second slice completed:** a one-click real example now ships as static artifacts and opens in
Explore without backend/GIS calls. Its derived GLB has 59,962 triangles (from 1,746,050), weighs
12,907,244 bytes, and has newly computed hash-bound placement. The fit remains rejected at 52.6204%
IoU. Browser checks cover orbit/walk, source/prompt, export hashes, refresh, and corrupt-hash rejection.
Uploads enforce the provider's four-view JPEG/PNG limit. Original live artifacts remain untouched.
No new reconstruction provider or paid generation was introduced.

**Third slice:** exported ZIPs can now be reopened locally, with model/source hashes and the saved
placement checked before display. The original archive is retained for unchanged re-export and
browser refresh. This closes the saved-result handoff path; it does not improve generated geometry.

**Polygon target control:** Redesign now accepts a per-job target from 100 to 300,000 (UI default
60,000), carried through the request identity, API, persisted job, provider submission, and export.
It applies to new generation, not the cached model. See `progress-report.md` for detailed evidence
and limitations across all completed slices.

Remaining work: a more compelling transformation with useful real placement, interaction measurement
on the demo laptop, and pitch/backup recording. The lighter DDS example makes inspection usable but
does not establish a successful geographic fit.

The bullets below record the **pre-change audit**, explaining the priorities that follow.

- Backend pytest: 38 passed. Frontend production build passed; Vite reports a large bundle warning.
  These checks do not establish that the latest live browser flow works.
- Real generation orchestration, provider task persistence, refresh reattachment, artifact storage,
  backend fitting, and ZIP export exist.
- `FitStage.tsx` still calls browser `solveFit` for every mesh and exports browser-produced placement.
  It says the server is authoritative, but does not call the existing `requestFit` API. This is the
  highest-priority integration gap.
- `store.ts` stores only the browser FitResult; session restoration returns model-bearing jobs to
  Reconstruct rather than restoring their saved placement into Fit/Explore.
- `samples/live/` contains genuine generation output, but its manifest records rejected placement,
  ambiguous heading, inferred height, and no world integration. Its GLB is 62,465,636 bytes.
- The DDS sample footprint is concave. The full projected convex hull used by the backend loses
  concavities, so rejection alone does not establish that a different generator is necessary.
- The latest adapter supports up to four views and requests remeshing to 60,000 polygons. Actual
  quality and size of a new output under these settings have not been verified in this audit.
- Ingest still accepts eight photos and recommends a front elevation. Its wording claims
  authoritative GIS and persistent-world registration despite an OSM/demo/local-state path.
- Sample documentation still describes the fixture set; the real sample is not an obvious,
  provider-independent, one-click demo entry point in the reviewed UI.
- The recorded sponsor investigation has no actionable import contract. Do not invent an integration.

## 1. Connect authoritative placement and export (first implementation slice)

Use `requestFit` for a server-generated mesh. Construct its request using the existing plan-coordinate
helpers, original asset axes/units, local origin, actual footprint provenance, and supplied neighbors.
Store the returned PlacementManifest. Apply its matrix to the raw asset exactly once; do not apply
the viewer's prior normalization a second time.

Render server metrics and accepted/review/rejected states directly. Use the same matrix in Fit and
Explore, restore it from the saved job, and download the existing backend ZIP. Browser solving remains
an explicitly labeled simulation/manual-import preview. Invalidate placement when its asset or
footprint changes. Do not invent a scalar confidence score for server results.

**Done:** one fixture and the existing real job travel through Fit → Export → fresh reload with matching
transforms and metrics, without a generation POST. The real rejected sample stays rejected visibly.
Add focused integration coverage for this missing connection, not another suite of provider mocks.

## 2. Establish one presentable real sample (bounded asset work)

First inspect the existing GLB in shaded and wireframe views beside the photograph and true footprint.
Distinguish background/ground-slab contamination, a conservative proxy, and actual building-shape
mismatch before changing algorithms or spending another generation.

Prefer one simple detached building whose real footprint suits the existing uniform solver. Keep DDS
as a useful review/rejection example if its concavity blocks the success path. Obtain confirmation
that any replacement photo and footprint identify the same building.

Align upload limits with four views and explain consistent overlapping angles. If another generation
is warranted, use the existing hosted provider and remesh settings. A single bounded comparison of
original-photo geometry plus concept-guided texture against the current styled-view route is optional
only if inspection points to inconsistent edited views. It is not required to complete slice 1.

**Done:** a recognizable real model, useful placement with measured spill/coverage and honest review
state, readable textures, recorded triangle/file counts, and acceptable interaction on the demo laptop.
Target at least 30 FPS and roughly 30–60k triangles as engineering goals, not provider guarantees.
Never lower thresholds or deform the asset silently to manufacture an accepted result.

## 3. Make the finished result easy to use and recover

Add an explicit “Load completed real example” entry point backed by cached local artifacts and the
saved footprint/manifest. It must not depend on paid generation or fresh geocoding. Separate this
from the synthetic example. Support exported placement reload so another person can verify the result.

Correct ingestion labels: OSM is identified as OSM; a demo fallback is unmistakable; local spatial
indexing is not sponsor registration. Permit explicit building/footprint confirmation. Describe
height and hidden surfaces as inferred. Preserve useful review results instead of treating every
imperfect asset as an unusable workflow.

**Done:** a fresh browser can load, inspect and export the real example with provider/GIS access
disabled; fresh live jobs still show real status and resume without duplicate submissions.

## 4. Package and freeze

Document exact startup commands and environment loading, replace stale README status, and prepare a
three-minute demo plus backup recording. Laptop deployment is sufficient for the core. If public live
hosting is needed, use one backend process and persistent SQLite/artifact storage; restrict paid job
creation to the operator. Avoid multi-user infrastructure.

Deliver the unchanged GLB plus hash-bound placement/provenance bundle as the sponsor handoff. Add an
actual import only when a concrete sponsor contract is supplied. Keep `world_registration` honest.

## Deferred work and decision gates

Google's photogrammetry approach is relevant to longer-term geometry quality. COLMAP/OpenMVS or VGGT
would add a new capture contract, processing environment, meshing/cleanup path, and acceptance work.
Do not introduce them before the existing mesh-to-export slice is complete. Revisit only if actual
asset inspection shows hosted generation cannot meet this selected-building MVP and usable overlapping
photographs plus execution hardware are available.

Also defer Google map rendering, additional navigation features, broad address coverage, arbitrary
concave/courtyard optimization, and architecture rewrites. A small targeted geometry fix is justified
only by a reproducible failure in the selected sample.

If time is short: complete slice 1, cache the best genuine result with honest review status, and package
the demonstration. Authoritative Fit/Explore/Export wiring and the static cached entry point are implemented.
The next milestone is a stronger real transformation and demo packaging.
