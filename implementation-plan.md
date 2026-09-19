# Active plan: an AI-assisted hackathon build in 16 hours

**Confirmed constraints:** about 16 elapsed hours remain, and AI will write most of the implementation. Target a working automated pipeline by hour 8, freeze features at hour 12, and submit by hour 14 with two hours of final buffer. Count from the user's deadline update, not from the end of planning.

The earlier 16–26 person-hour estimate is not the execution model. AI can generate the UI, adapters, geometry code, and checks quickly; usable assets, credentials, debugging, and actual sponsor compatibility still need evidence. The schedule below is a set of timeboxes, not a guarantee of AI output quality.

The longer architecture and research are preserved in [technical-reference.md](technical-reference.md). This document controls the hackathon scope. The application is not implemented yet.

## 1. What we can realistically aim to ship

**One complete, polished pipeline for one selected real building:**

1. Select the verified address/footprint, upload a photo, and enter a style prompt.
2. Start the provider's image edit, then image-to-3D generation; show real stage/status.
3. Download and display the textured GLB.
4. Automatically ground, rotate, and uniformly scale it to the footprint; show before/after and actual polygon-fit metrics.
5. Export the unchanged GLB and a reproducible placement manifest.
6. Import into Procedura/Scorched Nebraska if the supplied interface is accessible, and show evidence of the accepted placement.

Keep a genuine completed sample ready throughout development. A cached result supports judging while a fresh job runs; label it explicitly.

**Must ship:** one real generated asset, automatic placement, an inspectable viewer, export/reload, and clear status for each stage. **Target for the full MVP:** live photo-to-mesh orchestration and actual sponsor handoff. If either external dependency fails, disclose the incomplete stage rather than presenting the fallback as the complete pipeline.

Exterior WASD navigation is a one-hour stretch if the full local pipeline already passes by hour 8. Orbit inspection is the default interaction. No interiors, arbitrary-city coverage, optional sponsor products, or model training.

## 2. Division of work: AI, human, external services

| Owner | Work | Evidence that it is done |
| --- | --- | --- |
| AI | Scaffold app, typed contracts, provider/GIS adapters, simple persisted jobs, geometry, viewer, export, focused tests, README and demo draft | Running code and observed checks, not generated files alone |
| Human | Supply account access, choose the building/photo, confirm the right footprint, judge whether the concept/model looks usable, clarify sponsor requirements | Fast decisions at the gates below; credentials remain server-side |
| AI + human | Inspect the real output, compare placement and source, run the actual sponsor import, rehearse the presentation | A real sample loads and behaves correctly on the judging laptop |
| External services | Image editing, mesh generation, GIS responses, sponsor import | Successful responses and copied artifacts; these latencies cannot be eliminated by faster coding |

Run useful work concurrently: start generation early; AI builds and tests against a box fixture while the provider runs and the human verifies the building. Team size is unconfirmed, so this plan does not depend on several human developers or assume a particular number of AI agents.

AI should implement one runnable slice at a time. Commit to a shared asset/coordinate contract first; then run each slice before adding another. Reserve time to inspect generated code, especially frame conventions, paid-request retries, and matrix export.

## 3. The 16-hour execution schedule

