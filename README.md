# VTHax14

Map-ready generative 3D architecture: photos and a style prompt become a generated building asset, fitted to a verified geographic footprint and exported with reproducible placement.

`web/` is a five-stage React UI connected to the FastAPI pipeline in `server/`. With
`VITE_API_BASE` configured, generation uses saved asynchronous jobs and real meshes use the backend
placement manifest throughout Fit, Explore, export, and refresh. Without it, the UI runs an explicitly
labeled local simulation. See [frontend setup and verification](web/README.md).

Click **Load completed real example** on the first screen, or open `/?example=dds`, to explore
the cached Meshy model without backend, GIS, or generation access. Its simplified copy has 59,962
triangles and a 12.9 MB GLB. Placement remains visibly rejected; this is an inspection example.
**Open saved ZIP** also reopens exported results directly into Explore, with artifact checks,
refresh recovery, and unchanged re-export.
The original generation is preserved in `samples/live/`. Sponsor import is not implemented.
Follow the [MVP completion plan](mvp-next-steps.md) and [product pitch](pitch-plan.md).

The original implementation plan records the initial 16-hour schedule. Use the MVP completion plan
for current status and remaining work.

- [Detailed progress report](progress-report.md) — completed work, checks, limitations, and next steps
- [Project specification](spec.md)
- [Feasibility review and geometry contracts](feasibility-plan.md)
- [Active 16-hour AI-assisted implementation plan](implementation-plan.md)
- [Work split: self-contained lanes](work-split.md) — pick a lane here before starting
- [Research and extended architecture reference; deferred scope](technical-reference.md)
