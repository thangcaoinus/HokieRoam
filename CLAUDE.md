# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> Note: `/home/thangcao/CLAUDE.md` is auto-loaded here because this repo sits beneath it. It describes an
> unrelated VT DSA study-group repo (Beamer slides, C++ teaching material). Ignore its content rules; only
> its two working principles carry over — state what is actually true, and re-sync this file when a task ends.

## Project

**Groundtruth** — VTHacks 14 entry (Procedura AI track). Pipeline: real address + building photo + style
prompt → AI image-to-image redesign → image-to-3D mesh → an automatically computed transform that snaps
that mesh onto the authoritative GIS footprint → inspectable 4×4 matrix, exported GLB + placement manifest
→ third-person walkable scene.

Document authority, in order (re-read all root `.md` files 2026-09-19; design docs added
2026-09-20). **The planning and status documents moved to `internal/` on 2026-09-20 and are
gitignored** — they are the working record of the build, they contradict each other by design,
and the public front is now the README and the code. They are still on disk; read them there.
- `DESIGN.md` — **the visual system as built** (survey-sheet world: tokens, type, structure, motion,
  the accessibility rule, and the two compositing traps). Read before touching `web/src/styles.css`
  or any colour in a component.
- `PRODUCT.md` — durable product truth: audience, the judging scene, and the constraints that bind
  the interface (honesty labels, offline, bad numbers stay visible).
- `internal/mvp-next-steps.md` — **active scope**: what "done" now means (one real building end to end),
  the four remaining slices and the deferred-work gates. It supersedes the 16-hour countdown.
- `internal/progress-report.md` — **what is actually built and what was checked**, slice by slice, with the
  limitations spelled out. The most current status document; trust it over older plans.
- `internal/pitch-plan.md` — product direction and the pitch itself ("Reimagine a place. Walk into your idea.").
  Creative framing, not an engineering status.
- `internal/work-split.md` — **who does what**: self-contained lanes P0–P6, file ownership, and the frozen HTTP
  contract. Read this before picking up a task; it is the collision guard.
- `internal/feasibility-plan.md` — coordinate/geometry/export contracts and the service-boundary sketch (§4, §5, §6, §8).
- `internal/technical-reference.md` — research and deferred scope. Consult for a specific question; not a build order.
- `internal/implementation-plan.md` — the original 16-hour schedule. **Historical**; its countdown is not evidence
  of remaining time.
- `internal/spec.md` — the original pitch. What judges were promised, not what is being built.
- `devpost-story.md` — the **Devpost Project Story** (written 2026-09-20): inspiration, build, the
  measured negative results, what was learned. Written to be pasted into the Devpost story field as
  Markdown + LaTeX. Every number in it was read off the shipped artifacts or a command run that day —
  keep it that way if it is edited, and it lists the failing `check-sandbox` walk step rather than
  hiding it.
- `README.md` — the public entry point; points at the example flows and the documents above.

## What the sponsor actually asked for (researched 2026-09-19)

