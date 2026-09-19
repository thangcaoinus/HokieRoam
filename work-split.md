# Work split: self-contained lanes

Companion to [implementation-plan.md](implementation-plan.md), which owns the schedule, budget and cutoff
rules. That document divides work by **who acts** (AI / human / external service). This one divides it by
**what you can pick up and finish without waiting for anyone**.

Every lane below states the files it owns, the contract it codes against, what it develops against while
other lanes are unfinished, and the check that proves it is done. Team size is unconfirmed, so lanes are
defined to be independently pickable and collapsible.

| People | Suggested assignment |
| --- | --- |
| 2 | A: P1 + P2 (the wire). B: P3 + P4 (geometry + the real asset). P5 last, together. |
| 3 | A: P1. B: P2 + P5. C: P3 + P4. |
| 4 | A: P1. B: P2. C: P3. D: P4 + P5. |
| 1 | P0 → P1 → P2 → P3, and run P4 (generation) concurrently in the background the whole time. |

Whoever starts first does **P0**. It takes about 30 minutes and unblocks everyone else.

---

## P0 — Freeze the contract (do this first, once)

Today `web/README.md` promises synchronous blob endpoints (`POST /redesign` → image,
`POST /reconstruct` → GLB) while `server/app/schemas.py` models an async job API. Meshy generation takes
minutes, so the blob shape times out. **The job API wins** — it is what `schemas.py` and `storage.py`
already support.

Commit these two stubs before anyone writes a handler or a fetch call. Both must compile; neither needs
to work.

**`server/app/main.py`** — every route present, correct response model, body `raise HTTPException(501)`:

```text
GET  /v1/health                          -> {provider, live, submissions_used}
POST /v1/jobs                            -> 202 JobView
     multipart: image (png/jpeg), prompt, strength (0..1), kind (pipeline|redesign|reconstruct)
     header:    Idempotency-Key -> storage request_key (UNIQUE; a repeat returns the same job)
GET  /v1/jobs                            -> list[JobView]
GET  /v1/jobs/{job_id}                   -> JobView            # the poll endpoint
GET  /v1/jobs/{job_id}/artifacts/{name}  -> bytes              # name in {source, concept, model}
POST /v1/jobs/{job_id}/fit               -> PlacementManifest  # body: FitRequest
GET  /v1/jobs/{job_id}/export            -> application/zip    # storage.bundle()
```

`JobView`, `FitRequest` and `PlacementManifest` already exist in `schemas.py` — do not redesign them.
`JobView.artifacts` is `{name: url_path}`; the internal SQLite record keeps `files` as
`{name: filename}` and `storage.artifact()` resolves it through that server-owned allowlist. Keep it that
way — `name` must never reach the filesystem directly.

**`web/src/lib/api.ts`** — TypeScript mirrors of `JobView` / `FitRequest` / `PlacementManifest`, plus
`createJob`, `getJob`, `pollJob`, `artifactUrl`, `requestFit`, `exportUrl`. Field names must match
`schemas.py` exactly, character for character.

Done when: `.venv/bin/python -m ruff check app` and `npm run build` both pass, and the two files use the
same names. After this, P1 fills the handlers from below and P2 consumes them from above, in parallel.

### P0 status: **done, 2026-09-19** — observed, not just written

Ran and passed: `ruff check app` (exit 0) · `npx tsc -b --force` (exit 0) · `npm run build` · uvicorn
boots and `GET /v1/health` returns `{provider, live, submissions_used}` while every other route returns
501 · an unknown artifact name is rejected 422 before any handler · CORS preflight from
`localhost:5173` passes `Idempotency-Key` · a script diffed all 13 mirrored models field-for-field
between `schemas.py` and `api.ts` with zero mismatches.

**Cross-lane edits P0 made, announced here** (each is formatting or contract, no behaviour change):

- `schemas.py` (shared): added `HealthView` and the `ArtifactName` literal. Nothing else touched.
- `storage.py` (P1): added `JobStore.submissions_used()` — `/v1/health` needs the count, and SQL does
  not belong in a route.
