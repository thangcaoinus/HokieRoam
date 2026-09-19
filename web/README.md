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
Set `VITE_API_BASE` in `web/.env.local`. The UI then calls:
- `POST {API}/redesign` (multipart: `image`, `prompt`, `strength`) → image blob
- `POST {API}/reconstruct` (multipart: `image`) → `.glb` blob

Without it, both steps run as local simulations (a canvas restyle and a procedural textured mesh exported Z-up in centimetres, so the fitting engine has real work to do).
