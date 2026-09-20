/** Shared constraints for editable building appearance prompts. */
export const MAX_PROMPT_LENGTH = 2000
export const CREATIVE_IDEAS = [
  { label: 'Living facade', prompt: 'Cover the facade in ivy and moss with lush rooftop gardens.' },
  { label: 'Neon future', prompt: 'Add cyan and magenta neon lighting with a rain-slick cyberpunk finish.' },
  { label: 'Warm terracotta', prompt: 'Use terracotta walls, copper accents and warm amber lighting.' },
]

export function promptError(prompt: string): string | null {
  if (!prompt.trim()) return 'Describe how you want the building to look.'
  if ([...prompt].length > MAX_PROMPT_LENGTH) return `Keep your creative prompt within ${MAX_PROMPT_LENGTH} characters.`
  return null
}

/** Limited keyword interpretation for the explicitly labelled offline preview, not an AI model.
 * Last matching keyword wins so an appended idea overrides the preset's original direction.
 */
export function previewAppearance(prompt: string, fallback: string) {
  let style = fallback
  for (const match of prompt.toLowerCase().matchAll(/\b(scorched|ruin|soot|rusted|dust|campus|solar|glazing|sustainable|ivy|moss|overgrown|gardens|neon|cyberpunk|noir)\b/g)) {
    const word = match[0]
    style = /^(scorched|ruin|soot|rusted|dust)$/.test(word) ? 'scorched'
      : /^(campus|solar|glazing|sustainable)$/.test(word) ? 'campus'
      : /^(ivy|moss|overgrown|gardens)$/.test(word) ? 'overgrown' : 'noir'
  }
  const colors: Record<string, [number, number, number]> = {
    red: [200, 65, 55], blue: [65, 120, 205], green: [70, 150, 80],
    cyan: [50, 200, 210], magenta: [200, 60, 170], white: [235, 230, 220],
    terracotta: [195, 100, 65], copper: [185, 115, 75], amber: [215, 150, 55],
  }
  let tint: [number, number, number] | null = null
  for (const match of prompt.toLowerCase().matchAll(/\b(red|blue|green|cyan|magenta|white|terracotta|copper|amber)\b/g)) tint = colors[match[0]]
  return { style, tint }
}