- `web/README.md` (P5): rewrote only the "Backend hook-up" section, which documented the dead blob
  contract. The rest of that README is untouched.
- **The repo-wide ruff gate was red before P0** — 15 pre-existing errors in `config.py`, `storage.py`,
  `providers/fixture.py`, `providers/meshy.py`, `geometry/frames.py` and `geometry/fit.py` (import
  order, one unused `LocalFrame` import, 11 over-length lines). P0 fixed all 15 so the gate every
  later lane is measured against is actually green. Import-sorting and line wrapping only; one dead
  import removed. No logic changed, and all modules still import.

Still open, by design: no handler body beyond `/v1/health` (P1), no stage calls the client yet and
`redesign.ts` / `reconstruct.ts` still hold their dead blob `fetch` calls (P2).

---

## P1 — Backend pipeline service

**Owns:** `server/app/main.py`, `routes.py`, `pipeline.py`, `providers/*`, `config.py`
**Never touches:** `geometry/` (P3), anything under `web/`

Fill in the P0 stubs. Orchestration is one async polling loop in the same process — no worker, no Redis.
Flow per job: store the source image → submit redesign → poll → download concept → submit reconstruct →
poll → download GLB → mark `succeeded`.

**Develop against:** `PIPELINE_PROVIDER=fixture`. Needs no credits, no frontend, no real building.

```bash
cd server && cp .env.example .env     # set PIPELINE_PROVIDER=fixture
PIPELINE_PROVIDER=fixture .venv/bin/uvicorn app.main:app --reload --port 8000
curl -F image=@any.png -F prompt=test -F strength=0.8 -F kind=pipeline localhost:8000/v1/jobs
```

**Invariants that are already encoded in the code — preserve them:**

- Reserve the submission key via `storage.reserve_submission()` **before** the provider call.
  `PIPELINE_MAX_SUBMISSIONS` is a hard cap.
- `SubmissionUnknown` (network error, 5xx, missing task id) means the remote task may have been accepted.
  Set status `submission-unknown` and stop. **Never auto-retry.**
- Polling and reloads resume the stored `provider_task_id`. They must never start a new paid generation.
- Routes never parse vendor JSON — that lives behind the `GenerationProvider` Protocol.
- `MESHY_API_KEY` stays server-side. Never behind a `VITE_` name.

**Done when:** with the fixture provider, `POST /v1/jobs` → repeated `GET /v1/jobs/{id}` reaches
`succeeded` with a downloadable `model` artifact; killing and restarting uvicorn mid-job resumes the same
task id and the `submissions` table gains no new row; the same `Idempotency-Key` twice returns one job.

### P1 status: **done, 2026-09-19** — observed, not just written

Files: `app/main.py` (assembly + lifespan), `app/routes.py` (7 handlers), `app/pipeline.py`
(orchestration), `app/providers/__init__.py` (factory). All three done-checks ran against a real
uvicorn process:

- **End to end:** `POST /v1/jobs` → 202 → polled to `succeeded`, `stage=fit`, artifacts
  `source`/`concept`/`model`; the GLB downloads as `model/gltf-binary` and validates through
  `geometry/mesh.py`. `POST .../fit` → `accepted`, IoU 1.000, scale 10.0; `GET .../export` → a zip
  containing `source.png`, `concept.png`, `model.glb`, `generation.json`, `placement.json`, with no
  key material in it.
- **Restart mid-job:** with `PIPELINE_FIXTURE_DELAY_SECONDS=10`, `kill -9` at 24 % progress, restart →
  log line `stage redesign resuming task fixture-redesign-…`, the **same** task id, progress picked up
  at 63 %, ran to `succeeded`. The `submissions` table gained no redesign row.
- **Idempotency:** the same key twice returned one `job_id`; a different key returned a different one.

Failure paths verified too, because these are the ones that cost money:

- **`submission-unknown`:** a reserved key with the task id wiped (the real crash window) resolves to
  `submission-unknown` on restart, resubmits nothing, and a *later* restart does not resurrect it.
