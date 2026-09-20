# HokieRoam

## Inspiration

The challenge was to turn building photos and an address into a correctly placed, map-ready 3D model. We
assumed at first that most of the work would be integration — that there would be an endpoint to post a
mesh to and a format to target. Reading the challenge materials more carefully, we realised the task was
to build the pipeline itself: resolve the address and its authoritative footprint, coordinate the image
and 3D generation, and return the mesh to the map with a placement transform you can reproduce. That
reframing is what made the project interesting, because generating a restyled building is one API call,
while getting it to land at the right coordinates, at the right size, facing the right way, with its base
on the ground, is the part nobody hands you.

## What it does

An address and up to four photos of one building go in, and a placed, walkable 3D building comes out:

1. **Ingest** — geocode the address and pull the authoritative building footprint from OpenStreetMap.
2. **Redesign** — one image-to-image call per photo, against a creative prompt.
3. **Reconstruct** — one multi-image-to-3D call turns those concepts into a textured mesh.
4. **Fit** — compute the 4×4 transform that snaps the mesh onto the real footprint, and measure it.
5. **Explore** — orbit the result, or walk around it in third person on the real parcel.

The export is a GLB plus a placement manifest holding the asset hash, every candidate transform, the
selected matrix, the metrics and the warnings — a placement you can audit rather than a black box.

## How we built it

FastAPI and SQLite on the backend with one async task per job, React and react-three-fiber on the front
end, and Meshy for generation behind a provider interface with an offline fixture we did most of the
development against. The fit takes the convex hull of the mesh's projected footprint, aligns its long
axis to the footprint's, tries the four 90° rotations, and takes the largest uniform scale that fits.
Each candidate is scored on overlap with the real footprint:

$$\text{IoU} = \frac{|P \cap F|}{|P \cup F|}$$

and the chosen matrix is factored on screen into translation, rotation and scale so it can be read
instead of trusted.

## Challenges we ran into

The hardest part turned out not to be placing the model, but that the model and the real building
aren't the same shape. Photos taken from the street only show a building's outside, so what comes back
is a simplified version of it — the wings, courtyards and setbacks that make a real outline complicated
just aren't there. Laying that simplified shape onto the real one leaves gaps no amount of repositioning
can close, and we spent a long time treating a reconstruction problem as a placement problem.

What made that clear was trying the obvious improvement and watching it backfire. Our outline of the
model was deliberately rough, so we tightened it to follow the walls more faithfully, and the fit got
noticeably worse on both test buildings. The rough outline had been quietly covering for the missing
wings; making it honest only exposed how much of the building the photos never captured.

We also ran into two sources that were both right and still disagreed. The public map data records a
height for the building, and the model has its own — but the record measures the main roofline while the
model includes the tower above it. Trusting the record flattened the building into something visibly
wrong, so we now let a recorded height correct the model only so far, and when the two disagree past
that point we keep the model's proportions and say so on screen rather than quietly picking one.

The tempting fix, all the way through, was to relax our own passing bar until the placement qualified.
We left it where it was, which is why our demo building is reported as not passing at 73% overlap, with
the reason shown beside it.

## Accomplishments that we're proud of

The whole pipeline runs end to end on a real building, and the placement is inspectable at every step
rather than asserted. We're most pleased with how the uncertain parts are handled: unverified facade
heading, inferred height and assumed flat terrain are each typed fields in the record and shown on
screen, so the demo can be honest about a placement that didn't pass and still be worth looking at. A
placement that needs a human can also get one — you can drag and rotate the building over its footprint
and watch the overlap update live, and the correction stays labelled as a manual adjustment rather than
being folded into the computed result.

## What we learned

The bugs that cost us the most time didn't throw errors. Our footprint queries were quietly falling back
to a synthetic parcel on the venue network, and separately were missing every multipolygon building —
which includes Burruss Hall itself — so we spent hours computing correct geometry from the wrong input.
Checking an intermediate result against something derived independently caught far more than checking
that the pipeline ran.

## What's next for HokieRoam

**Closing the shape gap.** Everything we measured points at the reconstruction rather than the
placement, so that is where the next work goes. More input views is the cheapest step: going from one
photo to four already took us from a flat facade to a model with real depth, and adding aerial or
oblique angles is what would recover the wings and courtyards that street-level photos can't see. Past
that, proper photogrammetry from a larger photo set would produce a model whose outline genuinely
matches the real one — and only then do the fitting refinements we've measured but not shipped, like a
finer search over position and scale, become worth having. Fitting a complicated outline is worth
solving once the model has a complicated outline to fit.

**Real ground.** We assume flat terrain today and say so on screen. Reading a real elevation model would
let a building sit correctly on a slope, which matters on a campus built into a hillside.

**More than one building.** The pieces for a whole block are already there — we can stage and walk
several models in one scene — so the next step is placing a row of real footprints at once and letting
someone reimagine a street rather than a single facade.

**Where we'd like it to be useful.** Accurate placement is what separates a proposal from a picture. A
neighbourhood can see a proposed development at its real position and scale before it exists, a planning
office can compare options in context, and a facilities team can show a renovation standing in the spot
it will actually occupy. The pipeline also runs the other direction: restyle a building to an earlier
era and place it back on its own footprint, which on a campus with this much history is the version we
most want to build next.

## Built with

python fastapi sqlite numpy shapely trimesh pyproj typescript react
three.js react-three-fiber vite zustand meshy-ai openstreetmap nominatim
overpass-api gltf
