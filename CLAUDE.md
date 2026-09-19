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

Document authority, in order:
- `implementation-plan.md` — **active scope**: 16-hour schedule, feature freeze, budget and cutoff rules.
- `work-split.md` — **who does what**: self-contained lanes P0–P6, file ownership, and the frozen HTTP
  contract. Read this before picking up a task; it is the collision guard.
- `feasibility-plan.md` — coordinate/geometry/export contracts and the service-boundary sketch (§4, §5, §6, §8).
- `technical-reference.md` — research and deferred scope. Consult for a specific question; not a build order.
- `spec.md` — the original pitch. What judges were promised, not what is being built.

## Repository state (verified 2026-09-19)

Be precise about this — the two halves have never talked to each other.

| Area | State |
| --- | --- |
| `web/` | Complete 5-stage UI. `npm run build` passes. Runs the **entire pipeline standalone in simulation mode** when `VITE_API_BASE` is unset. |
| `server/` | Library only, no HTTP surface. `config.py`, `schemas.py`, `storage.py`, `geometry/`, `providers/` import cleanly. **No `app/main.py`, no routes, no orchestration/polling loop, no `tests/`** — `pyproject.toml` points `testpaths` at a directory that does not exist. |
| Integration | Frontend and backend describe **incompatible contracts** (see below). Nothing is wired. |
| Assets | No `samples/`. No real generated GLB, no cached demo artifacts anywhere in the repo. |

## Commands

### web (run from `web/`)

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # tsc -b (typecheck) + vite build → dist/
npm run preview
```

No linter and no test runner are configured. `npm run build` is the only frontend gate — a clean `tsc -b`
is the check. Backend hook-up: put `VITE_API_BASE=http://localhost:8000` in `web/.env.local`; unset means
local simulation.

### server (run from `server/`)

```bash
.venv/bin/python -m pytest                              # testpaths=tests (dir does not exist yet)
.venv/bin/python -m pytest tests/test_fit.py::test_name # single test
.venv/bin/ruff check app                                # E,F,I · line-length 100
PYTHONPATH=. .venv/bin/python -c "from app.geometry.fit import fit_glb"   # import smoke check
```

`.venv/` exists (Python 3.14) with fastapi, uvicorn, httpx, numpy, shapely, trimesh, pyproj, pillow, pytest
and ruff installed. The package is **not** pip-installed — imports resolve from the working directory
(`pythonpath = ["."]` in the pytest config), so run everything from `server/`.

There is **no serve command yet**: `uvicorn app.main:app` fails because `app/main.py` does not exist.
Whoever writes it should keep that exact entrypoint so this line stops being a lie.

Env: copy `server/.env.example` → `server/.env`. `PIPELINE_PROVIDER=fixture` for offline work;
`meshy` + `MESHY_API_KEY` spends real credits.

## Architecture

### Coordinate contract — the thing not to get wrong

Scene frame is **X = East, Y = Up, Z = South**, meters, right-handed. Plan coordinates are
**(East, North) = (scene.x, −scene.z)**. Both fit engines perform that flip (`* [1, -1]` in Python,
`-z` in TS); if you touch either, preserve it. Derivation and the ECEF/ENU math: `feasibility-plan.md` §4.

- `server/app/geometry/frames.py` is the contract-correct path: pyproj WGS84 → ECEF → local ENU basis.
- `web/src/lib/geo.ts` uses a flat equirectangular approximation (`110_540` m/deg lat,
  `111_320·cos φ` m/deg lon) with the origin recentered on the matched building. Adequate for a
  campus-scale demo, but **not the same math** — do not assume the two agree to the meter.
- Never fit in degrees. Never treat a Web Mercator unit as a ground meter.

### Two fit engines exist, and they disagree

| | `web/src/lib/fit.ts` → `solveFit` | `server/app/geometry/fit.py` → `fit_glb` |
| --- | --- | --- |
| Input | live `THREE.Object3D` in the browser | GLB bytes on the server |
| Mesh proxy | OBB + hull of the bottom-20 %-height slice | convex hull of **all** projected vertices |
| Scale | uniform, plus constrained non-uniform up to 1.25× on the slack axis when aspect divergence > 8 % | uniform only |
| Accept rule | best IoU always wins; confidence heuristic + ok/warn/error flags | requires containment **and** zero neighbor overlap, then `iou ≥ min_iou` (0.85) → `accepted` / `review` / `rejected` |
| Metrics | IoU, collisions > 0.5 m² | IoU, coverage, spill fraction + area, containment, neighbor overlap |
| Output | `FitResult` with factored matrices | `PlacementManifest` — asset sha256, provenance, all four candidates, warnings |
| Composition | `M = T_target · R_y(θ) · S · T_ground · R_align · N` | `T(c) · yaw(β) · diag(s) · K`, where `K = yaw(−θ_src) · T(−c_src.x, −base, +c_src.y) · N` |

`feasibility-plan.md` §8 requires that **all authoritative fit results come from one implementation**.
Today only the frontend engine ships. Do not silently "improve" one of them: if you change acceptance
rules, matrix composition, or the proxy definition, declare which engine is authoritative and make the
other defer to it or delete it.