- **Cap:** `PIPELINE_MAX_SUBMISSIONS=1` on a 2-stage job fails the job at the second stage with
  "Configured provider-submission cap reached" rather than spending.
- **Validation:** non-image 415 · missing `Idempotency-Key` 422 · `strength=5` 422 · unknown job 404 ·
  unknown artifact name 422 · fit before a model exists 409 · degenerate footprint 422.
- **Honesty:** fixture jobs carry a warning naming the output as a synthetic placeholder;
  `identity_confirmed=False` downgrades a perfect IoU-1.0 fit to `review`; `world_registration` stays
  `not-integrated`.

**Cross-lane edits, announced:** `storage.py` gained `has_submission()`, and `bundle()` now writes
`placement.json` into the export zip — the manifest is the actual handoff artifact and was missing
from it. `config.py` gained `fixture_delay` (`PIPELINE_FIXTURE_DELAY_SECONDS`, default 0).

**Bug fixed on the way in:** `providers/fixture.py` set `mesh.visual.face_colors`, whose face→vertex
conversion pulls in scipy — not a dependency — so the fixture provider could not export a GLB at all
and this lane's whole develop-against path was dead. Switched to `vertex_colors`: same brown box,
1156-byte GLB, no new dependency.

Not P1's, still open: `server/tests/` does not exist (P3), and no frontend stage calls the API (P2).

---

## P2 — Frontend wiring and job UI

**Owns:** `web/src/lib/api.ts`, `redesign.ts`, `reconstruct.ts`, `stages/RedesignStage.tsx`,
`stages/ReconstructStage.tsx`, `store.ts`
**Never touches:** `lib/fit.ts` or `FitStage.tsx` (P3), `ExploreStage.tsx` or `components/` (P5)

Replace the two fire-and-forget `fetch` calls with create-then-poll against the P0 contract. Keep the
simulation path intact for when `VITE_API_BASE` is unset — it is the offline demo and the fallback.

**Develop against:** the existing simulation path, then P1's fixture server the moment it answers. You do
not need a real GLB or a real building to finish this lane.

Requirements beyond plumbing:

- Persist `job_id` (localStorage is enough) and re-attach on load. Today a refresh loses everything.
- Show the job's **real** stage, status and `progress`. Do not animate fake progress over a live job —
  the existing timed `REDESIGN_STEPS` / `RECON_STEPS` walk is for simulation mode only.
- Keep the header chip honest: "Local AI simulation" vs "Pipeline API connected" off `VITE_API_BASE`.
- Surface `status: "submission-unknown"` as its own visible state with no retry button.

**Done when:** with `VITE_API_BASE` set and P1's fixture server running, the UI drives a real job to
Reconstruct on server bytes, a mid-job browser refresh re-attaches to the same job, and unsetting
`VITE_API_BASE` still walks the whole pipeline offline.

### P2 status: **done, 2026-09-19** — observed, not just written

Driven in headless Chrome against a real uvicorn (`PIPELINE_PROVIDER=fixture`,
`PIPELINE_FIXTURE_DELAY_SECONDS=8`), with `VITE_API_BASE=http://localhost:8000`:

- **Real job to Reconstruct on server bytes:** Redesign → one `kind=pipeline` job → real
  `stage`/`status`/`progress` rendered → concept shown from `/artifacts/concept` → GLB loaded from
  `/artifacts/model` (asset report reads `pipeline job <id> · fixture`). Server ends `succeeded`/`fit`.
- **Mid-job refresh:** reloaded at `running redesign 37 %` → the UI re-attached to the **same** job id,
  one re-attach line, no new POST, and followed it to the mesh.
- **Offline:** with `VITE_API_BASE` unset and Nominatim/Overpass blocked, the simulation walks
  Ingest → Explore; no job panel appears.
- **Money guards:** a lost response (job id dropped from localStorage, Generate clicked again) returned
  the existing job — server job count unchanged. An explicit Regenerate created exactly one new job.
  `submission-unknown` (set on the stored job) renders its own panel and **no** generate button.

