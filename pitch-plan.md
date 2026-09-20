# Pitch and product implementation plan

## Product direction

Build a creative tool that turns real building photos and a style prompt into a
restyled, explorable 3D asset connected to its real location.

**Tagline: Reimagine a place. Walk into your idea.**

The product helps people move from imagining a change to experiencing it spatially.
Asset generation, restyling, and 3D exploration are the central experience.
Geographic placement and reproducible export make that experience useful beyond
the current browser session and align it with Procedura's challenge.

This file records the pitch direction and product priorities. Use
`mvp-next-steps.md` for the existing integration gaps and technical completion
checks; this plan does not imply those gaps are already resolved.

## Proposed pitch

> What would your campus look like as a cyberpunk city, a sustainable neighborhood,
> or a post-apocalyptic game world?
>
> Our project turns building photos and a creative prompt into a restyled 3D asset
> you can explore in your browser. By connecting the result to its real geographic
> footprint, we let you experience the design in the context of the place that
> inspired it.
>
> We're starting with buildings, with potential applications in game environment
> creation, architectural concept exploration, and interactive experiences.

This is the target product story. Submission copy and narration must distinguish
implemented behavior from future capabilities.

## Procedura alignment

Source: `VTHacks 14 Opening Ceremony.pdf`, slides 55–58, visually reviewed.

The sponsor brief includes the complete creative sequence: building address and
photos, a design prompt, a redesigned image, a generated mesh, and placement at
the original address. Scorched Nebraska provides a specific application: an
explorable post-apocalyptic world built from real places.

Our broader product follows that sequence while allowing other styles and uses.
The sponsor-facing technical evidence should demonstrate position, scale,
rotation, grounding, footprint validation, and a reproducible placement transform.
Keep uncertainty and review states visible.

Describe current footprints by their actual source, such as OpenStreetMap. Describe
the exported bundle as a handoff artifact until a real sponsor import has been
implemented and verified. Browser exploration alone does not establish integration
with Scorched Nebraska.

## User value

| Capability | Value | Demo role |
| --- | --- | --- |
| Generate and restyle | Express a visual idea without manually modeling everything | Creative transformation |
| Explore in 3D | Inspect scale, silhouette, and appearance from different viewpoints | Memorable interactive experience |
| Place and export | Connect the asset to a real location and make it reusable | Engineering evidence and sponsor alignment |

Potential applications share the same workflow:

- Game creators prototype environments inspired by real places.
- Designers communicate early exterior concepts through explorable alternatives.
- Campus communities experience alternative visions of familiar buildings.

Present these as potential uses until demonstrated. Generated geometry is an
approximation; the current experience does not establish architectural accuracy,
construction suitability, or reconstructed interiors.

## Implementation priorities

### 1. Establish a compelling real transformation

Choose one recognizable building with matching photos and a confirmed footprint.
Produce a clearly different style and a coherent textured model. Inspect the
existing real sample first: its saved placement is rejected, so it is not yet a
proven success example. A simpler building may provide a better primary demo.

**Done when:** the photo, prompt, concept image, and genuine generated model form
a convincing visual sequence; placement quality is measured and honestly shown;
the model runs acceptably on the demo laptop.

### 2. Connect authoritative placement throughout the experience

Use the backend placement manifest for API-generated assets in Fit, Explore, and
Export. Apply its matrix to the source asset exactly once. Preserve placement on
reload and invalidate it when the asset or footprint changes. Keep browser-only
fitting explicitly labeled as a simulation or preview.

**Done when:** fitting, exploration, export, and a fresh reload show the same
transform and metrics without triggering another generation.

### 3. Make exploration a primary destination

Provide a clear "Explore this design" action after an asset is ready. Support an
easy orbit view and the existing exterior walk-around mode, with obvious controls
and a reset-camera action. Keep the source photo and prompt accessible.

Put footprint overlays, placement metrics, and transform details in an inspection
panel. Keep review or rejection status visible even when that panel is closed.

**Done when:** a first-time viewer can inspect the design, walk around it, recover
the camera, and understand how it relates to the source building.

### 4. Add comparison if the core workflow is complete

Prepare two cached style variants of the same building and compare them from a
consistent camera position. Each variant needs its own placement evaluation if
its geometry changes. Clearly label cached generation.

**Done when:** switching variants makes the creative choice immediately apparent
and preserves the correct asset-to-placement association.

This is the first feature to cut if it threatens completion of one working example.

### 5. Make results reusable and the demo recoverable

Export the model with its prompt, source information, asset hash, and placement
manifest. Add a "Load completed real example" entry point that needs neither
fresh generation nor geocoding. Reopen saved results directly into exploration.
Keep synthetic examples separately labeled.

**Done when:** a fresh browser can load, explore, inspect, and export the cached
real result with provider and GIS access disabled. Prepare a backup recording.

## Three-minute demo narrative

Open with the completed experience:

> This is a real building at Virginia Tech. Here's our reimagined version—and you
> can walk around it.

| Time | Screen and story |
| --- | --- |
| 0:00–0:25 | Show the real photo and completed explorable design. Establish the creative question. |
| 0:25–1:05 | Reveal the photo → prompt → restyled image → generated mesh sequence using labeled cached output. |
| 1:05–1:45 | Orbit and walk around the result. Compare a second style if ready. |
| 1:45–2:20 | Show geographic placement, the footprint overlay, and measured fit quality. Explain uncertainty briefly. |
| 2:20–2:40 | Show export and restoration of the saved placement. |
| 2:40–3:00 | Return to the finished scene and explain the broader creative applications. |

Do not depend on live generation completing during the presentation. Keep matrices
and detailed diagnostics available for technical questions. A difficult rejected
example can support Q&A without displacing the main creative workflow.

## Explain our contribution clearly

> We use Meshy for image and mesh generation. Our contribution is the connected
> creative workflow: geographic matching, coordinate normalization, placement
> evaluation, validation, interactive exploration, and reproducible asset export.

Only claim the parts demonstrated by the final implementation. Avoid unsupported
time-saving numbers, universal building support, or treating footprint overlap as
a percentage of overall reconstruction accuracy.

## Scope and completion gate

The hackathon target is one complete real-building workflow demonstrating a broad
creative vision. Finish that workflow before adding more styles, broader asset
categories, new reconstruction technology, or additional world-building features.

The presentation is ready when it delivers all three moments:

1. A recognizable place undergoes a compelling creative transformation.
2. A person can explore the resulting 3D design smoothly.
3. Its geographic placement and exported result are inspectable and reproducible.