Primary sources: opening-ceremony deck pp. 55–59 (embedded images — render them, `pdftotext` misses them),
the [hacker guide](https://vthacks.com/guide), [Devpost](https://vthacks-14.devpost.com/), and
[scorchednebraska.org](https://scorchednebraska.org/). Do not re-research this; it is settled.

**There is no Procedura API, and no integration surface of any kind.** No developer portal, no docs, no
endpoint, no auth, no mesh format spec, no asset submission system. Devpost lists the track as
"Details TBD." Scorched Nebraska renders with custom OpenGL — not Unity or Unreal — so there is not even a
standard package format to target. The public challenge statement is one sentence: *"Turn building photos
and an address into a correctly placed, map-ready 3D model for Scorched Nebraska."*

**The challenge is to independently rebuild Procedura's own pipeline, not to plug into it.** Deck p.55
lists what Procedura does ("resolves the address and authoritative building footprint / coordinates the
image-editing and 3D-generation workflow / records the generated asset and its provenance / returns the
mesh to the map with a reproducible placement transform") and pp. 57–58 ask the hacker to do the same list.
The prize is internship opportunities rather than cash, which frames the track as a recruiting filter:
execution and explanation of a known algorithm, not novelty.

**Deck p.58 is effectively the grading rubric.** Ten steps: geocode the address · match the authoritative
footprint · normalize mesh units, axes, orientation and pivot · center and ground the mesh · test likely
rotations for best footprint alignment · **prefer proportion-preserving uniform scaling** · **allow limited
non-uniform scaling when necessary** · validate footprint overlap and nearby collisions · store a
reproducible placement transform · **send uncertain results for manual review**. p.57 names the core
challenge as correct position, scale, rotation and ground alignment. Treat this list as the definition of
done for the geometry lane.

**Judging: nobody runs the code.** Science-fair style in NCB (160/260/320/360), **3 minutes to present +
1 minute of questions**, presented *multiple times* to different panels. Hard gate: the **Devpost entry is
due 8:00 AM Sunday, September 20** — project description plus demo links judges can open. `internal/spec.md` says
"3- to 5-minute presentation"; the guide supersedes it, rehearse to three minutes.

Consequences that should drive priorities:

- **The diagnostics are the proof.** No machine verifies the placement; a human looks at the screen for
  180 seconds. `FitStage` — matrix factorization, IoU, footprint overlay, before/after — is the centerpiece.
  `ExploreStage` proves nothing about placement correctness and is correctly optional.
- **The demo runs 5–10 times in a row**, so it must reset in seconds and work on bad conference wifi or
  none at all. This is what makes the cached sample load-bearing rather than polish, and why the offline
  `demoGeo()` fallback must be verified with the network actually off.
- **Never demo a live paid generation as the main flow** — it takes minutes and the slot is three. Show the
  labeled cached asset; start a fresh job at the top of the demo so it runs visibly while you talk.
- **Expect the Q&A to probe the honest edges**: L-shaped/concave footprints, facade heading, where the
  height came from. The `ambiguous` / `inferred` / `flat-assumed` / `review` labels are the strength here,
  not a weakness — surface them on screen.

**One open question, worth one Discord message.** Deck p.55 claims Procedura "resolves the address and
authoritative building footprint." If they actually provide that service for the challenge, the repo is
currently reimplementing their product with Nominatim and Overpass, and the P1/P2 lanes change shape. The
hacker guide says company-specific details are posted on Discord and mentors are reachable via the help
desk. Ask; do not assume.

## Repository state (verified 2026-09-19, re-checked after the four MVP slices)

Be precise about this. The two halves now do talk, and the browser fit is no longer in the
authoritative path for API assets.

| Area | State |
| --- | --- |
| `web/` | Complete 5-stage UI plus **four** no-backend entry points: **Import your own model** (`.glb`/`.obj`, no address — the derived-site path, see *Free import* below), **Load completed real example** (`/?example=burruss`, static artifacts in `web/public/examples/burruss/`; `/?example=dds` still serves the rejection example), **Open saved ZIP** (re-opens an export into Explore, hash-checked, retained byte-for-byte for re-export), and the labelled local simulation when `VITE_API_BASE` is unset. **Redesigned 2026-09-20 into the survey-sheet world** — light paper ground, ink hairlines, one vermilion, no glass/glow/gradient; see `DESIGN.md`. **Fonts are self-hosted** in `web/public/fonts/` (Archivo + Spline Sans Mono, variable woff2, 212 kB); the Google Fonts CDN link is gone because the demo must render with the network off — verified with every off-origin request aborted. `npm run build` passes — observed 2026-09-20; the >500 kB main-chunk warning is known and accepted. |
| `server/` | **Working pipeline service.** `app/main.py` (assembly + lifespan), `routes.py` (all 7 `/v1` handlers), `pipeline.py` (orchestration). Drives a fixture job end to end: 1–4 photos → concepts → GLB → fit → export bundle. **`.venv/bin/python -m pytest` → 78 passed** (`test_fit.py`, `test_fit_generality.py`, `test_meshy.py`, `test_job_options.py`), observed 2026-09-20 (was 76 on 2026-09-19). **`ruff check app` is CLEAN** — the 3 × E501 from the `target_polycount` plumbing were fixed 2026-09-19. (`ruff check tests` still reports 2 × E501 in `test_job_options.py`; `tests/` is outside the documented gate.) |
| Integration | **Wired, including the fit.** With `VITE_API_BASE` set, Redesign starts one `pipeline` job via `lib/pipelineJob.ts`, Reconstruct follows the same job and loads its GLB, and a reload re-attaches from localStorage. `FitStage.tsx` is now a dispatcher — `serverMesh ? <ServerFitStage/> : <PreviewFitStage/>` (`FitStage.tsx:68`) — so a server mesh goes through `requestFit` and the server's `PlacementManifest`, and the browser `solveFit` only runs for simulation and manual imports. The same matrix drives Fit, Explore, export and refresh; changing mesh or footprint invalidates a stale placement. **The P3 gap recorded in older notes is closed.** |
| NPC avatar | **HokieBird, real Meshy generation, 2026-09-20.** `samples/hokiebird-npc/` — one `multi-image-to-3d` call (task `01a0bdb4…`, meshy-6, target 15k) from four cropped mascot photos kept in `views/`; the fourth needed its infographic overlay masked and inpainted first, because Meshy bakes on-image text into the texture. Raw output is 15,676 triangles and 13.58 MB. `web/scripts/prepare-npc.mjs` writes the browser copy `web/public/npc/hokiebird.glb` at **1.19 MB (9%)** by dropping the normal, emissive and metallic-roughness maps and resizing base colour to 1k — geometry untouched, and the two were compared on screen before the drop was accepted. It replaces the capsule avatar in Explore (`ExploreStage.useAvatar`); the capsule survives as the load-failure fallback. |
| Assets | **Re-read from the ledger 2026-09-20 05:00; the paragraph that previously stood here was wrong in both directions.** `server/.data/jobs.sqlite3` holds **5 jobs / 16 submissions** and `PIPELINE_MAX_SUBMISSIONS` in `server/.env` reads **100**. Trust the ledger over this table and re-read it before any paid work (`sqlite3 server/.data/jobs.sqlite3 'select count(*) from submissions'`). A 4-view job costs **5** slots (one `image-to-image` per view plus one `multi-image-to-3d`); a 3-view job costs 4. **Meshy balance was 854 credits before tonight's slate and 716 after five jobs** — check it with `curl -H "Authorization: Bearer $MESHY_API_KEY" https://api.meshy.ai/openapi/v1/balance`, which is the only honest read of what is left. `samples/` now carries, per building: the four-view Burruss set (`burruss-medieval-4view`, `burruss-scorched`, `burruss-noir`, `burruss-fantasy`, `burruss-solarpunk`), `burruss-medieval` (1-view comparison), `gilbert-scorched`, `live` (DDS), `old-trafford` (reconstruct-only, no concept, no footprint) and the failed `burruss-green-scape`. `samples/README.md` indexes all of them with prompts and job ids. |
| Demo assets | **Seven cached examples ship as of 2026-09-20**, all verified by `CHECK_EXAMPLE=<id> node scripts/check-example.mjs`. Five are Burruss Hall from the *same four photographs and the same footprint* (OSM **way/32963472**, height 20.7 m from the OSM tag), differing only by prompt — medieval **73.13 %**, solarpunk **70.56 %**, noir **70.41 %**, fantasy **69.90 %**, scorched **59.60 %**, every one `rejected`. **That spread is a measurement, not noise:** the destructive prompt costs 13.5 IoU points because it asks for collapse and rubble, the additive ones cost about three. This is the strongest single claim in the pitch and it only exists because the set shares a footprint. `gilbert-scorched` (Gilbert Place, 220 Gilbert Street, OSM **way/43972334**, height 30 m) is `review` at **33.67 %** with ~zero spill — it under-fills instead of spilling, the opposite failure mode, and is the only asset whose height is `source-record`. `dds` stays as the rejection example at **52.62 %** (and is rotationally indeterminate — all four candidates within 0.005). Read verdicts from each shipped `example.json`: `placement.plan_fit`, with metrics under `placement.selected.metrics`. **Never lower a threshold to turn one of these green.** |

## Commands

### everything at once (run from the repo root)

```bash
./dev.sh                      # fixture provider: API :8000 + web :5173, wired, no credits
./dev.sh --meshy              # live provider — SPENDS REAL CREDITS; aborts unless health says live:true
./dev.sh --sim                # frontend only, browser simulation mode (no backend)
./dev.sh --api-port 8011 --web-port 5184 --fixture-delay 10
```

`dev.sh` bootstraps `web/node_modules` and `server/.venv` if missing (deps only — the package stays
un-pip-installed), exports the provider env (sourcing `server/.env` only under `--meshy`, since nothing
in `app/` reads a dotenv), **writes `web/.env.local`** with the matching `VITE_API_BASE`, waits for
`/v1/health` before starting Vite, and kills both process groups on exit. Verified 2026-09-19: fixture
run on :8011/:5184 reached health + web 200 and tore both down cleanly; `--sim` serves the UI alone.
Ports are checked first and it refuses rather than picking another one. It does **not** pass
`--meshy` health as a licence to demo live — the credit cap still applies.

### web (run from `web/`)

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # tsc -b (typecheck) + vite build → dist/
npm run preview
```

No linter and no unit-test runner are configured. `npm run build` is the standing frontend gate — a clean
`tsc -b` is the check. Backend hook-up: put `VITE_API_BASE=http://localhost:8000` in `web/.env.local`
(or let `dev.sh` write it); unset means local simulation.

Browser checks live in `web/scripts/` and drive a real page with **Playwright + Chromium**. Playwright
is **not** a repo dependency: install it out of tree and point `PLAYWRIGHT_MODULE` at it. What worked
here on 2026-09-19 and again on 2026-09-20 was `npm install --no-save playwright-core` plus
`npx playwright-core install chromium-headless-shell` (the cached build must match the module's
expected revision — on 2026-09-20 the cache held **1194** and a freshly installed `playwright-core`
wanted **1243**, which fails at launch with "Executable doesn't exist" until the install command is
re-run), then:

```bash
npm run build && npx vite preview --port 5175 --strictPort &
PLAYWRIGHT_MODULE=playwright-core CHECK_WEB=http://localhost:5175 node scripts/check-example.mjs
```

`check-example.mjs` and `check-bundle.mjs` take `CHECK_EXAMPLE` (default `burruss`) and assert against
the shipped `example.json` rather than memorised strings, so they follow the example instead of pinning
one building. **Build with `VITE_API_BASE` unset** (move `web/.env.local` aside) or `check-example.mjs`
fails its "no API requests" assertion on the header's health probe. **`check-polycount.mjs` needs the
opposite build** — the target-polygons control only renders when `apiConfigured()` is true, so with the
API base unset it times out waiting for the control rather than failing an assertion. Build it with
`VITE_API_BASE=http://localhost:8000 npm run build`; it mocks every API call, so no server is needed and
no job is submitted. They are end-to-end proofs, not unit tests, and none of them submits a provider job:

```bash
node scripts/prepare-example.mjs          # rebuild web/public/examples/burruss (the demo example)
node scripts/prepare-example.mjs dds      # rebuild the DDS rejection example
node scripts/prepare-npc.mjs              # rebuild web/public/npc/hokiebird.glb from samples/hokiebird-npc/
node scripts/check-placement.mjs   # Fit/Explore/export/refresh share one matrix (needs an isolated fixture server)
node scripts/check-example.mjs     # static example loads with API + GIS blocked; corrupt hash is rejected
node scripts/check-bundle.mjs      # saved-ZIP import, re-export byte-identical, refresh
node scripts/check-polycount.mjs   # target_polycount UI → request identity, with all API calls intercepted
node scripts/check-ingest-live.mjs # NETWORK: real Nominatim + Overpass → real footprint → photo → Redesign
node scripts/check-manual-placement.mjs # drag-to-place changes live IoU, stays labelled manual, resets exactly
node scripts/check-free-import.mjs # free import: no address, no API, no GIS, no IoU and no verdict on screen
node scripts/check-sandbox.mjs     # FAILS at walk/collision (see below); needs a DEV server (vite, not preview)
```

`check-sandbox.mjs` is the one check that needs `npx vite --port 5175`, not `vite preview`: it reaches
into `/src/lib/sandbox.ts` and `/node_modules/.vite/deps/*` by dev-server URL.

`check-derive-site.ts` is not a browser check — it is a headless geometry check for
`lib/deriveSite`, run through esbuild (already a vite dependency), and it exists because the
`fillVoids` bug below is invisible to a browser test:

```bash
node_modules/.bin/esbuild scripts/check-derive-site.ts --bundle --platform=node \
  --format=esm --outfile=/tmp/check-derive-site.mjs && node /tmp/check-derive-site.mjs
```

Headless Chromium with software rendering: these prove plumbing, **not** demo-laptop frame rate.

### server (run from `server/`)

```bash
.venv/bin/python -m pytest                              # runs server/tests
.venv/bin/python -m pytest tests/test_fit.py::test_name # single test
.venv/bin/ruff check app                                # E,F,I · line-length 100
PYTHONPATH=. .venv/bin/python -c "from app.geometry.fit import fit_glb"   # import smoke check
```

`.venv/` exists (Python 3.14) with fastapi, uvicorn, httpx, numpy, shapely, trimesh, pyproj, pillow, pytest
and ruff installed. The package is **not** pip-installed — imports resolve from the working directory
(`pythonpath = ["."]` in the pytest config), so run everything from `server/`.

Serve it with `PIPELINE_PROVIDER=fixture .venv/bin/uvicorn app.main:app --reload --port 8000`. Every
route is implemented; with the fixture provider it needs no credits and no network.

```bash
curl -F image=@any.png -F prompt=test -F strength=0.8 -F kind=pipeline \
     -H 'Idempotency-Key: demo-1' localhost:8000/v1/jobs      # -> 202 JobView
curl localhost:8000/v1/jobs/{job_id}                          # poll to succeeded
```

**One-off paid asset generation** lives in `server/scripts/generate_npc.py`. It is not a pipeline job
— an NPC has no address, footprint or placement — but it deliberately goes through `MeshyProvider`
and `reserve_submission`, so the same money-protecting invariants apply: reserve before submit,
`SubmissionUnknown` is terminal, and a re-run resumes the recorded task id from its state file
instead of buying a second mesh. Never delete that state file to "retry"; reconcile in the Meshy
account first.

`PIPELINE_FIXTURE_DELAY_SECONDS=10` makes the fixture provider report realistic
queued → running → progress → succeeded transitions instead of completing instantly. The submit time
is encoded in the task id, so simulated progress survives a restart the way a real provider's does —
which is what makes the resume path testable without spending credits.

Two paid-generation harnesses live in `samples/` and are run from the repo root with the env exported
(`set -a; . server/.env; set +a`):

```bash
server/.venv/bin/python samples/run_style_generation.py <name>   # one authorized job, own .data dir
server/.venv/bin/python samples/finish_reconstruct.py <name>     # after a submission-unknown freeze
```

`run_style_generation.py` holds the slate in a `RUNS` table and gives **each job its own data
directory** (`samples/<name>/.data`), because `storage.py` assumes one worker and SQLite WAL admits one
writer — three concurrent runs sharing `server/.data` would contend mid-generation. Five ran in parallel
this way without incident. It also raises `max_submissions`, which the older
`burruss-medieval-4view/run_generation.py` hardcodes at 12 (already spent).

`finish_reconstruct.py` is the **documented human step after a `submission-unknown` freeze, not an
auto-retry**: reconcile against the provider's task list first
(`GET /openapi/v1/multi-image-to-3d?page_num=1&page_size=10`), and only submit by hand if no task was
created. That is what happened to `burruss-noir` — Meshy showed two in-progress tasks, both accounted
for, so nothing had been billed. The recovered `generation.json` records this under `recovery`.

Env: copy `server/.env.example` → `server/.env`. `PIPELINE_PROVIDER=fixture` for offline work;
`meshy` + `MESHY_API_KEY` spends real credits.

**`server/.env` is inert on its own, and `--env-file` does not rescue it.** Nothing in `app/` loads a
dotenv file, and `uvicorn --env-file` *crashes* with `ModuleNotFoundError: No module named 'dotenv'`
because `python-dotenv` is not a dependency. Both verified 2026-09-19. Export the variables instead:

```bash
# either inline
PIPELINE_PROVIDER=meshy MESHY_API_KEY=msy_... .venv/bin/uvicorn app.main:app --port 8000
# or source the file
set -a; . .env; set +a; .venv/bin/uvicorn app.main:app --port 8000
```

Confirm with `curl localhost:8000/v1/health`: **`live: true`** is the only honest proof the key arrived.
`provider` alone proves nothing — it reads `meshy` by default even with no key at all, and `live` is
false in that state. If `live` is false, nothing you see generated is real.

## Architecture

### Coordinate contract — the thing not to get wrong

Scene frame is **X = East, Y = Up, Z = South**, meters, right-handed. Plan coordinates are
**(East, North) = (scene.x, −scene.z)**. Both fit engines perform that flip (`* [1, -1]` in Python,
`-z` in TS); if you touch either, preserve it. Derivation and the ECEF/ENU math: `internal/feasibility-plan.md` §4.

- `server/app/geometry/frames.py` is the contract-correct path: pyproj WGS84 → ECEF → local ENU basis.
- `web/src/lib/geo.ts` uses a flat equirectangular approximation (`110_540` m/deg lat,
  `111_320·cos φ` m/deg lon) with the origin recentered on the matched building. Adequate for a
  campus-scale demo, but **not the same math** — do not assume the two agree to the meter.
- Never fit in degrees. Never treat a Web Mercator unit as a ground meter.

### Acceptance rules changed 2026-09-19 — read this before touching `fit.py`

`contained` used to be the **hard validity gate** (`fit.py`), evaluated with Shapely `covers` at
`numerical_tolerance_m = 1e-6`. `covers` is an exact topological predicate, and this transform
chain's own floating-point noise is ~1e-5 m² of spill — ten times that tolerance. Measured on a
perfectly convex 1,048 m² footprint over 12 randomised yaw/offset trials: **4 of 12 geometrically
perfect fits (IoU 99.99999 %) were reported `rejected`**, at random. Across the whole generality
suite only **1 of 24 runs** ever reached `accepted`.

Now:

- **Neighbour overlap filters selection** (a building cannot occupy another building).
- **Spill does not.** It decides whether the best placement is *good enough*, never *which*
  placement is reported — filtering on it made the engine return a worse, under-filled candidate
  instead of naming the honest best fit.
- `contained` is still computed and reported, and raises a warning; it gates nothing.
- `max_spill_fraction` defaults to **0.15**, tied to `min_iou` rather than taste: with a convex
  proxy achievable IoU is capped near `1 − spill`, so allowing 15 % spill states the same thing as
  requiring 0.85 IoU. **Revisit it if the proxy stops being convex. Never raise it to manufacture
  an `accepted`.**
- **Measured height, and why it is BOUNDED**: `measured_height_m` sets vertical scale to `Ht/Hm`
  independently of the plan scale (`internal/feasibility-plan.md` §5.4) and moves `PlacementManifest.height`
  to `source-record`. It never touches the plan fit — a test pins that. **But applying it
  unconditionally squashed Burruss by 2.34×** (94.4 × 20.7 × 63.7 m, L:H 4.56, against a mesh whose
  own L:H is 1.95). OSM's `height=20.7` is the main eaves; the mesh includes the tower — they
  measure different things. So `max_height_correction` (default **1.25**) bounds the departure from
  the uniform scale; beyond it, proportions are kept and the disagreement becomes a warning. Deck
  p.58 says *prefer* proportion-preserving uniform scaling and *allow limited* non-uniform — a
  2.34× squash is not "limited". Burruss currently reports `height: inferred` for this reason.

#### Measured negative results — do not redo these

- **A non-convex / apron-stripped proxy makes things worse, not better.** Restricting the proxy to
  a wall band (10–75 % of height) drops Burruss from **73.13 % → 58.72 %** and DDS from 64.32 % →
  30.02 %. The apron was *masking* a shape mismatch, not causing one: the generated walls cover
  less plan area than the real footprint. Both buildings' footprints have wings the mesh never
  reproduces. This is `internal/technical-reference.md` §5.6's topology mismatch.
- **DDS can never be accepted.** Its footprint is 70.3 % of its own convex hull, so a convex proxy
  caps IoU at 0.703 < `min_iou` 0.85. Rejecting it is correct behaviour.
- Deferred and *not* implemented, because each is worth little and none is visible on screen: FFT
  translation/scale search (+11.7 pts DDS, **+1.2 Burruss**), bounded anisotropy (+3–4 pts).

### Two fit engines exist, and they disagree

| | `web/src/lib/fit.ts` → `solveFit` | `server/app/geometry/fit.py` → `fit_glb` |
| --- | --- | --- |
| Input | live `THREE.Object3D` in the browser | GLB bytes on the server |
| Mesh proxy | OBB + hull of the bottom-20 %-height slice | convex hull of **all** projected vertices |
| Scale | uniform, plus constrained non-uniform up to 1.25× on the slack axis when aspect divergence > 8 % | uniform in plan; vertical scale independent when `measured_height_m` is supplied |
| Accept rule | best IoU always wins; confidence heuristic + ok/warn/error flags | best IoU among neighbour-free candidates wins; then `spill ≤ max_spill_fraction` (0.15) **and** `iou ≥ min_iou` (0.85) → `accepted` / `review` / `rejected`. Containment is reported, not enforced — see above |
| Metrics | IoU, collisions > 0.5 m² | IoU, coverage, spill fraction + area, containment, neighbor overlap |
| Output | `FitResult` with factored matrices | `PlacementManifest` — asset sha256, provenance, all four candidates, warnings |
| Composition | `M = T_target · R_y(θ) · S · T_ground · R_align · N` | `T(c) · yaw(β) · diag(s) · K`, where `K = yaw(−θ_src) · T(−c_src.x, −base, +c_src.y) · N` |

`internal/feasibility-plan.md` §8 requires that **all authoritative fit results come from one implementation**.
`server/app/geometry/fit.py` is authoritative, and as of the first MVP slice the code enforces it:
`FitStage.tsx` dispatches a server mesh to `ServerFitStage.tsx` → `requestFit`, and `PlacedScene.tsx`
applies the manifest's column-major matrix **once** to the raw asset (no second normalization).
`lib/placement.ts` is the shared scene representation and checks the asset hash and fit inputs before a
saved placement is restored. The browser solver is now reached only from `PreviewFitStage` — simulation
and manual imports — and must not certify or overwrite a Pipeline API placement.

**Neither engine currently satisfies deck p.58 on its own**, and that slide is the rubric. It asks for
bounded non-uniform scaling *and* a manual-review path. `fit.ts` has the bounded non-uniform scale
(1.25× cap past 8 % divergence) but always returns a result; `fit.py` has the review states and the
manifest but is uniform-only. The target is the Python engine's strictness, manifest and
accepted/review/rejected outcomes **plus** the TypeScript engine's bounded non-uniform scale ported over.
Getting this to one engine that covers all ten p.58 steps is the highest-value geometry work in the repo.

### Frontend

`web/src/store.ts` is a single zustand store; `unlocked()` / `completed()` derive stage gating from which
artifacts exist. There is no router — the stage id in the store selects the view in `App.tsx`. In simulation mode all
artifacts live in memory, so a reload loses them. In Pipeline API mode `lib/pipelineJob.ts` persists a
small session (`groundtruth.session.v1`: job id, key fingerprint, address, footprint, prompt, stage) and
re-attaches on load with GET only; photo, concept and mesh come back from the job's artifacts.

Stages (`web/src/stages/`):

1. **Ingest** — browser-side Nominatim geocode + Overpass, both with timeouts, falling back to the
   synthetic L-shaped `demoGeo()` parcel. **Overpass hardening, 2026-09-19:** the single
   `overpass-api.de` endpoint returns **406 on some networks** (reproduced here), which silently
   degraded every lookup to the demo parcel — `lib/geo.ts` now falls through three mirrors. And the
   old `way["building"]` query **missed every multipolygon building**, because `type=multipolygon`
   buildings carry the `building` tag on the *relation*: around the Drillfield that is **4 of 13
   buildings (31 %), including Burruss Hall itself**, plus Pamplin, Burchard and Johnston. A
   separate best-effort `relation["building"]` request now runs *after* the way query (resolving
   relation member geometry is slow and often 504s on public mirrors, so it may add buildings but
   can never delay or break the way path) and `largestOuterRing()` reduces a multipolygon to its
   dominant outer part. `osmHeight()` reads an explicit `height` tag only — `building:levels × 3.5`
   would be an estimate dressed as a record; registers a geohash bucket in
   `localStorage` (`lib/geo.ts`). Accepts **at most four** PNG/JPEG photos of the same building — the
   provider's real ceiling, enforced here so the rejection is not a surprise after the upload. Two
   backend-free entries live here: **Load completed real example** (`lib/cachedExample.ts`) and
   **Open saved ZIP** (`lib/savedBundle.ts`, which validates filenames and sizes, checks artifact
   SHA-256s and the manifest's model hash, requires a self-contained GLB, keeps the archive in
   IndexedDB for refresh, and re-exports it byte-for-byte without re-fitting).
2. **Redesign** — API mode: `startJob()` in `lib/pipelineJob.ts` creates one `kind=pipeline` job
   (Idempotency-Key derived from photo+prompt+strength, persisted before the POST) and `JobPanel`
   renders the server's real stage/status/progress. **Target polygons for 3D** (100–300,000, UI default
   60,000) is part of the request fingerprint, so changing it is a different logical job; it applies to
   the next API generation only, never to an already-loaded cached model. Simulation: `simulateRedesign()`,
   a deterministic canvas color-grade per preset (`lib/presets.ts`), bannered as not AI generation.
   `lib/creativePrompt.ts` shapes the prompt text.
3. **Reconstruct** — API mode: follows the same job and loads its GLB via `loadMeshUrl()`; there is no
   separate paid reconstruct click. Simulation: `simulateReconstruct()` → `buildProcedural()`. The simulated mesh is deliberately emitted **Z-up, centimeters, off-origin and
   rotated** so the fitting engine has real work to undo — keep that quirk. Also accepts a user
   `.glb`/`.obj`; `unitHeuristic()` guesses units from bounding-box size.
4. **Fit** — `FitStage.tsx` dispatches: a server mesh renders `ServerFitStage` (calls `requestFit`,
   shows the manifest's accepted/review/rejected state, IoU, coverage, spill, neighbor overlap, warnings
   and the chosen matrix, and downloads the server's ZIP after re-checking that the saved placement still
   matches what is on screen); everything else renders `PreviewFitStage`, which runs `solveFit`, animates
   the 7-step solver trace and exports `transform-{bucket}.json` plus a map-anchored GLB via `GLTFExporter`.
**Manual placement (deck p.58 step 10), added 2026-09-20.** `components/PlanEditor.tsx` is a
top-down review surface: drag to translate, shift-drag to rotate about the footprint centroid, with
IoU/coverage/spill recomputed live in the browser via the existing `clipPolygon` + `polygonArea`
helpers (the proxy is convex, so Sutherland–Hodgman against the concave footprint is exact). The
correction lives in `store.adjust` as `{dx, dz, dyaw}` and is **never merged into the manifest** —
`adjustedMatrix()` / `adjustedProxy()` compose it on top for display, walking and the viewer, while
the computed verdict, the metrics panel and the export keep describing the server's result. A
`manual-placement` banner says so on screen. `store.ts` drops the correction whenever the placement
it was expressed against is replaced or invalidated, since a delta against a different transform is
meaningless.

**Free import — complete 2026-09-20 (all four slices of `internal/plan.md`).** A fourth no-backend entry
on Ingest, **Import your own model** (`.glb`/`.obj`), skips the address entirely:
`loadMeshFile` → `deriveSite` → `SandboxFitStage` → Explore → export. `FitStage` tests
`geo.source === 'derived'` **before** the server-mesh test, so a derived site can never reach
either scoring engine. `components/DerivedScene.tsx` is its orbit view, because `PlacedScene`
reads a `PlacementManifest` and there is none. Explore shares its toolbar with this path rather
than dropping into a bare walk view. `store.declaredHeightM` and `store.derived` carry the
declared size and the provenance metadata; both are cleared whenever mesh or geo changes.

*Four dishonest readouts were found only by wiring it up and looking*, each now suppressed for
`source === 'derived'`: the rail printed **IoU 100.0 %** from the derived `FitResult`'s structural
`iou: 1`; the header printed **0.00000°, 0.00000°**; `MapView` **fetched OSM basemap tiles for
Null Island**; and Explore offered "Source photo and prompt" showing the untouched default preset.
The lesson generalises — a placeholder value in a shared struct becomes a claim the moment a
generic component renders it.

*Scale is the one place the original plan was wrong, and the fix matters.* The plan assumed an
imported file carries its real-world size. It usually does not: the Burruss GLB is normalised to
a unit box (raw bbox **1.898 × 0.973 × 1.281**, no node scale), which is what image-to-3D
generators emit, so free import measured a **1.9 m** building. The scored path never meets this
because it scales to the authoritative footprint; this path has nothing to scale to. So the size
is **asked for rather than invented**: an optional declared real height, applied **uniformly**
(deck p.58 prefers proportion-preserving scaling), labelled `user-declared` in the UI and the
export and **never** called measured, with `as-authored` the default and an explicit warning when
a file looks unit-normalised. `S` is composed **last** (`S · T_ground · N`) so scaling about the
origin cannot un-ground the base. Declaring 48.4 m for Burruss yields **94.4 × 63.7 m** in plan —
its real dimensions as recorded above, an independent confirmation that the scaling is correct.

Checks: `check-free-import.mjs` (below) and `check-derive-site.ts`. **Do not let any scoring
vocabulary — IoU, coverage, spill, accepted/review/rejected — or a latitude and longitude appear
on this path**; `check-free-import.mjs` asserts their absence at three points and is the guard.

**Slice 1 detail (the derivation itself).**
`lib/deriveSite.ts` derives a site from an imported object instead of an address: every triangle
is projected to plan, rasterised (edges stamped explicitly — walls project to slivers), interior
voids flooded solid, the occupied/empty boundary traced into loops, the largest kept and
simplified with Ramer-Douglas-Peucker at ~1 cell. It returns a `GeoResult` with `source:
'derived'` and a `FitResult` with `authority: 'derived-site'` whose matrix is
`S · T_ground · N` — **no rotation search, no lat/lon, no IoU and no verdict**, and `S` is
identity unless a real height was declared (see above), because the outline *is* the object's own
silhouette and scoring against it would be a tautology. This is
deliberately the opposite choice from the scored path, where a more faithful concave proxy
measured *worse*; that result is about matching a mesh to a footprint it does not share.
Supporting changes: `fit.ts` exports `signedArea` / `toRootMatrix` and widens `authority` to
`'preview-only' | 'derived-site'`; `geo.ts` widens `source` to `'osm' | 'demo' | 'derived'`;
`placement.ts` splits the manifest-bound nudge into `nudgeMatrix` / `nudgeRing` / `planMetrics` /
`ringCentroid` and exports a `PlanModel` + `manifestPlan()`; **`PlanEditor` now takes a
`PlanModel`, not a `PlacementManifest`**, and renders offset/yaw with **no IoU** when
`plan.target` is null. The v1 HTTP contract is untouched: no server call happens on this
path, so `schemas.py`, `api.ts` and `savedBundle.ts` were **not** widened, and the derived
footprint ships only in `transform-derived-site.json`, which is a handoff artifact and explicitly
not a `PlacementManifest`.

*Measured, and the reason the outline is trustworthy at all:* `deriveSite` was run against shapes
with known areas, which found a real bug. `fillVoids` seeded its exterior flood from grid cell 0,
and an edge stamped at exactly `box.min` rounds into that cell; with the seed occupied the flood
visited nothing, **every** empty cell read as an interior void, and the silhouette filled solid —
an L came out as its bounding box (1627 m² against a true 1200), silently, for every object.
Fixed with two cells of padding (`PAD_CELLS`) and seeding from every empty border cell. Verified
after the fix: L → 6 corners, 1217.8 m² (hull would be 1400); courtyard block → void filled,
1617.8 m²; a Z-up/centimetre/off-origin box → normalised to metres, base on `y = 0`, centred on
the origin, `scale.uniform === 1`. The ~1.5 % area overshoot is the half-cell dilation from edge
stamping — the outline sits ~one cell outside the true silhouette, which is the conservative
direction. **Do not reintroduce a single-seed flood.**

**Walk-mode fixes (2026-09-20).** `camPitch` only moved the camera's *height* while the camera did
`lookAt(player)`, so the top of a 20–50 m building was permanently off-screen; pitch now also lifts
the look target (`lookLift`) and the clamp widened from `[-0.2, 0.9]` to `[-0.75, 1.0]`. The
footprint polygon was also in the **collider** list, walling the player out of empty ground wherever
the building did not fill its own footprint — it is a drawn reference, not geometry, and only real
volume collides now. `spawnPoint` uses the same set.

5. **Explore** — R3F canvas; opens in **orbit**, offers exterior **walk-around** (capsule controller,
   WASD/Shift/Space/mouse-look, lerped chase camera, collision against the fitted hull, footprint and
   neighbour parcels) and a reset-camera action. A raw-model toggle inspects the asset without the
   placement transform. Walk mode is exterior only — it does not claim reconstructed interiors.

**Sandbox — multi-model staging, merged 2026-09-20.** A sixth `StageId`, reached from the
unnumbered **Sandbox** row at the foot of the sheet index (it is an aside, not sheet 6 —
`unlocked().sandbox` is always true, `completed().sandbox` always false, and the topbar prints
`Sandbox · local scene` instead of a sheet number). It renders as `.step.step-aside`, the same ruled
row as the five sheets with a `Boxes` glyph where they carry a number, banded off by `--rule-2`; see
`DESIGN.md` § Structure. It shipped as a filled vermilion `.btn primary` floated in the rail gutter,
which spent the reserved accent on a permanent control — do not put it back. `stages/SandboxStage.tsx` +
`lib/sandbox.ts` hold a **separate zustand store** (`useSandbox`) of `{asset, x, z, yaw, scale}`
models: import many `.glb`/`.obj` at once, arrange them with a TransformControls gizmo or the
numeric inspector, **Frame all**, then **Walk scene** — which reuses `ExploreStage`'s exported
`WalkStage` via the `sandbox?: WalkModel[]` prop, so one walk implementation serves both paths.
The scene survives navigation between sheets but not a refresh. It is **local and unscored**: no
address, no anchor, no IoU, no verdict — the same honesty rule as the derived-site path, and
size for unit-normalised imports is a **labelled estimate** (the fitted building's height, or 20 m),
never a measurement. `main.tsx` dropped `React.StrictMode` for it: R3F 8 schedules canvas teardown
500 ms after unmount, and StrictMode's effect replay killed a freshly mounted walkthrough's frame loop.

The header chip reads **"Local AI simulation"** when `VITE_API_BASE` is unset; otherwise it probes
`GET /v1/health` and reads `Pipeline API connected · meshy`, `· fixture (synthetic)`, `unreachable` or
`checking…`. Keep that honesty signal anywhere simulated output can reach a screen.

### Backend modules

- `config.py` — frozen `Settings` read from env; validates `provider ∈ {meshy, fixture}` at construction.
- `schemas.py` — versioned v1 pydantic contracts with `extra="forbid"`: `FitRequest`, `PlacementManifest`,
  `JobView`. Coordinate arrays here are **East/North**, not frontend x/z.
- `storage.py` — SQLite job blobs (`.data/jobs.sqlite3`, WAL) plus an atomic `reserve_submission()` cap;
  artifacts written to `.data/{job_id}/` by temp-file rename; `bundle()` zips artifacts with sha256s.
  Assumes exactly one application worker.
- `geometry/` — pure: no network, database, or FastAPI imports. Keep it that way. `mesh.py` hard-validates
  GLB (binary glTF 2, embedded buffers/textures, no animations or skins, ≤2 M vertices) before trimesh
  parses it.
- `providers/` — `base.GenerationProvider` Protocol (`submit`/`poll`/`download`/`close`); routes must never
  parse vendor JSON. `fixture.py` is an explicit synthetic box/PNG that never claims AI generation.
  `meshy.py` is the live adapter.

### Paid-generation invariants (encoded in the code on purpose)

- `SubmissionUnknown` — raised on network error, 5xx, or a missing task id — means the remote task **may**
  have been accepted. Never auto-retry; reconcile in the provider account first.
- Reserve the submission key in SQLite *before* calling the provider; `PIPELINE_MAX_SUBMISSIONS` is a hard cap.
- Polling and page reloads must never start a new paid generation — resume the stored `provider_task_id`.
- `MESHY_API_KEY` stays server-side. Never expose a provider key under a `VITE_` name.

### The frozen v1 contract (settled by P0, 2026-09-19)

The blob-vs-job mismatch is **resolved: the job API wins.** Meshy generation takes minutes, so the
synchronous blob shape the frontend originally assumed would time out. A POST returns a job id
promptly; the client polls.

```text
GET  /v1/health                          -> HealthView {provider, live, submissions_used}
POST /v1/jobs                            -> 202 JobView
     multipart: image (1-4 files, same building), prompt, strength (0..1),
                kind (pipeline|redesign|reconstruct), target_polycount (100..300000, optional)
     header:    Idempotency-Key -> storage request_key (UNIQUE; a repeat returns the same job)
GET  /v1/jobs                            -> list[JobView]
GET  /v1/jobs/{job_id}                   -> JobView            # the poll endpoint
GET  /v1/jobs/{job_id}/artifacts/{name}  -> bytes
     name: source | source_2..4 | concept | concept_2..4 | model   (view 1 keeps the bare name)
POST /v1/jobs/{job_id}/fit               -> PlacementManifest  # body: FitRequest
     FitRequest also carries max_spill_fraction (0..1, default 0.15) and
     measured_height_m (optional metres) -- both mirrored in web/src/lib/api.ts
GET  /v1/jobs/{job_id}/export            -> application/zip    # storage.bundle()
```

`server/app/main.py` holds the stubs; `web/src/lib/api.ts` holds the TypeScript mirrors plus
`createJob` / `getJob` / `pollJob` / `listJobs` / `artifactUrl` / `requestFit` / `exportUrl` / `health`.
Field names match `schemas.py` character for character — that equality is the contract, so re-check it
whenever either file changes.

Notes that are load-bearing rather than incidental:

- `artifactUrl(job, name)` takes the **`JobView`**, not a bare id: it resolves through the server's
  `artifacts` map and returns `null` when the artifact is not ready, so callers cannot fetch a 404.
- `createJob` requires an explicit `idempotencyKey` from the caller. A client that generated its own
  would turn a retried POST into a second paid generation.
- `pollJob` treats `submission-unknown` as **terminal**, alongside `succeeded`/`failed`. It is not a
  state to retry past; a human reconciles it in the provider account.
- `ArtifactName` is a `Literal` on both sides, so an unknown name is rejected with 422 before any
  handler runs — on top of `storage.artifact()`'s server-owned `files` allowlist.
- **Three places validate a `PlacementManifest`, not one.** `schemas.py` (pydantic),
  `web/src/lib/api.ts` (types) and **`web/src/lib/savedBundle.ts` (runtime checks on an imported
  ZIP)**. Widening a literal or adding a request field means editing all three plus
  `web/src/lib/placement.ts:fitRequest`; `placementMatches` compares the *whole* request
  canonically, so any field the browser fails to resend rejects an otherwise valid placement.
  Both `cachedExample.ts` and `savedBundle.ts` must rebuild `GeoResult` with every field that
  reaches `fitRequest` (this is how `measured_height_m` broke bundle import on 2026-09-19).
- `target_polycount` is carried end to end and **must stay that way**: frontend state → session →
  idempotency fingerprint → multipart field → persisted job settings → `JobView` → provider submission
  (including after a restart) → `generation.json` in the export. An omitted field falls back to the
  server default; an older job without the setting keeps reporting its historical fallback rather than
  having a number invented for it. Meshy treats the target as approximate, and a fixture mesh does not
  become real remeshing because a target was chosen.
- `api.ts` also exports `planFromScene` / `sceneFromPlan` / `planRing` / `sceneRing`. Every polygon in
  the API is **plan metres, (East, North)**; the scene is x/z. The flip is `(East, North) = (x, −z)`,
  the same one `fit.py` spells `* [1, -1]` and `fit.ts` spells `-z`.

Two shapes exist for the fit body on the TS side because `FitRequest` travels both ways: `FitRequest`
(all fields required — what the server echoes back inside `PlacementManifest.request`) and
`FitRequestInit` (pydantic-defaulted fields optional — what you send). Same for `Polygon2DInit`,
`LocalFrameInit`, `ProvenanceInit`.

### Orchestration (P1)

One asyncio task per job, in the web process — no worker, no queue. That is why `storage.py` assumes
exactly one application worker. `pipeline.py` owns the loop; `routes.py` only validates, delegates and
projects. Read `pipeline.py`'s module docstring before changing it: four of its rules exist to protect
real money, not for tidiness.

- Submission key is `{job_id}:{stage}`, reserved in SQLite **before** the provider call.
- A reserved key with **no recorded task id** means the process died in the window where the provider
  may already have accepted and billed. That job goes to `submission-unknown` and stops. It is never
  resubmitted, and a later restart does not resurrect it.
- Resume skips any stage that already has a task id, and any stage whose artifact already exists.
- Bounded backoff wraps `poll` and `download` only. A retried `submit` is a second charge.
- Downloaded artifacts are re-validated before storage (`image_media` / `validate_glb`) — a provider
  is not trusted to return what it promised.
- `stage` after generation is `fit` when a model exists, `complete` when it does not. Fitting is an
  explicit client call, not part of the loop, because a human supplies the footprint they confirmed.

`GET /v1/jobs/{id}` never starts work. Interrupted jobs resume at **startup**, from their stored task
id, not because someone polled them.

## Modular work split

`internal/work-split.md` is the authority — lanes P0–P6, each with its owned files, the contract it codes against,
what it develops against while other lanes are unfinished, and the check that proves it is done. Do not
re-derive a split here; edit that file.

Three rules from it that apply to every task in this repo:

- **P0–P3 are done** (2026-09-19). The contract is frozen in `server/app/schemas.py` ↔
  `web/src/lib/api.ts`, the backend works end to end on the fixture provider, the frontend drives real
  jobs through it, and the server fit is now the authoritative one for API assets. The lane text in
  `internal/work-split.md` still lists the `requestFit` wiring as open — that is stale; the code is in
  `ServerFitStage.tsx`.
- **One owner per file.** If you need a file your lane does not own, ask its owner rather than editing it.
  `schemas.py` and `web/src/lib/api.ts` are shared — they change in pairs, and only with an announcement.
- **Report what ran, not what was written.** A lane is done when its check was executed and observed.

Human-only lanes: P4 (confirm the building and footprint, spend credits, judge whether the generated model
resembles it) and P6 (obtain the sponsor contract). These are the real critical path, not code volume.

## What is actually left (from `internal/mvp-next-steps.md` + `internal/progress-report.md`)

Ordered. The plumbing is ahead of the demo; do not add more plumbing to avoid the top two items.

1. ~~**A convincing real transformation.**~~ **Done 2026-09-19.** The DDS concept was not a subtle
   restyle — it was *no visible change at all*, essentially the same building from a slightly
   different angle. The demo now opens on the Burruss medieval-fantasy four-view generation
   (vines up the towers, weathered stone, overgrown grounds, unmistakably Burruss Hall). Honest
   caveats to keep saying out loud: the mesh's **rear is hollow/ruined** (the prompt makes that read
   as intentional — that is luck, not design) and it carries a **flat paving apron** at its base.
2. **A fit that is actually useful — but the ceiling here is the generator, not the solver.**
   Burruss is rejected at **73.13 %** IoU (spill 17.1 % > 15 %), DDS at 52.62 %. Before touching the
   solver again, read the measured negative results under *Acceptance rules changed* above: a more
   faithful proxy scores **worse** on both buildings, because the generated mesh lacks wings the real
   footprint has. The remaining honest levers are a better-shaped generation or a manual-review path,
   not optimisation. **Never lower a threshold or deform the asset to manufacture an accepted result.**
3. **Measure the demo laptop.** Load time, orbit/walk responsiveness, memory at the real display size.
   A triangle count is not an FPS measurement; ~30 FPS at ~30–60k triangles is the engineering goal.
4. **Package the three minutes** — rehearsed script plus a backup recording of the verified path, with
   the creative and geographic limits stated out loud.
5. **Sponsor import only against a concrete contract.** The ZIP is a handoff artifact; there is still no
   verified Procedura/Scorched Nebraska import endpoint. Do not invent one.

`internal/pitch-plan.md` holds the minute-by-minute three-minute narrative (open on the finished explorable
result, then reveal photo → prompt → concept → mesh from **labelled cached** output, then orbit/walk,
then placement + measured fit, then export/restore). Its **first feature to cut** is the two-style
comparison; the completion gate is one whole real-building workflow, not breadth.

Explicitly deferred, with gates in `internal/mvp-next-steps.md`: COLMAP/OpenMVS/VGGT photogrammetry, Google map
rendering, broad address coverage, concave/courtyard fit optimization, architecture rewrites.

Also open in the tree: `ruff check app` is clean, but `ruff check tests` still reports 2 × E501 in
`test_job_options.py`. `web/README.md` / `samples/README.md` still describe the DDS-only example set and
have **not** been updated for the Burruss switch — do that when touching either area.

`.agents/`, `.codex/` and a root `AGENTS.md` are **now tracked** — the `update UI` commit committed
them along with `.claude/skills/impeccable`. They are harness mirrors, not repo tooling, and `AGENTS.md`
is a copy of `CLAUDE.md` that goes stale the moment this file changes. Nothing regenerates it, so either
re-copy it or delete it; do not treat it as a second source of truth.

**`web/scripts/check-sandbox.mjs` does not pass yet.** Its walk step reached `Collision · first.obj`
never appearing: holding `w` walks the player *away* from the models (spawn 13.5, 14.7 → 118.8, 132.2)
instead of into them. Reproduced identically on the pre-merge `sandbox mode` commit in a throwaway
worktree, so it is a bug in the sandbox walk spawn/heading, **not** merge damage. Everything before it
passes — multi-import, the 20 m estimate, independent transforms, a real gizmo drag, the 2-polygon
minimap, pointer lock. One real fix landed in the script itself: an **`async` `waitForFunction`
predicate returns a promise, the in-page poller only tests it for truthiness, and the wait therefore
resolves on the first tick regardless of what the predicate decides**. The R3F roots are now imported
once up front and the predicate is synchronous. `check-placement.mjs` has the same latent bug in three
places (lines 41, 65, 95) and has not been fixed.

**Where it fails depends on the browser, so read the line number before diagnosing.** Under
`chromium-headless-shell` it dies earlier, at line 75's `waitForFunction(() => !!document.pointerLockElement)`,
because that build refuses pointer lock outright (`The root document of this element is not valid for
pointer lock`). That is a harness limitation, not the sandbox bug above. Re-confirmed 2026-09-20 on a
clean `origin/main` worktree: identical failure, same line, so neither symptom is merge damage. To see
the real collision bug you need a browser that grants pointer lock.

## Conventions

- **Python**: ruff `E,F,I`, line length 100. Every public contract is a pydantic model with `extra="forbid"`.
  `geometry/` stays dependency-pure.
- **TypeScript**: `strict`, `noUnusedLocals`, `noUnusedParameters` — `tsc -b` must pass before a frontend
  task is called done.
- **Comments explain the why** — frame conventions, why a sign flips, why a retry is forbidden. Match the
  density already in `fit.ts` and `fit.py`; these files are the reference style.
- **Frontend colour comes from tokens**, defined once in `web/src/styles.css:root` and mirrored for the
  3D/plan views in `web/src/lib/sceneTheme.ts`. Do not write a hex into a component. Two traps are
  documented in `DESIGN.md` and both shipped as visible bugs before they were caught: a translucent tint
  on a cell inside a 1px-gap ruled grid composites over the **rule** colour, not the cell's; and a label
  colour checked against `--paper` can still fail AA on the darker `--rail`. Check the darkest ground the
  text actually lands on.
- **Vermilion means the authoritative GIS footprint.** It is the single accent, also used for the primary
  action and the current sheet, and nothing else. A legend must be *drawn* (a swatch), never a colour
  named in prose — "Orange: footprint · green: mesh hull" survived a palette change as a false statement
  on screen.
- **Keep the uncertainty labels honest.** `heading: "ambiguous"`, `height: "inferred"`,
  `ground_mode: "flat-assumed"`, `proxy: "projected-convex-hull"`, `world_registration: "not-integrated"`
  are typed literals in `PlacementManifest`. They are claims about what was and was not verified — widen
  the literal rather than quietly asserting more.
- **Never present simulated or fixture output as AI generation**, and never animate fake progress over a
  real job. A procedural extrusion is a labeled fallback, not a completed image-to-3D milestone.
- `main` is the default branch (`origin`: github.com/thangcaoinus/VTHax14) and holds everything: P3+P4
  via PR #1, P0+P1 via PR #2. Lanes ship as a branch + PR. `feature/p3-p4-geometry-fixture` was deleted
  on 2026-09-19 once merged — it had gone stale by 1290 lines and its only unmerged commit was an
  accidental `tsconfig.tsbuildinfo` artifact. **Branch from `main`, merge often, keep `main` green**;
  a branch left behind a merge is worse than no branch.
- **Repo cleanup, 2026-09-20.** A root `.gitignore` now exists. Planning and status documents moved
  to **`internal/`** and are untracked (`mvp-next-steps`, `progress-report`, `pitch-plan`, `work-split`,
  `feasibility-plan`, `technical-reference`, `implementation-plan`, `spec`, `plan`, and the sponsor PDF).
  They are still on disk; references in this file and in source comments were repointed at `internal/`.
  Also untracked, as harness mirrors rather than project code: `.agents/`, `.codex/`, `.impeccable/`,
  `AGENTS.md`, `.claude/skills/`, `.claude/agents/`. Tracked at root now: `README.md`, `CLAUDE.md`,
  `DESIGN.md`, `PRODUCT.md`, `dev.sh`, `devpost-story.md`, `.gitignore`. `README.md` and
  `samples/README.md` were rewritten for the seven-example set; `web/README.md`'s example section too.
  **The product is named HokieRoam**, not Groundtruth — the topbar, the page title and the export
  filenames all say so, and older documents that say Groundtruth are stale.

**Example picker, 2026-09-20.** `web/src/components/ExamplePicker.tsx` switches between the seven
cached examples, because `?example=<id>` typed by hand is not a demo. Two variants from one
component: a ruled `gallery` under the Ingest entry button, and a `strip` in the Explore toolbar that
swaps the loaded example **without leaving the scene** — that strip is the pitch's comparison beat.

Three rules it encodes:

- **Verdict and IoU are read from each example's own `example.json`** via `exampleSummaries()`
  (module-cached, same-origin, static — safe on the offline path). They are never declared in the
  source. Only the style *label* lives in `EXAMPLE_POSTERS`, because a label is not a measurement.
  This repo already shipped the bug where a duplicated title and photo filename went stale.
- **`EXAMPLE_IDS` is ordered by descending IoU on purpose** (73.1 · 70.6 · 70.4 · 69.9 · 59.6). The
  picker renders in that order so the column reads as the comparison it is.
- **The strip renders only when `s.example` is set.** Importing a model clears it
  (`IngestStage.tsx`), and `store.invalidate` clears it for any mesh without an `exampleId`. Verified
  by driving it: strip present on a cached example, absent after a free import, with no scoring
  vocabulary on screen. `check-free-import.mjs` is the standing guard, since the strip prints
  verdicts and IoU and that path may show neither.

## Deployment (added 2026-09-20)

Two services. The front end is static and the cached examples need no backend at all; the backend
exists only so a **new** generation can be run from the hosted page.

- `web/vercel.json` — framework/build/output pinned so the CLI asks nothing, plus immutable
  cache headers on `/examples/*` and `/fonts/*` (the GLBs are content-addressed by example id and
  never change in place). `web/.vercelignore` keeps `node_modules`, `dist`, `scripts` and **every
  `.env*`** out of the upload.
- `server/Procfile` and `server/railway.json` — start command, `/v1/health` healthcheck, and
  **`numReplicas: 1`, which is load-bearing, not a default**: `storage.py` documents that it assumes
  exactly one application worker, and the submission ledger's atomic reserve is what stops a second
  charge. Two replicas would break the guarantee that protects real money.

Four things that will bite whoever deploys this:

- **Vite inlines `VITE_API_BASE` at BUILD time.** Adding it to Vercel and restarting does nothing;
  the project must be **redeployed** for the frontend to know the API exists.
- **A Railway volume is required**, mounted where `PIPELINE_DATA_DIR` points. Without one the
  filesystem is ephemeral, so every redeploy wipes `jobs.sqlite3` — and that ledger is the entire
  cross-restart defence against paying twice for the same submission.
- **A public URL plus a live key means anyone who opens the link can spend the credits.** There is
  no auth anywhere in this app and a four-view job costs five submissions. `PIPELINE_MAX_SUBMISSIONS`
  is the only hard stop, enforced at reserve time before the provider is called — set it to a number
  you are willing to lose, not to 100. `PIPELINE_CORS_ORIGINS` restricts browsers to the Vercel
  origin but does nothing about curl.
- **The repo is ~1.7 GB** because `samples/` and `web/public/examples/` carry every real generation.
  Prefer CLI uploads (`vercel` from `web/`, `railway up` from `server/`) over GitHub-repo builds,
  which clone the whole thing. `server/.gitignore` already excludes `.venv` and `.data`, so a
  `railway up` from that directory sends only the source.

## Fixed on 2026-09-20 while staging the seven examples

Three real defects, all found by wiring the new examples up and looking rather than by a test:

- **The export shipped the wrong building.** `ServerFitStage.tsx` used the constant `EXAMPLE_PATH`
  (which is `burruss`) for a cached example's ZIP, so exporting Gilbert downloaded *Burruss Hall's*
  model and placement under a Gilbert filename. It now resolves `examplePath(id)` from
  `mesh.meta.exampleId`, narrowed through `EXAMPLE_IDS`. Latent until a second non-default example
  existed whose verdict differed.
- **`?example=` failed silently.** `resumeSession` only wrote a warning to the event log when
  `loadCompletedExample` threw, so a corrupted or mismatched example showed a judge nothing at all —
  on the exact path a judge uses. It now sets `jobError`, which renders as `role="alert"` on Ingest.
- **`check-example.mjs` never opened the example it was checking.** It read `CHECK_EXAMPLE`'s
  `example.json` but always clicked **Load completed real example**, which opens `DEFAULT_EXAMPLE`.
  Every non-default id was being compared against Burruss's screen; `dds` passed only because its
  verdict string happened to match. Non-default ids now navigate by `?example=<id>`, and so does the
  corrupt-hash half of the check.

Also: `web/vite.config.ts` gained `base: process.env.PUBLIC_BASE ?? '/'` so a GitHub Pages build
(`PUBLIC_BASE=/VTHax14/ npm run build`) resolves assets under a project subpath while dev, preview and
every script in `scripts/` keep `/`. `web/dist` is committed on a local `gh-pages` branch but **has not
been pushed** — the push needs a human.

## Final step of every task

Re-sync this file before moving on: what actually got wired, which contract was chosen, which fit engine is
authoritative, which modules are done and what was observed to prove it.