How it is wired:

- `lib/pipelineJob.ts` (new) owns the job: one `pipeline` job per generation, so concept and mesh
  share one provenance record and one export zip. Redesign starts it; Reconstruct re-attaches to it —
  there is no second paid "reconstruct" click in API mode.
- `Idempotency-Key` = `gt-<sha256(photo bytes, prompt, strength)[:32]>-a<attempt>`, persisted
  **before** the POST. Same inputs → same key → same job. Only Regenerate on a *finished* job with
  identical inputs bumps `attempt`.
- localStorage `groundtruth.session.v1` keeps job id, key fingerprint, address, footprint, preset,
  prompt, strength and stage. Reload re-attaches with GET only. The source photo, concept and mesh come
  back from the job's artifacts. **New** in the header clears the session (the server keeps the job).
- `stages/JobPanel.tsx` (new) shows only server-reported state; unknown progress is an indeterminate
  bar, never a guessed number. Lost contact shows a **Re-attach** button — a GET, never a new job.
- The timed `REDESIGN_STEPS` / `RECON_STEPS` walk now runs in simulation mode only, and simulated or
  fixture output carries an on-screen "not AI generation" banner.
- `redesign.ts` / `reconstruct.ts`: dead blob `fetch` calls removed; `simulateRedesign` /
  `simulateReconstruct` are the offline path; `loadMeshUrl` loads a job's GLB. `MeshAsset.meta` gained
  `jobId`, `provider`, `simulated`.
- `store.ts` gained `job`, `jobError`, `api` (health) and `SESSION_KEY`.

**Cross-lane edits, announced:** `App.tsx` (unowned) — only the header chip and one mount effect. The
chip now claims "connected" only after `GET /v1/health` answers, and names a fixture server as
synthetic: `Pipeline API connected · fixture (synthetic)` / `· meshy` / `unreachable` / `checking…`.

**For other lanes:**

