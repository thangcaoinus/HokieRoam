### Project Overview: Map-Ready Generative 3D Architecture Pipeline

An end-to-end spatial computing pipeline that turns 2D real-world building photography into an AI-redesigned, fully textured 3D mesh, automatically calculates the mathematical transform required to snap and scale the model onto authoritative GIS footprint polygons, and loads the result into an interactive WebGL scene with real-time character navigation.

---

### Core Architecture & Technical Specifications

#### 1. Ingestion & Spatial Resolution

* **Input Parameters:** A real-world street address and one or more baseline photos of an existing physical structure.


* **Geospatial Resolution:** Resolves the physical address to real-world latitude/longitude coordinates and pulls the authoritative 2D building footprint polygon (GIS boundary coordinates).


* **State Persistence:** Registers the geographic bucket for the building location to maintain provenance and world state inside the persistent world environment.



#### 2. Generative Redesign & 3D Reconstruction

* **2D Conceptual Redesign:** Ingests the source image alongside an aesthetic text prompt (e.g., post-apocalyptic for *Scorched Nebraska* or sustainable smart campus) through an image-to-image pipeline, retaining architectural geometry while restyling materials and surface elements.


* **3D Mesh Generation:** Converts the restyled 2D architectural concept into a textured 3D mesh asset (`.glb` / `.obj` format) via automated image-to-3D reconstruction.



#### 3. Automated Fitting & Alignment Math (Core Engine)

The pipeline ingests the raw mesh and automates the placement transform without manual 3D modeling tools:

* **Unit & Axis Normalization:** Normalizes coordinates to a standard coordinate space ($Y$-up, meters).


* **Centering & Ground Plane Alignment:** Computes the mesh axis-aligned bounding box (AABB) $[x_{\min}, x_{\max}]$, $[y_{\min}, y_{\max}]$, and $[z_{\min}, z_{\max}]$. Translates vertices by $(-(x_{\min} + x_{\max})/2, -y_{\min}, -(z_{\min} + z_{\max})/2)$, placing the lateral center at $(0, 0)$ and grounding the base flush to the $y = 0$ terrain plane.


* **Footprint Orientation Matching:** Computes the 2D minimum-area oriented bounding box (OBB) of the authoritative GIS polygon using rotating calipers. It computes the mesh's base orientation on the $XZ$-plane, determines the yaw rotation delta $\Delta \theta$, and tests the cardinal orientations ($\Delta \theta + k \cdot 90^\circ$ for $k \in \{0, 1, 2, 3\}$) to maximize 2D Intersection-over-Union (IoU) with the footprint.


* **Proportion-Preserving Scaling:** Computes uniform scale factor $s = \min(L_{\text{target}} / L_{\text{mesh}}, W_{\text{target}} / W_{\text{mesh}})$ to fit the footprint boundaries without architectural distortion. If aspect ratios diverge, it applies constrained non-uniform scaling $(s_x, 1.0, s_z)$.


* **Collision & Validation:** Verifies boundary overlap against adjacent cadastral parcels and flags low-confidence alignments for manual review.


* **Transform Export:** Serializes a reproducible $4 \times 4$ affine transform matrix $(T_{\text{target}} \cdot R_y(\theta) \cdot S \cdot T_{\text{ground}})$ anchoring the mesh to the global map coordinates.



#### 4. Interactive Three.js Scene & Character Controller

* **Spatial Rendering:** Displays the authoritative 2D footprint boundary, the raw bounding box, and the newly snapped 3D building mesh in real time.


* **Third-Person Controller:** Integrates a responsive kinematic player character (capsule mesh) with keyboard `WASD` controls to explore the generated structure in the browser.


* **Camera Rig:** Implements an over-the-shoulder chase camera tracking the character using smooth vector interpolation (`lerp`) and continuous look-at tracking.


* **Bounding Box Collision:** Restricts movement by checking player coordinates against the 2D building footprint polygon and outer bounding box, preventing clipping into the newly placed structure.

---

### Hackathon Track Alignment & Deliverables

* **Procedura AI Track:** Directly fulfills all technical specifications of the "Photo to Map-Ready 3D Building" prompt, including automated placement transforms, footprint fitting, and asset integration into the *Scorched Nebraska* game environment (competing for up to 2 team internship prizes).


* **Deloitte × Databricks Track (Optional Multi-Track):** Framed as a "Hokie Smart Campus" tool using Databricks to manage campus asset footprints, energy retrofits, and building lifecycle data.


* **Cloudforce "Side Kick" Track (Optional Multi-Track):** A lightweight, no-login micro-app that takes a dorm name and outputs a personalized *Scorched Nebraska* survival diagnosis card to drive viral social engagement for the $1,000 cash prize.


* **Sunday Judging Requirements:** A working live demo at Sunday morning's science-fair booth (NCB, 9:00 AM) demonstrating the live pipeline, inspectable transform matrices, and interactive player navigation within a 3- to 5-minute presentation.