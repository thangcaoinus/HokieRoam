/**
 * Scene palette for the 3D and plan views, mirroring the survey-sheet tokens in styles.css.
 *
 * The plates are LIT, not dark: a drawing sheet pastes a studio photograph onto paper, so the
 * model sits on a pale sweep and the geometry reads as ink on it. Keep the single-accent rule —
 * vermilion means the authoritative footprint and nothing else, so it stays the only saturated
 * thing in frame and the eye goes to the boundary the placement is measured against.
 */
export const SCENE = {
  /** studio sweep behind the model */
  bg: '#e7e4dd',
  bgDeep: '#ded9d0',
  /** ground plane the model is grounded onto */
  ground: '#dcd7ce',
  /** drafting grid: 1 m cells, 10 m sections */
  gridCell: '#c9c4ba',
  gridSection: '#a9a297',

  /** the authoritative GIS footprint — the only vermilion in the scene */
  footprint: '#c2341d',
  /** the mesh's own projected proxy, drawn as ink so red-vs-black reads as target-vs-actual */
  proxy: '#16181c',
  /** reference geometry: oriented/axis-aligned bounding boxes */
  reference: '#2b5c8a',

  /** adjacent parcels: massed in neutral so they never compete with the subject */
  neighbor: '#c6c0b5',
  neighborEdge: '#9b948a',

  /** lighting */
  skyLight: '#ffffff',
  groundLight: '#cfc8bc',
  keyLight: '#fff6ea',
  fillLight: '#cfe0f0',
} as const
