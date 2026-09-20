---
version: 1
slug: "web-src"
primary_target: "web/src"
related_targets: ["web/src/styles.css", "web/src/App.tsx", "web/index.html"]
---

## Scope

Operate mode: the whole Groundtruth five-stage instrument (Ingest, Redesign, Reconstruct, Fit,
Explore) plus its shared chrome. Replacement visual world, approved by the user 2026-09-20;
product truth, copy, stage gating, honesty labels and every measured number are preserved exactly.

Audience and task: see PRODUCT.md. The user rejected the incumbent look in these words — "more
design-y, more impressive but lean, not this over-hyped tech looking darkmode" — and chose the
survey-sheet direction over a blueline-print alternative and a two-tone paper/well split.

## Direction contract

THESIS: A placement is a drawing on a sheet, so the instrument is a sheet. Groundtruth refuses the
category default it currently ships — near-black ground, one neon accent, glow on every border,
glass panels, animated gradient drift — and refuses its predictable opposite, the cream-paper-and-
serif editorial page. The measured number is the hero; nothing glows around it.

OWN-WORLD: Warm-neutral drafting ground (#f4f2ed) with a cooler panel layer for the rail and
titleblock. Ink (#16181c) hairlines at exactly 1px carry every division — no shadows for structure,
no rounded card stack, corners at 2–3px or square. One vermilion (#c2341d) reserved for the
authoritative footprint, the primary action, and the current stage; never decoration. Semantic
state in survey inks: verdigris for accepted, ochre for review, oxide for rejected. Archivo
(variable weight + width, self-hosted) throughout, its condensed cut for titleblock and field
labels; Spline Sans Mono only where characters must align — the matrix, the event log. Tabular
lining numerals on every measurement, always. Recognizable with all content removed by: the
titleblock strip, the hairline grid, the vermilion single-accent discipline, and the absence of
any filled card.

STORY: The visitor sees an instrument that has already done arithmetic and is showing its work.
They read which footprint was matched, what transform matched it, how well it overlapped, and
whether the software accepts the result. They leave able to say "it measured it and said no."

FIRST VIEWPORT: A 44px titleblock spans the full width — wordmark left, the resolved place and
bucket centre, provider honesty chip and New right, all on one hairline baseline. Below it a 264px
left rail: a numbered sheet index of the five stages (current one marked by a vermilion bar in the
gutter, not a filled pill), then a hairline-ruled field table of the live measurements, then the
event log flush to the bottom. The remaining area is the stage, on the paper ground, opening with
a single plain heading and the working surface immediately under it. On Fit — the stage that
matters — the plan plot and the 3D view sit side by side above a full-width strip of measurements
set large in tabular figures, with the verdict stated in words next to them.

FORM: Survey sheet, first on the ordered candidate list (drafting/cadastral family), chosen by the
user from three presented directions. The concept-seed script was unavailable in this harness — the
Impeccable launcher is blocked from executing here — so the roll was replaced by an explicit
three-option user choice, disclosed here rather than claimed as a seed. No seed key exists.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Authority

User-pinned direction (survey sheet, light) and scope (all five stages), answered through the
structured question tool on 2026-09-20. No new raster assets: the only images are the existing
sample photographs and cached example renders, all pre-existing.

Constraint carried from PRODUCT.md into this surface: the demo must render correctly with the
network off, so the Google Fonts CDN link in `web/index.html` is replaced by self-hosted woff2.
