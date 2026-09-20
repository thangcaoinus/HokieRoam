# Burruss Hall — medieval-fantasy redesign (four views)

Building: **Burruss Hall, Virginia Tech, Blacksburg, Virginia**.

Exact user prompt:

> Make this looks like an old building medieval fantasy building with greenery, but contained,
> not like complete overhaul of it, but just some modification to howw the wall, maybe some hole,
> maybe vine, etc... but still recognizable as burruss hall

Live Meshy run (`provider: meshy`), job `41db2b5c7f3440869efeebf3ed788874`, completed 2026-09-19.
Settings: strength **0.8**, image model **nano-banana**, mesh model **meshy-6**, target **60,000
polygons**. This is the four-view companion to `../burruss-medieval/` (same prompt, one view).

## How the four images reach the API

Five paid submissions, and **only one of them is a 3D call**:

- **4 × `image-to-image`** — Meshy's styling endpoint takes a single `reference_image_urls[0]`
  (`server/app/providers/meshy.py:56`), so each photo is styled in its own call. There is no
  batched form of this endpoint.
- **1 × `multi-image-to-3d`** — all four styled concepts go up together in one call as
  `"image_urls": uris` (`meshy.py:65`). This is the actual 2D→3D step.

Skipping the styling pass and posting the four raw photos straight to `multi-image-to-3d` would be
a single API call, but that endpoint takes no style prompt — the medieval/vine request would be
dropped entirely. That is why the styling pass exists.

## Files

- `inputs/` — the four photographs submitted, in generation order.
- `job.json`, `generation.log` — final status, provider task IDs, local progress log.
- `result/` — `source{,_2,_3,_4}.jpg`, `concept{,_2,_3,_4}.png`, `model.glb`, `generation.json`.
- `bundle.zip` — the pipeline export.
- `run_generation.py` — resumable runner; re-running re-attaches to stored task ids, never resubmits.

## What actually came back — honest read

- **Concepts**: the oblique tower view (`concept_2.png`) is the strongest — dense ivy, weathered
  stone, and **gargoyles added at the tower corners**, so the medieval-fantasy half genuinely
  landed there. The front-wide view is mostly ivy with little else, the same weak result the
  1-view run gave. The requested wall **holes / structural damage did not appear in any view** —
  `meshy.py:59` appends "Preserve building silhouette, perspective, and visible structural layout"
  to every prompt, which directly opposes asking for holes. That suffix must be relaxed to get them.
- **Mesh**: 111,038 vertices / 59,246 faces, extents ≈ `1.90 × 0.97 × 1.28` in Meshy's normalized
  unit box (**not** metres; the fit stage rescales). Clearly better than the 1-view run: the top
  projection is a **real rectangular footprint with wings**, not the rounded blob single-view
  reconstruction produced, and the side elevation has a tower with genuine depth. Four views from
  different angles is what buys the back and sides.
- **No fit/placement was requested or run** for this asset.

## Photo credits

Same four sources as `../burruss-green-scape/README.md` — see that file for per-image author and
license (Buridan, public domain ×2; Ben Schumin, CC BY-SA 2.0; Campus360, license unspecified).
The concepts are AI-modified derivatives; preserve attribution and applicable share-alike terms.
Generation does not imply endorsement by the photographers or Virginia Tech.