| Elapsed time | AI implementation | Human / external work | Completion gate |
| --- | --- | --- | --- |
| **0–1 h** | Scaffold frontend/backend, fix the small data contract, make the first provider request or a minimal generation script | Choose one simple building/photo, verify footprint and API credits; establish sponsor interface | A real generation is submitted, and the app runs with a fixture |
| **1–3 h** | Build photo/concept/model panels, GLB loader, footprint overlay, provider status polling and saved task IDs | Inspect the first concept/model as it arrives | Real GLB loads, or the exact generation blocker is known |
| **3–6 h** | Implement normalization, four-heading uniform fitting, polygon metrics, before/after view, manifest export and focused geometry checks | Review the building's base, facing, and visible resemblance | Real asset fits or is honestly flagged; export/reload agrees |
| **6–8 h** | Connect the complete photo → concept → GLB → fit flow; fix errors and refresh/resume behavior | Run a fresh job and retain the successful cached sample | **Target: full local MVP by hour 8** |
| **8–10 h** | Implement/test sponsor import against the actual contract; package a minimal deployment if straightforward | Verify the world placement and save receipt/reload evidence | Working handoff, or an explicit integration blocker |
| **10–12 h** | Fix the main flow and visual presentation; check performance and the cached fallback | Rehearse once and identify confusing parts | **Feature freeze at hour 12** |
| **12–14 h** | Run final checks, prepare README/submission text, capture screenshots and backup video | Verify links and submit; rehearse the three-minute presentation | **Submit by hour 14**, or sooner if the real deadline requires |
| **14–16 h** | Critical fixes only | Submission trouble, relocation, breaks, and final rehearsal | Buffer remains available |

These are elapsed-time budgets for AI-assisted work, not 16 hours of uninterrupted human coding. Take short breaks inside the blocks. If already behind a checkpoint, cut scope instead of shifting the freeze or submission time.

## 4. Stack sized for AI implementation and easy debugging

| Piece | Choice | Limit |
| --- | --- | --- |
| Frontend | Vite + React + TypeScript + Three.js; React Three Fiber/Drei if familiar | One page, orbit camera, status, metrics, export |
| Backend | One FastAPI app; HTTPX for provider and GIS requests | One operator, one active generation sequence |
| Geometry | NumPy, trimesh, Shapely, pyproj | Reuse library operations; no custom polygon Boolean code |
| State | SQLite for jobs/task IDs and placement metadata; local files for artifacts | A couple of small tables; no elaborate repository framework |
| Orchestration | A small polling loop in the same backend, resuming saved provider task IDs | No separate worker service, Redis, or distributed queue |
| Generation | One hosted provider using the model/settings that pass the first sample | No local GPU setup or provider comparison project |
| Hosting | Laptop first; one small CPU host with persisted files if needed | A static cached viewer is a fallback, with live-generation limitations stated |

AI can implement a small job table cheaply enough to retain refresh/restart behavior. A distributed job system, transactional accounting platform, cloud object storage, authentication system, and multi-user architecture do not help the selected demo.

Keep the initial code surface small:

- Frontend: app/form/status, building scene, API client.
- Backend: routes/schemas, provider integration, fitting/export, lightweight job persistence.
- Assets: one sample directory containing photo, concept, original GLB, footprint, and placement manifest.
- Checks: geometry/export checks plus one provider-refresh/recovery smoke check.

Save a submission intent before requesting paid work, then save the provider task ID. If the request times out ambiguously, inspect the provider account before issuing another request. Polling or page reloads must never trigger new paid generations. Keep API keys on the backend and generation restricted to the demo operator.

## 5. Research-backed geometry we actually implement

