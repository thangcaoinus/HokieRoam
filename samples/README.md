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
