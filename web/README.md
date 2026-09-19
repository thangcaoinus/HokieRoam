# Groundtruth — web frontend

Photo → AI redesign → 3D mesh → footprint-snapped, map-ready asset → walkable scene.

```bash
cd web
npm install
npm run dev        # http://localhost:5173
```

## Stages
1. **Ingest**: geocodes the address (Nominatim), pulls the building footprint and adjacent parcels (Overpass/OSM) and registers a geohash bucket. Falls back to a demo parcel if OSM is unreachable.
2. **Redesign**: image-to-image restyle with four presets (Scorched Nebraska, Hokie Smart Campus, …) and a before/after slider.
3. **Reconstruct**: image-to-3D mesh (or upload your own `.glb` / `.obj`).
4. **Fit & Align**: the real alignment engine (`src/lib/fit.ts`): axis/unit normalization, AABB grounding, rotating-calipers OBB, Δθ + k·90° IoU search, proportional / constrained scaling, parcel collision checks and an exportable 4×4 transform (`transform.json` + map-anchored GLB).
5. **Explore**: third-person capsule controller (WASD, Shift, Space, mouse-look), lerped over-the-shoulder chase camera, collision against the footprint polygon, the fitted hull and the neighbors.

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
