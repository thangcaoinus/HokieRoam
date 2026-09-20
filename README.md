# HokieRoam

**Reimagine a place. Walk into your idea.**

Building photographs and a sentence of prompt become a restyled 3D model, snapped onto the real
OpenStreetMap footprint of the building it came from, with an inspectable 4×4 transform, an export
bundle, and a scene you can walk around.

VTHacks 14 · Procedura AI track.

---

## See it without installing anything

Every example below loads from static files. **No backend, no API key, no geographic lookup, no
network beyond the page itself.**

Append the query to the app URL — `https://<host>/?example=burruss` on the deployed build, or
`http://localhost:5173/?example=burruss` after `./dev.sh --sim`. The first one is also what the
**Load completed real example** button on the opening screen opens.

The same building, the same four photographs, the same authoritative footprint. Only the prompt
changes:

| Open | Style | Placement | IoU |
| --- | --- | --- | --- |
| `?example=burruss` | Medieval ruin | rejected | 73.13 % |
| `?example=burruss-solarpunk` | Solarpunk Bloom | rejected | 70.56 % |
| `?example=burruss-noir` | Neon Noir | rejected | 70.41 % |
| `?example=burruss-fantasy` | Enchanted Citadel | rejected | 69.90 % |
| `?example=burruss-scorched` | Scorched Nebraska | rejected | 59.60 % |

A second building, the same apocalypse prompt — a 2024 research building instead of a 1936
collegiate-gothic hall:

| Open | Building | Placement | IoU |
| --- | --- | --- | --- |
| `?example=gilbert-scorched` | Gilbert Place | review | 33.67 % |
| `?example=dds` | Data and Decision Sciences | rejected | 52.62 % |

**Those numbers are the point, not an apology.** The software measures its own output against the
authoritative footprint and refuses the ones that do not earn an `accepted`. The spread across the
Burruss rows is a real finding: the *destructive* prompt costs 13.5 points of footprint fidelity,
because it asks for collapse and rubble, while the additive ones — vines, gardens, spires — cost
about three. Creative freedom has a measurable price in placement accuracy, and this shows it.

## What it actually does

1. **Ingest** — geocode an address, pull its OpenStreetMap building footprint (multipolygon
   relations included — around the Drillfield, 4 of 13 buildings carry the `building` tag on the
   relation, Burruss among them), and take up to four photographs of the same building.
2. **Redesign** — one `image-to-image` call per view against the style prompt, so the four styled
   views stay consistent with each other.
3. **Reconstruct** — one `multi-image-to-3d` call over all four concepts.
4. **Fit** — the authoritative step. Normalize units, axes and pivot; ground the mesh; test the four
   cardinal rotations for best footprint overlap; prefer proportion-preserving uniform scale; check
   overlap with neighbouring parcels; then report `accepted`, `review` or `rejected` with the IoU,
   coverage, spill and the factored 4×4 matrix that produced it.
5. **Explore** — orbit, or walk the exterior in third person.

Then export a ZIP holding the unchanged GLB, the placement manifest, the source photographs, the
concepts and the provenance — and reopen that ZIP later, hash-checked, straight back into Explore.

## What it does not do

- **There is no Procedura / Scorched Nebraska import.** The ZIP is a handoff artifact. No endpoint
  has been verified, and none is claimed.
- **Facade heading is unverified and height is inferred.** Both are labelled that way on screen,
  every time. Terrain is flat-assumed.
- **Walk mode is exterior only.** No interiors are reconstructed and none are claimed.
- **The mesh proxy is a projected convex hull**, so a building with wings or a courtyard is scored
  conservatively. A more faithful concave proxy was measured and scored *worse*, which is a real
  property of these generations rather than a shortcut.
- Prompts steer the **image** step only. The 3D step receives no text, so creative direction reaches
  the mesh through the pixels of the styled concepts and nothing else.

## Run it

```bash
./dev.sh          # fixture provider: API on :8000, web on :5173, wired, spends no credits
./dev.sh --sim    # frontend only, labelled browser simulation
./dev.sh --meshy  # live provider — SPENDS REAL CREDITS
```

Frontend and backend detail, including the browser checks: [`web/README.md`](web/README.md).
Generation provenance for every shipped asset: [`samples/`](samples/).

The header chip never lies about what produced what on screen: `Local AI simulation`,
`Pipeline API connected · fixture (synthetic)`, or `· meshy`.

## Layout

| Path | What |
| --- | --- |
| `web/` | React + three.js front end, five stages plus four no-backend entry points |
| `server/` | FastAPI pipeline service; `app/geometry/` is the authoritative fit and stays dependency-pure |
| `samples/` | Every real generation, with its prompt, job id, provider task ids and bundle |
| `web/public/examples/` | The static, offline-loadable demo examples listed above |
| `CLAUDE.md` | How to work in this repo |
| `DESIGN.md`, `PRODUCT.md` | The visual system as built, and durable product truth |

Planning and status documents live in `internal/` and are not tracked — they were the working record
of a 36-hour build and several of them supersede each other.
