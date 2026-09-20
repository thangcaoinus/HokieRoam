# Cached demo sample: Data and Decision Sciences Building

- **Source photo:** `photo.png` (operator supplied)
- **Footprint:** OpenStreetMap way [1174211880](https://www.openstreetmap.org/way/1174211880), cached as
  `way-1174211880.osm`
- **Building:** Data and Decision Sciences Building (DDS), 727 Prices Fork Road, Blacksburg, VA 24061
- **Identity:** operator-confirmed; the photo and OSM footprint refer to the same building
- **Generation prompt:** `Modern Hokie Stone academic building with large glass curtain walls, preserve
  roofline and massing.`

`concept.png`, `model.glb`, and `manifest.json` are cached from the **fixture provider**. They are a
synthetic brown image and box mesh used to exercise the offline pipeline, not Meshy output and not a model
of DDS. The fixture model is deliberately expected to fail the actual-footprint fit check for this concave
building; the cached manifest records that rejection.

The footprint is complex and concave. It is a useful honest review-path sample, but a generated convex
mesh may be rejected by the authoritative fit check rather than forced into this outline.

## Genuine cached generation in `live/`

`live/concept.png`, `live/model.glb`, `live/manifest.json`, and `live/bundle.zip` are from a completed
Meshy run. They are separate from the fixture files described above. The ZIP contains the original
source photo and generation provenance as well as the model and placement.

Visual inspection during placement integration found recognizable facade detail and surrounding
paving in the generated asset. The concept is a subtle restyle, and the model does not reproduce
the full concave DDS footprint. The model has 1,746,050 triangles and is 62,465,636 bytes. Its saved
placement is **rejected** (IoU approximately 52.6%), heading is unverified, and height is inferred.
Keep it as an integration/review example; a lighter, more compelling transformation is still needed
for the main pitch. No new paid generation was performed during this inspection.

## Browser-ready derivative

`web/public/examples/dds/` contains a reproducible simplified copy: **59,962 triangles** and
**12,907,244 bytes** for the GLB. `web/scripts/prepare-example.mjs` uses meshoptimizer simplification
with a 0.005 error limit and reruns the backend fitter. Placement remains rejected (IoU 52.6204%).
Source/derived hashes, settings, generation provenance, and placement accompany the export ZIP.
Original live assets remain untouched. The building remains visually recognizable; laptop frame rate
has not been measured. Use **Load completed real example** to inspect it without backend or GIS.