### Frontend

`web/src/store.ts` is a single zustand store; `unlocked()` / `completed()` derive stage gating from which
artifacts exist. There is no router — the stage id in the store selects the view in `App.tsx`. All
artifacts live in memory (object URLs for photos/concept, a live `THREE.Object3D` for the mesh), so
**a page reload loses everything**. Persistence is unbuilt work, not a bug to patch locally.

Stages (`web/src/stages/`):

1. **Ingest** — browser-side Nominatim geocode + Overpass `way["building"](around:140,…)`, both with
   timeouts, falling back to the synthetic L-shaped `demoGeo()` parcel; registers a geohash bucket in
   `localStorage` (`lib/geo.ts`).
2. **Redesign** — `lib/redesign.ts`: `POST {API}/redesign` when configured, else a deterministic canvas
   color-grade per preset (`lib/presets.ts`).
3. **Reconstruct** — `lib/reconstruct.ts`: `POST {API}/reconstruct` when configured, else
   `buildProcedural()`. The simulated mesh is deliberately emitted **Z-up, centimeters, off-origin and
   rotated** so the fitting engine has real work to undo — keep that quirk. Also accepts a user
   `.glb`/`.obj`; `unitHeuristic()` guesses units from bounding-box size.
4. **Fit** — runs `solveFit`, animates a 7-step solver trace into the event log, exports
   `transform-{bucket}.json` and a map-anchored GLB via `GLTFExporter`.
5. **Explore** — R3F canvas, capsule controller (WASD/Shift/Space/mouse-look), lerped chase camera,
   collision against the fitted hull, footprint and neighbor parcels.

The header chip reads **"Local AI simulation"** vs **"Pipeline API connected"** off `VITE_API_BASE`.
Keep that honesty signal anywhere simulated output can reach a screen.

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

### Blocking mismatch: frontend expects blobs, backend models jobs

`web/README.md`, `lib/redesign.ts` and `lib/reconstruct.ts` expect **synchronous multipart endpoints
returning a blob**: `POST /redesign` (`image`, `prompt`, `strength`) → image, `POST /reconstruct`
(`image`) → GLB. `server/app/schemas.py` models an **async job API** (`JobView`, `job_id`,
`provider_task_id`, `progress`, polling), and `feasibility-plan.md` §8 sketches `/jobs`, `/jobs/:id`,
`/jobs/:id/fit`, `/jobs/:id/export`.

Meshy generation takes minutes, so a blocking request will time out. Choose the job API and change the
frontend, or keep the blob shape and accept the limitation. **Settle this before either side writes more
code** — it is the one interface both halves must agree on.

## Modular work split

`work-split.md` is the authority — lanes P0–P6, each with its owned files, the contract it codes against,
what it develops against while other lanes are unfinished, and the check that proves it is done. Do not
re-derive a split here; edit that file.

Three rules from it that apply to every task in this repo:

- **P0 first.** The HTTP contract (job API, not blobs) is frozen as stubs in `server/app/main.py` and
  `web/src/lib/api.ts` before any handler or fetch call is written. Both sides use the field names in
  `schemas.py` verbatim.
- **One owner per file.** If you need a file your lane does not own, ask its owner rather than editing it.
  `schemas.py` and `web/src/lib/api.ts` are shared — they change in pairs, and only with an announcement.
- **Report what ran, not what was written.** A lane is done when its check was executed and observed.

Human-only lanes: P4 (confirm the building and footprint, spend credits, judge whether the generated model
resembles it) and P6 (obtain the sponsor contract). These are the real critical path, not code volume.

## Conventions

- **Python**: ruff `E,F,I`, line length 100. Every public contract is a pydantic model with `extra="forbid"`.
  `geometry/` stays dependency-pure.
- **TypeScript**: `strict`, `noUnusedLocals`, `noUnusedParameters` — `tsc -b` must pass before a frontend
  task is called done.
- **Comments explain the why** — frame conventions, why a sign flips, why a retry is forbidden. Match the
  density already in `fit.ts` and `fit.py`; these files are the reference style.
- **Keep the uncertainty labels honest.** `heading: "ambiguous"`, `height: "inferred"`,
  `ground_mode: "flat-assumed"`, `proxy: "projected-convex-hull"`, `world_registration: "not-integrated"`
  are typed literals in `PlacementManifest`. They are claims about what was and was not verified — widen
  the literal rather than quietly asserting more.
- **Never present simulated or fixture output as AI generation**, and never animate fake progress over a
  real job. A procedural extrusion is a labeled fallback, not a completed image-to-3D milestone.
- Working branch is `thangcao`; `main` is the default (`origin`: github.com/thangcaoinus/VTHax14). There is
  no root `.gitignore` — `web/.gitignore` and `server/.gitignore` cover `node_modules`, `dist`, `.env.local`,
  `.venv`, `.data` and caches.

## Final step of every task

Re-sync this file before moving on: what actually got wired, which contract was chosen, which fit engine is
authoritative, which modules are done and what was observed to prove it.
