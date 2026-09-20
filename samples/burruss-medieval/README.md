# Burruss Hall — medieval-fantasy redesign

Building: **Burruss Hall, Virginia Tech, Blacksburg, Virginia**.

Exact user prompt:

> Make this looks like an old building medieval fantasy building with greenery, but contained,
> not like complete overhaul of it, but just some modification to howw the wall, maybe some hole,
> maybe vine, etc... but still recognizable as burruss hall

Live Meshy run (`provider: meshy`, `live: true`) — not simulation, not fixture. **One** source
photograph was restyled and that single concept fed the 3D build, so this run cost exactly two
paid submissions. Settings: strength **0.8**, image model **nano-banana**, mesh model **meshy-6**,
target **60,000 polygons**. Job `97b27cfe211a49ff96a59af2fa508361`, completed 2026-09-19.

## Files

- `inputs/01-front-wide.jpg` — the single photograph submitted.
- `job.json` — final job status and provider task IDs.
- `generation.log` — local progress log.
- `result/` — `source.jpg`, `concept.png`, `model.glb`, `generation.json` (with sha256s).
- `bundle.zip` — the pipeline export (20 MB).
- `run_generation.py` — resumable runner; re-running re-attaches to the stored task ids and never
  resubmits. Requires the backend environment and `MESHY_API_KEY`.

## What actually came back — honest read

- **Concept**: heavy ivy over the whole facade, mossy roof, weathered stone. The *medieval-fantasy*
  half of the prompt landed only faintly, and the requested "maybe some hole" / wall damage did
  **not** appear. Likely cause: `meshy.py` appends an instruction to preserve the building
  silhouette, perspective and visible structural layout to every prompt, which directly opposes
  asking for holes in the wall. To get structural damage, that suffix has to be relaxed.
- **Mesh**: 104,419 vertices / 59,976 faces, GLB extents ≈ `1.90 × 1.19 × 1.20` (Meshy's own
  normalized unit box — **not** metres; the fit stage rescales). The front elevation is clearly
  recognizable as Burruss: central tower with twin turrets, symmetric wings, entrance steps.
  Side and top projections show the usual **single-view artifact** — depth is invented, the rear
  half is a rounded blob, and the foreground trees from the photo are baked into the mesh as
  geometry. Four-view input would fix the depth; one view cannot.
- **No fit/placement was requested or run** for this asset.

## Photo credit

[Wide front view](https://commons.wikimedia.org/wiki/File:Virginiatech-burrusshall-fromdrillfield.JPG)
by **Buridan**, public domain. The concept is an AI-modified derivative. Generation does not imply
endorsement by the photographer or Virginia Tech.
