# PRODUCT.md — Groundtruth

Durable product truth. Visual decisions live in DESIGN.md; per-surface strategy lives in
`.impeccable/surfaces/`. Written 2026-09-20 from the settled research in `CLAUDE.md` (sponsor
research, repository state, contracts) rather than from a fresh interview.

## What it is

Groundtruth turns a real street address plus building photos into a correctly placed, map-ready 3D
model. Photo + style prompt → AI image-to-image redesign → image-to-3D mesh → an automatically
computed transform that snaps that mesh onto the authoritative GIS footprint → an inspectable 4×4
matrix, an exported GLB and placement manifest, and a third-person walkable scene.

**The unique mechanism:** the placement transform is computed, factored and shown — position, scale,
rotation and ground alignment against a real OpenStreetMap footprint, with the overlap measured and
the result labelled accepted, review or rejected.

## Audience and scene

Two readers, in this order:

1. **Hackathon judges at VTHacks 14 (Procedura AI track).** Science-fair format in NCB. Three
   minutes to present, one minute of questions, repeated to several panels back to back. Nobody runs
   the code — a person looks at a laptop screen for 180 seconds under bright conference-room light.
   The demo resets in seconds and must survive bad conference wifi or none at all.
2. **Category-fluent practitioners** — GIS, survey and architecture people who read footprints,
   coordinates and transforms daily, and who will immediately distrust an interface that fudges them.

## What success looks like

A judge understands, without narration, that the model is *placed* rather than merely *rendered*:
that a specific authoritative footprint was matched, that a specific transform did the matching, and
that the software has an opinion about whether the result is good enough.

## Constraints that bind the interface

- **Honesty labels are product truth, not decoration.** `ambiguous`, `inferred`, `flat-assumed`,
  `review`, `rejected`, "Local AI simulation", "fixture (synthetic)", "user-declared",
  "manual-placement" are typed claims about what was and was not verified. They must stay legible on
  screen. Simulated or fixture output may never read as AI generation.
- **Bad numbers stay visible.** Burruss is rejected at 73.13 % IoU; DDS at 52.62 %. These are
  correct behaviour, not blemishes to style away or soften.
- **The free-import path must show no scoring vocabulary and no latitude/longitude** — no IoU,
  coverage, spill, or accepted/review/rejected. `check-free-import.mjs` asserts their absence.
- **Offline.** The demo must work with the network off. No runtime CDN dependency for anything the
  interface needs to render correctly.
- **Five stages, gated by artifacts.** Ingest → Redesign → Reconstruct → Fit → Explore. There is no
  router; `store.unlocked()`/`completed()` derive which stages are reachable.
- **Fit is the centrepiece.** Matrix factorization, IoU, footprint overlay, before/after. Explore
  proves nothing about placement correctness.

## Voice

The product's own language: measurement, provenance, and stated uncertainty. Name what was measured
and what was assumed. Never claim more than the pipeline verified.

## Brand commitments

None inherited. The name *Groundtruth* is a survey term and is the one fixed word.
