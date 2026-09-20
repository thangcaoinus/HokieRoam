# Burruss Hall — green-scape redesign

Building: **Burruss Hall, Virginia Tech, Blacksburg, Virginia**.

Exact user prompt:

> make this overflow green scape building

This is a live Meshy pipeline run, not a local simulation or fixture. Four source photographs
are restyled individually and the four resulting concepts feed one multi-image 3D generation.
Settings: strength **0.8**, image model **nano-banana**, mesh model **meshy-6**, target **60,000 polygons**.
The provider appends the selected intensity and an instruction to preserve the building silhouette,
perspective and visible structural layout to the exact user prompt.

## Files

- `inputs/`: the four photographs submitted, in generation order.
- `sources.json`: source pages, image URLs, author/license information and source checksums.
- `job.json`: latest job status and provider task IDs.
- `generation.log`: local progress log.
- `result/`: downloaded source photos, concept images, model.glb and generation.json after completion.
- `bundle.zip`: the pipeline export after completion.
- `run_generation.py`: resumable runner using the same saved job key; requires the backend environment.

The four views are a wide front elevation, low oblique tower view, rear elevation, and elevated
front view. The last image looks down toward the entrance, but is **not a top-down roof survey**.
These are photographs from different dates; trees obscure parts of the rear and elevated views.
The oblique image emphasizes the tower rather than showing the entire building. The model is a
creative reconstruction, not a measured survey. No geographic fit/placement is requested for this run.

## Photo credits

1. [Wide front view](https://commons.wikimedia.org/wiki/File:Virginiatech-burrusshall-fromdrillfield.JPG)
   by **Buridan**, public domain.
2. [Front oblique view](https://commons.wikimedia.org/wiki/File:Burruss_Hall_-01-_(12349518863).jpg)
   by **Ben Schumin**, [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/).
   The returned concept is an AI-modified derivative; preserve attribution and applicable share-alike terms.
3. [Rear view](https://commons.wikimedia.org/wiki/File:Virginiatech-backofburruss.JPG)
   by **Buridan**, public domain; downloaded at 1280-pixel preview resolution.
4. [Elevated front view](https://staging.campus360.org/Virginia-Tech/virginia-tech-from-above-3)
   from the **Campus360 Virginia Tech campus tour**, front face of its aerial panorama.
   Individual photographer and open reuse license were not specified. Saved here as a project reference.

Generation does not imply endorsement by the photographers or Virginia Tech.
