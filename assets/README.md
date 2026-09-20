# assets/ — Devpost gallery

Captured 2026-09-20 from the running app by `web/scripts/capture-assets.mjs`. Everything here is a
real screenshot of real output: the cached Burruss generation, the live Nominatim + Overpass lookup,
and the measured placement. Nothing was mocked up or retouched.

Regenerate (the whole set, or one image by number):

```bash
./dev.sh                                    # or: npx vite --port 5174 --strictPort
cd web
PLAYWRIGHT_MODULE=playwright-core CHECK_WEB=http://localhost:5174 node scripts/capture-assets.mjs
PLAYWRIGHT_MODULE=playwright-core CHECK_WEB=http://localhost:5174 node scripts/capture-assets.mjs 02
```

## Demo video

| File | Length | What it is |
| --- | --- | --- |
| `hokieroam-demo.mp4` | 2:53 · 1920×1080 · H.264 · 41 MB | The **Devpost demo video**. Subtitled, no voiceover. Upload to YouTube and paste the link into the Devpost video field — Devpost takes a video URL, not a file, so this is not part of the image gallery above. |

Recorded 2026-09-20 by `web/scripts/demo/` against the running app in headed Chrome (real Metal GPU,
not SwiftShader). Subtitles and title cards are injected into the page as DOM and styled from the
app's own tokens, so they are captured natively rather than burned in afterwards.

Beats: cached Burruss example and orbit → the measured placement (73.1 % IoU, **rejected**, on screen)
→ walk mode → sandbox with three models, then walk *that* scene → a real address, three Gilbert Place
photographs and a futuristic prompt → **a genuinely new Meshy job**, submitted on camera and running
live → cut → the returned model fitted to the real OSM footprint at **61.2 % IoU, rejected**.

The same honesty rule as the images applies, and it cost a take: one recording resolved the address
while Overpass was unreachable, so the fit scored **73.9 % against the synthetic demo parcel** rather
than the authoritative footprint. That take was discarded, and `seg-finish.mjs` now retries the lookup
and aborts rather than record a fit measured against a fake footprint. Neither verdict in the film was
tuned; the generation cost 4 submissions and re-takes cost none, because the finish segment replays the
finished job by idempotency key instead of paying twice.

## Suggested upload order

| File | Size | What it shows |
| --- | --- | --- |
| `00-devpost-thumbnail.png` | 2400×1600 | **Project thumbnail** (3:2). Mark + wordmark + pitch line, built from the app's own favicon and typeface. |
| `01-fit-placement-verdict.png` | 3200×2000 | **Lead image.** The verdict band — REJECTED, IoU 73.1 %, coverage, spill, neighbour overlap — above the placed building, where the red authoritative footprint and the black mesh hull visibly disagree. |
| `02-explore-walk-hokiebird.png` | 3200×2000 | The HokieBird avatar walking the real footprint, with the live map-anchored readout. The avatar is itself a Meshy generation from four mascot photos. |
| `03-redesign-before-after.png` | 3200×2000 | Source photograph against the AI concept, with the prompt. The transformation people grasp in one second. |
| `04-style-comparison.png` | 2760×928 | One building, five prompts, same four photographs and footprint — each scored. The argument that the ceiling is the generator, not the solver. |
| `05-ingest-footprint.png` | 3200×2000 | Address → live Nominatim geocode → Overpass → OSM relation/1074686 hatched on the campus basemap, with area, OBB, vertex and neighbour counts. |
| `06-transform-matrix.png` | 3166×1498 | The reproducible 4×4 placement transform with its provenance — and the five warnings the engine raises about its own result. |
| `07-manual-placement.png` | 2560×2000 | The manual-review surface (deck p.58 step 10): drag to correct, metrics recompute live, and the correction is never reported as the computed result. |
| `08-reconstruct-asset-report.png` | 3200×2000 | Concept → textured mesh, with the asset report: triangles, source axis, inferred units, raw extent before fitting. |

## What was and was not suppressed

These are marketing images, so the rule was: **nothing that makes a claim is hidden.** The rejected
verdict, every IoU, the `Cached real example · Meshy` chip and all provenance labels appear exactly
as the app renders them. Two things are hidden, both transient chrome rather than claims:

- the `Click to enter the site` pointer-lock prompt, in every shot — headless Chromium cannot take
  pointer lock, so the modal would otherwise sit over the scene;
- in `02` only, the floating readout panel (`.explore > .glass`), which at spawn distance covers the
  building the shot is about. The same two facts it carries (`PLACEMENT rejected`, `IOU 73.1%`)
  remain visible in the left rail of that image.
