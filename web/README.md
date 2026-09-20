# Groundtruth — web frontend

Photo → AI redesign → 3D mesh → footprint-snapped, map-ready asset → walkable scene.

```bash
cd web
npm install
npm run dev        # http://localhost:5173
```

## Multi-model sandbox

Open **Sandbox · multiple models** in the sidebar. Import multiple `.glb` or `.obj` files
at once, or drop them onto the scene. GLB preserves embedded textures; OBJ imports geometry.
You can also add the current pipeline model. Imports are centered, grounded, and initially spaced apart.
Matching models preserve the full fitted dimensions used by Explore. Unit-sized imports (all dimensions
under 5 m) scale uniformly to the current fitted building’s height, or a labeled 20 m estimate when
there is no building reference. **Recalculate building sizes** reapplies this sizing to existing models;
the inspector shows the source and lets you override height. Estimates are not measured dimensions.

Select a model in the scene or list, then drag its ground-plane handles. The inspector edits X/Z,
rotation, and uniform size through height. **Frame all** fits the entire scene. **Walk scene** keeps
every model visible: click to capture the mouse, use WASD, Shift to sprint, Space to jump, and Esc
to release. Walking uses Explore’s third-person camera, environment, minimap, live readout,
reset controls, and collision against every model’s transformed plan silhouette. Q/E orbit the
camera. **Edit scene** returns to arranging.

The sandbox is a separate local scene, retained across pipeline navigation but cleared on page refresh.
It has no geographic anchor or placement score. Set model heights when imported units are unsuitable.

With a Vite dev server on port 5175, `node scripts/check-sandbox.mjs` verifies multi-import, independent
transforms, a real gizmo drag, walking, navigation, failed imports, and removal. Set `PLAYWRIGHT_MODULE`
to an installed Playwright package and `CHECK_WEB` to override the server URL if needed.

## Completed real example

Click **Load completed real example**, or open `/?example=dds`. Static files in
`public/examples/dds/` include source/concept images, the simplified Meshy model, recomputed placement,
and an export ZIP. Orbit, walk, source/prompt inspection, export and refresh require no API or GIS.
The rejected placement remains visible.

Run `npm run prepare:example` to rebuild the derivative from `samples/live/` (requires the server's
Python environment). The script records hashes and settings, reduces 1,746,050 triangles to 59,962
and the GLB from 62.5 MB to 12.9 MB, then fits the changed geometry again. Originals remain untouched.

To verify the static production flow:

```bash
npm run build
npm run preview -- --host 127.0.0.1 --port 5175 --strictPort
# Separate terminal in web/:
node scripts/check-example.mjs
```

Set `PLAYWRIGHT_MODULE` if Playwright is installed outside this project. The check blocks external
origins, exercises exploration/export/refresh, and rejects a corrupted model hash.

## Reopen an exported ZIP

Choose **Open saved ZIP** on Ingest and select a Groundtruth export containing `model.glb`,
`placement.json`, `generation.json`, and the source photo(s). The app verifies artifact hashes,
restores the saved placement without fitting again, and opens Explore. It keeps the original ZIP
in IndexedDB for refresh and re-exports the same bytes. **New** clears the active saved result.
If browser storage is unavailable, reopen the ZIP after refreshing.

Import currently supports self-contained GLBs and the UI's flat, hole-free OSM/synthetic placement
contract, with default fit settings and inferred units. Unsupported manifests and mismatched files
show an error before replacing the current project. A restored fit status is the exported evaluation;
hashes detect changed artifacts, not the authenticity of whoever supplied a bundle.