- **P3:** `useStore().job` is the live `JobView`; `s.mesh.meta.jobId` marks a server mesh. `FitStage`
  still runs the browser `solveFit` on it — per the P3 authority decision it should call
  `requestFit(job.job_id, …)` for API jobs instead. Not touched here (P3's file).
- **P5:** `components/Compare.tsx` hard-codes the tag "AI concept", which is wrong for simulated and
  fixture output. The stages now add a banner above it, but the tag itself should take a prop.

---

## P3 — Geometry authority and tests

**Owns:** `server/app/geometry/*`, `server/tests/`, `web/src/lib/fit.ts`, `web/src/stages/FitStage.tsx`
**Never touches:** routes, providers, the API client

Pure functions. No network, no database, no UI. **This lane can start right now and never blocks.**

Two fitting engines currently exist and disagree — `web/src/lib/fit.ts` (bottom-20 % slice proxy,
constrained non-uniform scale up to 1.25×, best-IoU-always-wins) and `server/app/geometry/fit.py`
(full convex hull proxy, uniform scale only, containment + neighbor check + `iou ≥ 0.85` →
accepted/review/rejected). `feasibility-plan.md` §8 requires exactly one authority. **Decide, write the
decision down, and make the other engine defer or go away.**

Recommendation, and it is driven by the rubric: deck p.58 asks for *both* "allow limited non-uniform
scaling when necessary" *and* "send uncertain results for manual review", so **neither engine passes on its
own today**. Make `fit.py` authoritative — it has the review states, the containment check and the
manifest — then port the bounded non-uniform scale from `fit.ts` into it (1.25× cap on the slack axis once
aspect divergence exceeds 8 %). The browser keeps a preview-only path. An engine that covers all ten p.58
steps is the single highest-value piece of geometry work available.

Build `server/tests/` — the directory `pyproject.toml` already points at but which does not exist. Four
checks, from `implementation-plan.md` §7; build the fixtures with `trimesh.creation.box` and Shapely:

1. A known transformed box, **including nested node transforms**, grounds and scales correctly.
2. Aspect mismatch produces visible underfill, never hidden stretching.
3. A concave or holed target is not accepted from its bounding box alone.
4. Export/reload reproduces the placement without applying the matrix twice.

Keep the frame contract: scene is X=East, Y=Up, Z=South; plan is `(East, North) = (x, −z)`.

**Done when:** `.venv/bin/python -m pytest` is green on all four, and one short paragraph in this file
records which engine is authoritative and what the other one is now allowed to do.

**Authority decision (P3):** `server/app/geometry/fit.py` is the sole authority for a real placement. It
produces the versioned `PlacementManifest`, validates actual footprint containment and neighbors, and uses
uniform scale only. `web/src/lib/fit.ts` remains an explicitly labelled offline/simulation preview; it must
not be used to certify, export, or overwrite a placement for a Pipeline API job.

---

## P4 — Real building, real asset, cached sample

**Owns:** `samples/`, `server/.env`
**Mostly human.** No code lane can do this: confirming that a footprint really is that building, and
judging whether a generated model resembles it, both need a person looking at it.

Start this **first and in the background** — external latency is the one cost faster coding cannot remove.

1. Pick one simple building. Photograph or source 1–3 clean, cropped exterior photos.
2. Confirm the footprint (OSM way id) is actually that building, then set `identity_confirmed`. The
   manifest downgrades `accepted` → `review` when this is false, by design.
3. Load credits, set `MESHY_API_KEY`, run one real generation, inspect the concept and the mesh.
4. Cache every successful artifact under `samples/`: photo, concept, GLB, footprint, manifest.

Budget rails from `implementation-plan.md` §6: roughly $20–35 planned, $50 proposed ceiling, ~300-credit
cap, four main attempts plus one backup and one rehearsal. Inspect the provider balance directly; do not
build accounting.

**Done when:** `samples/` loads end to end **with wifi off**, and the UI labels it as a cached sample
rather than a fresh generation.

### P4 status: **NOT done** (checked 2026-09-19) — `samples/` exists but proves the wrong thing

`samples/` is real for the footprint half and synthetic for the generation half. `sample-input.json`
says `provider: "fixture", synthetic: true` and `samples/README.md` says so in words. It proves the
**offline** path works. It proves nothing about the AI path.

**P4 is not a wiring lane — the wiring has been finished since the first commit.** `meshy.py`
(submit/poll/download) landed in `04d7338`, `build_provider()` selects it whenever
`PIPELINE_PROVIDER != fixture`, and P1's pipeline drives it exactly as it drives the fixture. No code
is missing. What is missing is **credits and a human**:

1. An API key with credits on it.
2. `PIPELINE_PROVIDER=meshy` + `MESHY_API_KEY=…` actually reaching the process (see the trap below).
3. One real generation, then a person judging whether the mesh resembles the building.
4. Re-cache `samples/` from that job and flip `synthetic` to false.

**The trap, and it is a nasty one.** Creating `server/.env` does nothing by itself — nothing in `app/`
loads it. And the obvious fix does not work either: `uvicorn --env-file .env` **crashes** with
`ModuleNotFoundError: No module named 'dotenv'`, because `python-dotenv` is not a dependency of this
project. Both behaviours verified 2026-09-19. Export the variables instead:

```bash
PIPELINE_PROVIDER=meshy MESHY_API_KEY=msy_... .venv/bin/uvicorn app.main:app --port 8000
# or:  set -a; . .env; set +a;  .venv/bin/uvicorn app.main:app --port 8000
curl localhost:8000/v1/health
```

**`live: true` is the only honest confirmation.** Do not read `provider` — it says `meshy` by default
even with no key at all. A run showing `provider: meshy, live: false` is configured for nothing and any
"generation" it produces is a synthetic placeholder.

**What has been de-risked without spending anything:** `server/tests/test_meshy.py` drives the adapter
against a mocked transport — status mapping, artifact extraction per stage, progress clamping, task-id
URL encoding, the https/credential/size guards, and above all that an ambiguous failure (5xx, dropped
connection, missing task id) raises `SubmissionUnknown` rather than something retryable. Five deliberate
mutations of `meshy.py` were each caught. This cannot prove the live API matches its documentation —
only credits do that — but the adapter's own logic is no longer unexercised.

---

## P5 — Explore, presentation, submission

**Owns:** `web/src/stages/ExploreStage.tsx`, `web/src/components/*`, `web/src/styles.css`, `README.md`,
submission text and recordings
**Never touches:** `lib/`, `server/`

Independent of the backend entirely — works on the simulation path. Per `implementation-plan.md`, exterior
WASD navigation is a **one-hour stretch** that only starts once the local pipeline passes at hour 8. Orbit
inspection is the default interaction.

The non-optional half of this lane is submission: working links, a short backup recording, a three-minute
explanation, and an honest split between implemented automation, operator-assisted preparation, and
incomplete sponsor integration.

**Done when:** the demo runs at an acceptable frame rate on the judging laptop, the cached sample loads
without contacting the provider, and the submission text names what is not finished.

---

## P6 — Sponsor handoff (no public integration surface; do not schedule code)

**Researched 2026-09-19. There is nothing to integrate with.** Four independent sources agree:

- The opening-ceremony deck (pp. 55–59) states the requirement — "the redesigned building becomes part of
  the live game world" — and gives no mechanism, no endpoint, no format, no auth.
- The [hacker guide](https://vthacks.com/guide) reduces the track to one line: "Turn building photos and an
  address into a correctly placed, map-ready 3D model for Scorched Nebraska."
- [Devpost](https://vthacks-14.devpost.com/) lists the Procedura AI track as "Details TBD."
- [scorchednebraska.org](https://scorchednebraska.org/) has no public API documentation, no coordinate
  conventions, no mesh format specification, and no asset submission system. The renderer is custom
  OpenGL, not Unity or Unreal, so there is no standard package format to target either.

So this is not a lane that is waiting on information. **Do not assign anyone to it.** Replace it with a
handoff artifact that stands on its own: the unchanged GLB plus the `PlacementManifest`, with the asset
hash, the local frame and origin, the column-major matrix, provenance, metrics and warnings — documented
well enough that someone else could load it. That is the deliverable P6 was ever going to produce.

Two things that could change this, both conversations rather than work items:

1. Ask on the event **Discord** — the hacker guide says company-specific details are posted there, and
   mentor support runs through the help desk.
2. If a Procedura representative is at the venue, ask for one accepted input/output example, coordinate
   conventions, auth, and a round-trip test. Ten minutes. If you get a real contract, this becomes a lane.

Until then: `PlacementManifest.world_registration` stays `"not-integrated"`, and the presentation says so.
A receipt plus a reload is integration; anything else is not, and must not be described as one.

---

## Not colliding

- **One owner per file.** The lists above are the collision guard. If you need a file you do not own, ask
  its owner to make the change.
- **Shared files** — `server/app/schemas.py` and `web/src/lib/api.ts` are frozen by P0 and touched by
  everyone. Announce before editing either; they change in pairs or not at all.
- **Branches:** one per lane off `main` (`lane/p1-backend`, `lane/p3-geometry`, …), merged often. Long-lived
  branches over a 16-hour build cost more than they save.
- **Report what ran, not what was written.** A lane is done when its check was executed and observed.
  "The code is there" is not a status.

## Where the lanes meet the schedule

`implementation-plan.md` §3 sets the gates. Mapped onto lanes:

| Gate | What must be true |
| --- | --- |
| Hour 1 | P0 committed. P4 has a real generation submitted. |
| Hour 3 | P1 drives a fixture job to `succeeded`. P4 has inspected the first real concept/model. |
| Hour 6 | P3's four checks pass. P2 polls a real job. |
| **Hour 8** | Full local MVP: photo → concept → GLB → fit → export, on one real asset. |
| Hour 10 | P6 resolved or declared blocked. Stop new asset experiments. |
| **Hour 12** | Feature freeze. P5 only. |
| **Hour 14** | Submitted. |

If a gate slips, cut scope — do not move the freeze or the submission time.