Use the existing [coordinate contract](feasibility-plan.md#4-coordinate-and-geometry-contract): local meters, X East, Y Up, Z South; record the origin and source CRS.

1. Resolve every mesh node's transform before measuring. Review obvious ground slabs/background debris, then automatically center and ground the clean asset.
2. Start with the projected convex hull as a conservative, explicitly labeled proxy for the model footprint.
3. Use Shapely's minimum-area rectangle to initialize orientation. Test four yaw candidates and recompute uniform XYZ scale for each; align box centers.
4. Score the transformed proxy against the **actual GIS polygon** using IoU, coverage, spill, and containment. A fitted bounding box is not proof of polygon containment.
5. Keep the best valid placement; otherwise show review/rejection. The earlier IoU ≥ 0.85 gate remains a proposed demo policy, not a guarantee that every generation passes.
6. Allow a facade flip when symmetry leaves facing ambiguous. Label inferred height and assumed flat ground.
7. Export one placement matrix for the unchanged source asset, with asset hash, column-major storage, geographic origin, provenance, metrics, and any override. Verify it in a fresh viewer.

**AI-assisted improvement, capped at one hour:** if a clean convex target fails because centering is too restrictive, implement the documented fixed-heading linear program with SciPy to solve translation and scale together. Use it only if its fixture checks pass within the existing geometry block. It is not a reason to extend that block. Concave/courtyard fitting and non-uniform deformation remain deferred.

| Established or recent result | Hackathon decision |
| --- | --- |
| Minimum-area rectangle / rotating calipers | Use library OBB initialization; no learned orientation solver |
| Single-view scale ambiguity | Use GIS for plan scale; do not call guessed height measured |
| Symmetry and affine-topology limits | Offer heading review; reject missing wings/courtyards rather than optimizing indefinitely |
| SAM 3D / TRELLIS.2 | Use clean cropped inputs and hosted generation; no local model installation |
| SiZeUp's footprint-based representation | A labeled extrusion is a placement fallback, not evidence that image-to-3D succeeded |
| VGGT, ICP, learned footprint extraction | Retain as later research, not extra integrations this weekend |

The [research table and primary sources](technical-reference.md#4-recent-research-translated-into-implementation-choices) remain available for a concrete implementation question. No further literature review is needed before building.

## 6. Budget and cutoff rules

Keep the earlier **approximately $20 local / $25–35 hosted planning estimate**, conditional on actual account pricing and API-usable credits, with **$50 as a proposed ceiling**. This is not an authorization to purchase. [Meshy plan comparison](https://help.meshy.ai/en/articles/12062933-which-meshy-plan-is-right-for-you-free-vs-pro-vs-premium-vs-ultra), [hosting price reference](https://railway.com/pricing).

Allow **four main attempts, one backup, and one rehearsal/live attempt**. At the previously checked upper baseline of 12 edit credits plus 30 mesh credits, six full attempts use **252 credits**; one optional 5-credit remesh brings that to **257**, inside a proposed **300-credit cap**. Higher-resolution settings can cost more. Reuse an accepted concept, cache every successful artifact, and inspect the provider balance rather than building an accounting subsystem. [API pricing](https://docs.meshy.ai/en/api/pricing).

| Trigger | Action |
| --- | --- |
| No sponsor credentials/contract after the first hour | Continue the local pipeline and export; keep integration visibly pending |
| No usable model by hour 3 | Improve crop/photo or try the simpler backup building; use the provider UI/manual import to unblock inspection if needed |
| Fitting is consuming the geometry block | Keep the four-heading method and review path; do not expand into arbitrary-shape optimization |
| No full pipeline by hour 8 | Preserve the real cached asset and placement demo; cut fresh-generation UI and optional interaction first |
| Sponsor import still blocked at hour 10 | Deliver the manifest and record exactly what remains unverified; do not claim completed world integration |
| Hour 10 reached | Stop new asset experiments; an optional live judging task must not replace the cached sample |
| Hour 12 reached | Freeze features, even if AI can generate more code quickly |

A procedural extrusion is the last fallback if no genuine generated asset is usable. It must be labeled as such, and the image-to-3D milestone remains incomplete.

## 7. Minimal verification and submission

AI should automate the checks that catch plausible-looking errors:

- A known transformed box, including nested node transforms, grounds and scales correctly.
- Aspect mismatch produces underfill rather than hidden stretching.
- A concave or holed target is not falsely accepted from its bounding box.
- Export/reload reproduces the placement without applying the matrix twice.
- Refresh resumes the same provider task; ambiguous submissions do not blindly retry.

Then verify the actual judging experience: source/concept/GLB visible, fit action clear, real metrics and uncertainty labels, acceptable frame rate, and a cached sample that loads without contacting the generation provider. Keep all offline-required assets local.

Submission needs working links, a short backup recording, a three-minute explanation, and an honest distinction between implemented automation, operator-assisted preparation, and incomplete sponsor integration.

**Next action:** start the real sample generation and scaffold the runnable app. Further architecture planning is no longer on the critical path.
