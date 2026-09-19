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
due 8:00 AM Sunday, September 20** — project description plus demo links judges can open. `spec.md` says
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

## Repository state (verified 2026-09-19)

Be precise about this — the two halves have never talked to each other.

| Area | State |
| --- | --- |
| `web/` | Complete 5-stage UI. `npm run build` passes. Runs the **entire pipeline standalone in simulation mode** when `VITE_API_BASE` is unset. |
| `server/` | **Working pipeline service** (P0 + P1, 2026-09-19). `app/main.py` (assembly + lifespan), `routes.py` (all 7 `/v1` handlers, implemented), `pipeline.py` (orchestration). Drives a fixture job end to end: photo → concept → GLB → fit → export bundle. `ruff check app` clean, and `tests/test_fit.py` (P3) covers the four required geometry/export regressions. |
| Integration | **Backend done, frontend not yet wired.** Both sides name the same fields (`server/app/schemas.py` ↔ `web/src/lib/api.ts`, verified field-for-field) and the server answers for real, but no stage calls the client yet — `redesign.ts`/`reconstruct.ts` still hold their dead blob `fetch` calls. That is P2. |
| Assets | `samples/` exists (P4): DDS building photo, OSM way 1174211880 footprint, and a **fixture-generated** concept/model/manifest — labelled synthetic, not Meshy output. Still **no real generated GLB**; no paid generation has run. |

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

`PIPELINE_FIXTURE_DELAY_SECONDS=10` makes the fixture provider report realistic
queued → running → progress → succeeded transitions instead of completing instantly. The submit time
is encoded in the task id, so simulated progress survives a restart the way a real provider's does —
which is what makes the resume path testable without spending credits.

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
`server/app/geometry/fit.py` is authoritative: it emits the versioned `PlacementManifest`, validates the
actual polygon and neighbor overlap, and uses uniform scale. The browser solver remains a clearly labelled
offline/simulation preview only; it must not certify or overwrite a Pipeline API placement.

**Neither engine currently satisfies deck p.58 on its own**, and that slide is the rubric. It asks for
bounded non-uniform scaling *and* a manual-review path. `fit.ts` has the bounded non-uniform scale
(1.25× cap past 8 % divergence) but always returns a result; `fit.py` has the review states and the
manifest but is uniform-only. The target is the Python engine's strictness, manifest and
accepted/review/rejected outcomes **plus** the TypeScript engine's bounded non-uniform scale ported over.
Getting this to one engine that covers all ten p.58 steps is the highest-value geometry work in the repo.

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

### The frozen v1 contract (settled by P0, 2026-09-19)

The blob-vs-job mismatch is **resolved: the job API wins.** Meshy generation takes minutes, so the
synchronous blob shape the frontend originally assumed would time out. A POST returns a job id
promptly; the client polls.

```text
GET  /v1/health                          -> HealthView {provider, live, submissions_used}
POST /v1/jobs                            -> 202 JobView
     multipart: image, prompt, strength (0..1), kind (pipeline|redesign|reconstruct)
     header:    Idempotency-Key -> storage request_key (UNIQUE; a repeat returns the same job)
GET  /v1/jobs                            -> list[JobView]
GET  /v1/jobs/{job_id}                   -> JobView            # the poll endpoint
GET  /v1/jobs/{job_id}/artifacts/{name}  -> bytes              # name: source | concept | model
POST /v1/jobs/{job_id}/fit               -> PlacementManifest  # body: FitRequest
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

`work-split.md` is the authority — lanes P0–P6, each with its owned files, the contract it codes against,
what it develops against while other lanes are unfinished, and the check that proves it is done. Do not
re-derive a split here; edit that file.

Three rules from it that apply to every task in this repo:

- **P0 and P1 are done** (2026-09-19). The contract is frozen in `server/app/schemas.py` ↔
  `web/src/lib/api.ts`, and the backend behind it works end to end on the fixture provider. **P2 is
  the next blocking lane**: the frontend still simulates everything.
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
- `main` is the default branch (`origin`: github.com/thangcaoinus/VTHax14). `thangcao` carries the P0+P1
  backend work. Lanes have also shipped via `feature/<lanes>-<topic>` + PR — that is how P3+P4 landed
  (PR #1, `feature/p3-p4-geometry-fixture`). Either is fine; merge often and keep `main` green.
- There is no root `.gitignore` — `web/.gitignore` and `server/.gitignore` cover `node_modules`, `dist`,
  `.env.local`, `.venv`, `.data`, `tsconfig.tsbuildinfo` and caches.

## Final step of every task

Re-sync this file before moving on: what actually got wired, which contract was chosen, which fit engine is
authoritative, which modules are done and what was observed to prove it.
