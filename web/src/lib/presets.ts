export interface StylePreset {
  id: string
  name: string
  tagline: string
  prompt: string
  swatch: [string, string, string]
  track: string
}

export const PRESETS: StylePreset[] = [
  {
    id: 'scorched',
    name: 'Scorched Nebraska',
    tagline: 'Post-apocalyptic dust-bowl ruin',
    prompt: 'post-apocalyptic ruin, scorched concrete, soot-stained facade, shattered windows, rusted steel, blowing dust, harsh amber sunlight, keep original architectural geometry',
    swatch: ['#2a1508', '#c2551b', '#f3b46b'],
    track: 'Procedura AI',
  },
  {
    id: 'campus',
    name: 'Hokie Smart Campus',
    tagline: 'Sustainable, sensor-rich retrofit',
    prompt: 'sustainable smart campus retrofit, photovoltaic cladding, green roof, high-performance glazing, Hokie maroon and burnt orange accents, clean daylight, keep original architectural geometry',
    swatch: ['#3a0d1c', '#861f41', '#e5751f'],
    track: 'Deloitte × Databricks',
  },
  {
    id: 'overgrown',
    name: 'Reclaimed Wilds',
    tagline: 'Nature takes the city back',
    prompt: 'abandoned building reclaimed by nature, ivy covered walls, moss, overgrown vegetation, soft overcast light, keep original architectural geometry',
    swatch: ['#0e1f14', '#3f7a3a', '#b8d67a'],
    track: 'Exploration',
  },
  {
    id: 'noir',
    name: 'Neon Noir',
    tagline: 'Rain-slick cyberpunk night',
    prompt: 'cyberpunk night, rain-soaked facade, neon signage, magenta and cyan rim light, wet reflections, keep original architectural geometry',
    swatch: ['#0a0718', '#7b2cff', '#2ef2ff'],
    track: 'Exploration',
  },
]
