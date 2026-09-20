# DESIGN.md — Groundtruth

The visual system as built, 2026-09-20. Product truth lives in `PRODUCT.md`; the direction contract
for this surface lives in `.impeccable/surfaces/web-src.md`. Tokens are defined once in
`web/src/styles.css:root` and mirrored for the 3D/plan views in `web/src/lib/sceneTheme.ts`.

## The idea

A placement is a drawing on a sheet, so the instrument is a sheet. Paper ground, ink hairlines, one
vermilion. Structure is carried by 1px rules — never by elevation, glow, or a stack of floating
cards. **Measured numbers outrank headings in the type scale**, because the measurement is the
product: the stage heading is 30px and the placement metrics are 34px.

This replaced a near-black / neon-accent / glowing-border theme. That look is a known default;
if it starts creeping back (a glow, a gradient, a blurred glass panel), it is drift, not a decision.

## Color

Restrained: neutrals plus one accent. Two neutral layers — a warm paper for reading surfaces and a
cooler rail for chrome.

| Token | Value | Use |
| --- | --- | --- |
| `--paper` | `#f4f2ed` | the sheet; page ground |
| `--field` | `#fbfaf7` | working surfaces laid on the sheet |
| `--rail` | `#eae7e0` | titleblock, rail, toolbars, card headers |
| `--sunk` | `#e4e0d8` | inputs, wells, recessed cells |
| `--well` | `#1b1d21` | the only dark ground: the basemap plate |
| `--ink` | `#16181c` | body and hairline ink · 15.4:1 on paper |
| `--ink-2` | `#4a4f56` | secondary prose · 7.1:1 |
| `--ink-3` | `#5f646b` | field labels · 4.8:1 on the **rail**, the darkest ground it lands on |
| `--rule` | `#cfcbc2` | hairline |
| `--rule-2` | `#b3ada1` | division between regions |
| `--vermilion` | `#c2341d` | **reserved**: authoritative footprint, primary action, current sheet |
| `--ok` | `#1f6f5c` | verdigris — accepted |
| `--warn` | `#8a5a0c` | ochre — review |
| `--err` | `#b23124` | oxide — rejected |
| `--blue` | `#2b5c8a` | survey blue — OBB and reference geometry |

Two rules that are load-bearing rather than stylistic:

- **Vermilion means "the authoritative GIS footprint", everywhere it appears** — in the plan plot,
  the map, the 3D scenes, the minimap and the plan editor. Do not spend it on decoration. The mesh's
  own proxy is drawn in ink, so red-versus-black reads as target-versus-actual at a glance. In
  Explore the proxy goes paper-white instead, because ink vanishes in the night preset.
- **`--ink-3` was set against `--rail`, not `--paper`.** Checking a label colour against the page
  ground passes while the same label fails inside the rail. Check the darkest ground it lands on.

### Tint over a ruled grid

`.measure`, `.stats`, `.cands` and `.flags` draw their dividers as 1px gaps with a `--rule` backdrop
showing through. A **translucent** tint on a cell inside them composites over that rule and renders
muddy brown, not pale. Highlight cells therefore use **opaque** tints: `#f9e8e5` (rejected),
`#f7efdf` (review), `#e6efeb` (accepted), `#f9ece9` (`.stat.hl`).

## Type

One family throughout. **Archivo** (variable weight 100–900 and width 62–125%), self-hosted from
`web/public/fonts/`, with its condensed cut at `font-stretch: 80%` for drafting labels — uppercase,
`0.1em` tracking, 10.5px. **Spline Sans Mono** is used only where characters must align: the 4×4
matrix, the event log, coordinates and the rail's field table. Monospace as a costume for
"technical" is not the system.

Fixed rem-ish scale, no fluid clamps (Operate mode: users view at consistent DPI). Steps in use:
10.5 label · 11.5 small · 13.5 body · 14.5 entry heading · 17 lead entry · 26–34 measurement · 30 h1.

`font-variant-numeric: tabular-nums lining-nums` is set on `body` and inherited by form controls, so
every measurement on screen is column-aligned without per-component opt-in.

**Fonts are self-hosted on purpose.** The demo must render correctly with the network off; a Google
Fonts `<link>` puts a CDN between the judge and the first paint. `font-display: block` over local
files, plus `<link rel="preload">` in `index.html`. Verified with all off-origin requests aborted.

## Structure

- **Titleblock** (48px): wordmark, sheet number and name, then the resolved place, bucket, the
  provider honesty chip and New, on one hairline baseline. Below 980px the coordinate chips
  (`.chip-aux`) drop; below 760px the sheet caption drops. The honesty chip never drops.
- **Sheet index** (264px rail): the five stages as numbered ruled rows. The current sheet is marked
  by a 3px vermilion bar in the gutter and a lighter ground — not a filled pill. Then the field
  table of live measurements, then the event log anchored to the foot by `margin-top: auto`, so an
  empty log reads as sheet margin rather than a half-filled box.
- **`.card` is a ruled field, not a floating card**: 1px border, 3px radius, a `--rail` header strip.
  No shadow carries structure. Nested cards are still wrong.
- **`.entries`** groups the no-backend entry points as ruled siblings under one border, so they read
  as alternatives to each other rather than three propositions of equal weight.
- **`.measure`** is the placement band on Fit: the verdict and four metrics in one ruled row, above
  the actions they should inform. It carries `data-verdict` for checks to assert on.

## Motion

Operate mode: 140–250ms, state only. One authored moment — the 180ms sheet change in `App.tsx`. The
ambient drift, scan line, sweep, pulse and glow animations are gone. `prefers-reduced-motion`
collapses everything to 0.01ms.

## Browser surfaces

Themed from the palette, not left at browser defaults: selection (vermilion on white), caret,
scrollbar (`--rule-2` thumb with a paper border), and the focus ring (2px vermilion, 2px offset).

## Accessibility

All body and label text meets WCAG AA against its composited ground; audited with a script that
walks every rendered text node and resolves the nearest opaque ancestor background. Re-run it after
palette changes — the failures it found were all cases where a colour passed on paper and failed on
the rail or on a tinted cell.

## Checks that pin this

`web/scripts/`: `check-example`, `check-bundle`, `check-free-import`, `check-manual-placement` all
pass. `check-free-import` is the guard that no scoring vocabulary or latitude/longitude leaks onto
the derived-site path.

## Known drift

- `.eyebrow` is retained as `display: none`. Kickers above headings are banned; the rule is a guard
  so a reintroduced one cannot ship visibly. Informational labels use `.field-label`.
- `ExploreStage`'s styled world presets (scorched / campus / overgrown / noir) keep their own sky,
  ground and fog palettes. Those are **content** — the redesigned world being walked — not chrome,
  and they are deliberately outside this system. Only the overlays, minimap and HUD follow it.