Run `node scripts/check-bundle.mjs` against the same production preview above to check import,
orbit/walk, matrix values, exact re-export, refresh, provenance, reset, and corrupt-file rejection.
ZIP decoding uses [fflate](https://github.com/101arrowz/fflate).

## Stages
1. **Ingest**: geocodes the address (Nominatim), pulls the building footprint and adjacent parcels (Overpass/OSM) and registers a geohash bucket. Falls back to a demo parcel if OSM is unreachable.
2. **Redesign**: image-to-image restyle with four presets (Scorched Nebraska, Hokie Smart Campus, …) and a before/after slider.
3. **Reconstruct**: image-to-3D mesh (or upload your own `.glb` / `.obj`).
4. **Fit & Align**: the real alignment engine (`src/lib/fit.ts`): axis/unit normalization, AABB grounding, rotating-calipers OBB, Δθ + k·90° IoU search, proportional / constrained scaling, parcel collision checks and an exportable 4×4 transform (`transform.json` + map-anchored GLB).
5. **Explore**: third-person capsule controller (WASD, Shift, Space, mouse-look), lerped over-the-shoulder chase camera, collision against the footprint polygon, the fitted hull and the neighbors.

For API-generated meshes, Fit calls the backend and shows its accepted/review/rejected result.
Explore starts with orbit inspection and also offers the existing exterior walk mode and camera reset.
Both views apply the saved column-major matrix once to the unchanged GLB. Export downloads the backend
ZIP, including `placement.json`. Refresh restores the placement only when the downloaded asset hash
and current footprint, frame, provenance, neighbors, axes and units still match. Changing those inputs
requires another fit. Browser fitting and its standalone exports remain preview-only for simulations
and manually uploaded meshes.

## Placement integration check

Run these in separate terminals from the repository root. Use a disposable data directory;
these commands select the synthetic fixture provider and do not call Meshy.

```bash
cd server
PIPELINE_PROVIDER=fixture PIPELINE_MAX_SUBMISSIONS=100 PIPELINE_DATA_DIR=/tmp/groundtruth-placement-check PIPELINE_CORS_ORIGINS=http://localhost:5174 .venv/bin/uvicorn app.main:app --port 8001
```

```bash
cd web
VITE_API_BASE=http://127.0.0.1:8001 npm run dev -- --host 127.0.0.1 --port 5174 --strictPort
```

With Playwright and its Chromium headless shell available, run from the repo root:

```bash
node web/scripts/check-placement.mjs
```

If Playwright is provided outside this project, set `PLAYWRIGHT_MODULE` to its absolute package path.
The script refuses to submit jobs to a non-fixture provider. It checks actual rendered matrices in
Fit, orbit and walk views, refresh without generation, export, and footprint invalidation. Results
are written under `/tmp/groundtruth-placement-check-results`. Optional `CHECK_REAL_JOB` names an
already cached real job in the same isolated server for an additional rejected-sample check.

## Polygon target

In **Redesign**, edit **Target polygons for 3D** before generating. The UI defaults to 60,000 and
accepts whole numbers from 100 to 300,000. This setting controls remeshing for the next API job;
it does not modify an already-loaded model or change fixture geometry. Actual counts can differ.

`POST /v1/jobs` accepts optional `target_polycount`. The value is saved per job, exposed on its
response, passed to Meshy, and included in `generation.json`. If omitted, the backend uses
`MESHY_TARGET_POLYCOUNT`. Changing the UI target changes the generation fingerprint; retrying an
existing request key preserves that job's original settings. Restart the Python backend after this
change so it accepts the new field.

`node scripts/check-polycount.mjs` checks the control on the dev UI at port 5174 with all API calls
mocked. Configure `VITE_API_BASE` for that dev UI; no running provider is required by the check.

## Backend hook-up
Set `VITE_API_BASE` in `web/.env.local`. The client lives in `src/lib/api.ts`, whose types mirror
`server/app/schemas.py` field for field.

The API is **asynchronous**: generation takes minutes, so nothing returns the asset inline. A POST
returns a job id; the client polls.

```
GET  {API}/v1/health                          → { provider, live, submissions_used }
POST {API}/v1/jobs                            → 202 JobView
     multipart: image, prompt, strength (0..1), kind (pipeline|redesign|reconstruct)
     header:    Idempotency-Key — a repeat returns the same job, never a second paid generation
GET  {API}/v1/jobs                            → JobView[]
GET  {API}/v1/jobs/{id}                       → JobView            (the poll endpoint)
GET  {API}/v1/jobs/{id}/artifacts/{name}      → bytes              (name: source | concept | model)
POST {API}/v1/jobs/{id}/fit                   → PlacementManifest  (body: FitRequest)
GET  {API}/v1/jobs/{id}/export                → application/zip
```

Typical flow: `createJob({ image, prompt, strength, idempotencyKey })` → `pollJob(job_id, { onUpdate })`
→ `artifactUrl(job, 'model')` → `requestFit(job_id, …)` → `exportUrl(job_id)`.

Polygons crossing this boundary are **plan coordinates, (East, North) in metres**, not scene x/z.
`api.ts` exports `planFromScene` / `sceneFromPlan` for the `(East, North) = (x, −z)` flip — use them
rather than re-deriving the sign.

Without `VITE_API_BASE`, both steps run as local simulations (a canvas restyle and a procedural
textured mesh exported Z-up in centimetres, so the fitting engine has real work to do). The header
chip says which mode is active; simulated output is never presented as AI generation.

## Creative appearance prompts

In **Redesign**, edit **Creative prompt** to describe facade materials, colors, greenery or
lighting, then click **Generate concept** (or **Regenerate concept**). Presets replace the text;
the three idea buttons append to it. Prompts must contain non-whitespace text and at most 2,000
characters. The live pipeline passes the prompt to image generation with a request to preserve the
building silhouette and structural layout, then reconstructs the resulting concept into 3D.
The prompt is retained across API-session refreshes and in the exported `generation.json`.

The offline simulation interprets a small vocabulary of style and color keywords. It provides a
deterministic image-wide color/overlay preview, without understanding arbitrary instructions or
segmenting the building. Later matching keywords override earlier ones. The fixture backend
continues to produce its explicitly labelled placeholder.

`node scripts/check-creative-prompt.mjs` tests validation, idea insertion, request text, refresh,
generation keys and different canvas previews with mocked API calls. Like the polygon check,
it expects an API-configured Vite dev server at port 5174; override with `CHECK_WEB` and point
`PLAYWRIGHT_MODULE` to an installed Playwright module if needed. No provider credits are used.
