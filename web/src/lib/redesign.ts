// Image-to-image conceptual redesign — LOCAL SIMULATION ONLY.
// With VITE_API_BASE set, the real redesign runs as a server job (lib/pipelineJob.ts) and this
// module is not called. Without it, a deterministic canvas colour/material restyle stands in so the
// whole pipeline can be demoed offline. It is labelled as a simulation wherever it reaches a screen.
import type { StylePreset } from './presets'

/** Timed steps for the simulation's progress walk. Never shown over a real server job. */
export const REDESIGN_STEPS = [
  'Encoding source geometry (depth + edge control)',
  'Conditioning on aesthetic prompt',
  'Diffusing materials & surfaces',
  'Refining detail · upscaling',
]

/** The free-text prompt only matters to a real model; the simulation keys off the preset. */
export async function simulateRedesign(
  source: string,
  preset: StylePreset,
  strength: number,
  onStep: (i: number) => void,
): Promise<string> {
  for (let i = 0; i < REDESIGN_STEPS.length; i++) {
    onStep(i)
    await new Promise((r) => setTimeout(r, 650 + Math.random() * 450))
  }
  return localRestyle(source, preset.id, strength)
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((res, rej) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => res(img)
    img.onerror = rej
    img.src = src
  })
}

// deterministic noise
function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
}

async function localRestyle(src: string, style: string, strength: number): Promise<string> {
  const img = await loadImage(src)
  const W = Math.min(1280, img.naturalWidth)
  const H = Math.round((W / img.naturalWidth) * img.naturalHeight)
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  const ctx = c.getContext('2d')!
  ctx.drawImage(img, 0, 0, W, H)
  const data = ctx.getImageData(0, 0, W, H)
  const d = data.data
  const rand = rng(7)
  const k = strength

  const grade: Record<string, (r: number, g: number, b: number, y: number, x: number) => [number, number, number]> = {
    scorched: (r, g, b, y) => {
      const l = 0.3 * r + 0.59 * g + 0.11 * b
      const c2 = Math.pow(l / 255, 1.15) * 255
      const t = y / H
      return [c2 * 1.18 + 18 + t * 10, c2 * 0.86 + 6, c2 * 0.58 - 4]
    },
    campus: (r, g, b) => {
      const l = 0.3 * r + 0.59 * g + 0.11 * b
      return [r * 0.9 + l * 0.1 + 6, g * 0.98 + 10, b * 1.05 + 16]
    },
    overgrown: (r, g, b, y) => {
      const l = 0.3 * r + 0.59 * g + 0.11 * b
      const t = y / H
      return [l * 0.78, l * 0.95 + 18 * t, l * 0.7]
    },
    noir: (r, g, b, _y, x) => {
      const l = 0.3 * r + 0.59 * g + 0.11 * b
      const t = x / W
      const dark = Math.pow(l / 255, 1.6) * 255
      return [dark * (0.7 + 0.6 * (1 - t)) + 10, dark * 0.55, dark * (0.8 + 0.7 * t) + 24]
    },
  }
  const fn = grade[style] ?? grade.scorched
  for (let i = 0; i < d.length; i += 4) {
    const p = i / 4
    const x = p % W, y = (p / W) | 0
    const [r, g, b] = fn(d[i], d[i + 1], d[i + 2], y, x)
    const n = (rand() - 0.5) * (style === 'scorched' ? 26 : 10) * k
    d[i] = d[i] * (1 - k) + (r + n) * k
    d[i + 1] = d[i + 1] * (1 - k) + (g + n) * k
    d[i + 2] = d[i + 2] * (1 - k) + (b + n) * k
  }
  ctx.putImageData(data, 0, 0)

  // Surface overlays
  const r2 = rng(42)
  ctx.save()
  ctx.globalAlpha = k
  if (style === 'scorched') {
    ctx.globalCompositeOperation = 'multiply'
    for (let i = 0; i < 70; i++) {
      const x = r2() * W, len = H * (0.1 + r2() * 0.45), w = 2 + r2() * 14
      const g = ctx.createLinearGradient(x, 0, x, len)
      g.addColorStop(0, 'rgba(30,14,6,0.85)'); g.addColorStop(1, 'rgba(30,14,6,0)')
      ctx.fillStyle = g
      ctx.fillRect(x, r2() * H * 0.4, w, len)
    }
    ctx.globalCompositeOperation = 'screen'
    const dust = ctx.createLinearGradient(0, H, 0, H * 0.4)
    dust.addColorStop(0, 'rgba(230,140,60,0.55)'); dust.addColorStop(1, 'rgba(230,140,60,0)')
    ctx.fillStyle = dust; ctx.fillRect(0, 0, W, H)
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = `rgba(255,${120 + r2() * 80},40,${0.25 + r2() * 0.4})`
      ctx.beginPath(); ctx.arc(r2() * W, H * (0.55 + r2() * 0.45), 1 + r2() * 2.5, 0, 7); ctx.fill()
    }
  } else if (style === 'campus') {
    ctx.globalCompositeOperation = 'screen'
    const sheen = ctx.createLinearGradient(0, 0, W, H)
    sheen.addColorStop(0, 'rgba(255,255,255,0)'); sheen.addColorStop(0.45, 'rgba(180,230,255,0.22)'); sheen.addColorStop(0.55, 'rgba(255,255,255,0)')
    ctx.fillStyle = sheen; ctx.fillRect(0, 0, W, H)
    ctx.globalCompositeOperation = 'source-over'
    const roof = ctx.createLinearGradient(0, 0, 0, H * 0.12)
    roof.addColorStop(0, 'rgba(56,120,70,0.55)'); roof.addColorStop(1, 'rgba(56,120,70,0)')
    ctx.fillStyle = roof; ctx.fillRect(0, 0, W, H * 0.12)
    ctx.fillStyle = 'rgba(134,31,65,0.85)'; ctx.fillRect(0, H * 0.965, W, H * 0.035)
    ctx.fillStyle = 'rgba(229,117,31,0.9)'; ctx.fillRect(0, H * 0.955, W, H * 0.01)
  } else if (style === 'overgrown') {
    ctx.globalCompositeOperation = 'source-over'
    for (let i = 0; i < 46; i++) {
      let x = r2() * W, y = r2() < 0.5 ? 0 : H
      const up = y === H
      ctx.strokeStyle = `rgba(${40 + r2() * 30},${90 + r2() * 60},${30 + r2() * 20},0.75)`
      ctx.lineWidth = 2 + r2() * 5
      ctx.beginPath(); ctx.moveTo(x, y)
      const steps = 12 + r2() * 20
      for (let s = 0; s < steps; s++) {
        x += (r2() - 0.5) * 22; y += (up ? -1 : 1) * (8 + r2() * 14)
        ctx.lineTo(x, y)
        if (r2() < 0.35) { ctx.fillStyle = ctx.strokeStyle; ctx.beginPath(); ctx.ellipse(x, y, 5 + r2() * 7, 3 + r2() * 4, r2() * 3, 0, 7); ctx.fill(); ctx.beginPath(); ctx.moveTo(x, y) }
      }
      ctx.stroke()
    }
  } else if (style === 'noir') {
    ctx.globalCompositeOperation = 'screen'
    for (let i = 0; i < 9; i++) {
      const x = r2() * W, y = r2() * H * 0.8, w = 30 + r2() * 120
      ctx.shadowBlur = 24
      const col = r2() < 0.5 ? '255,60,200' : '60,240,255'
      ctx.shadowColor = `rgb(${col})`
      ctx.fillStyle = `rgba(${col},0.8)`
      ctx.fillRect(x, y, w, 4 + r2() * 5)
    }
    ctx.shadowBlur = 0
    ctx.globalCompositeOperation = 'source-over'
    ctx.strokeStyle = 'rgba(200,220,255,0.12)'; ctx.lineWidth = 1
    for (let i = 0; i < 260; i++) {
      const x = r2() * W, y = r2() * H
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 4, y + 18); ctx.stroke()
    }
  }
  ctx.restore()

  // Vignette
  const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75)
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, `rgba(0,0,0,${0.55 * k})`)
  ctx.fillStyle = v; ctx.fillRect(0, 0, W, H)
  return c.toDataURL('image/jpeg', 0.9)
}

/** Procedural sample facade so the demo works without a photo on hand. */
export function samplePhoto(): string {
  const W = 1200, H = 800
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  const ctx = c.getContext('2d')!
  const sky = ctx.createLinearGradient(0, 0, 0, H * 0.6)
  sky.addColorStop(0, '#6f9fd1'); sky.addColorStop(1, '#cfe0ef')
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H)
  // ground
  ctx.fillStyle = '#7d8a5a'; ctx.fillRect(0, H * 0.82, W, H * 0.18)
  ctx.fillStyle = '#a9a39a'; ctx.fillRect(0, H * 0.86, W, H * 0.05)
  // building: Hokie stone
  const bx = 120, by = 170, bw = 960, bh = H * 0.82 - 170
  const r = rng(3)
  ctx.fillStyle = '#8f877c'; ctx.fillRect(bx, by, bw, bh)
  for (let y = by; y < by + bh; y += 14) {
    for (let x = bx + ((y / 14) % 2) * 12; x < bx + bw; x += 26 + r() * 10) {
      const t = 110 + r() * 60
      ctx.fillStyle = `rgb(${t + 10},${t + 4},${t - 6})`
      ctx.fillRect(x, y, 22 + r() * 10, 12)
    }
  }
  // cornice + roof
  ctx.fillStyle = '#5b554d'; ctx.fillRect(bx - 16, by - 22, bw + 32, 24)
  ctx.fillStyle = '#48433d'; ctx.fillRect(bx + 60, by - 60, 120, 40); ctx.fillRect(bx + bw - 240, by - 48, 90, 28)
  // windows
  const cols = 12, rows = 4
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const wx = bx + 40 + col * ((bw - 80) / cols), wy = by + 34 + row * ((bh - 150) / rows)
      const ww = (bw - 80) / cols - 22, wh = (bh - 150) / rows - 30
      ctx.fillStyle = '#3c3a36'; ctx.fillRect(wx - 4, wy - 4, ww + 8, wh + 8)
      const g = ctx.createLinearGradient(wx, wy, wx + ww, wy + wh)
      g.addColorStop(0, '#9fc3dc'); g.addColorStop(1, '#2d4a60')
      ctx.fillStyle = g; ctx.fillRect(wx, wy, ww, wh)
      ctx.fillStyle = '#e7e2d6'; ctx.fillRect(wx + ww / 2 - 1, wy, 2, wh); ctx.fillRect(wx, wy + wh / 2 - 1, ww, 2)
    }
  }
  // entrance
  ctx.fillStyle = '#d9d2c3'; ctx.fillRect(W / 2 - 110, H * 0.82 - 130, 220, 130)
  ctx.fillStyle = '#26323b'; ctx.fillRect(W / 2 - 80, H * 0.82 - 104, 160, 104)
  ctx.fillStyle = '#5b554d'; ctx.fillRect(W / 2 - 130, H * 0.82 - 146, 260, 18)
  // trees
  for (const tx of [60, 1140, 300, 900]) {
    ctx.fillStyle = '#4a3a28'; ctx.fillRect(tx - 6, H * 0.7, 12, H * 0.13)
    ctx.fillStyle = '#3d6b35'
    ctx.beginPath(); ctx.arc(tx, H * 0.66, 58, 0, 7); ctx.fill()
    ctx.fillStyle = '#4f8243'
    ctx.beginPath(); ctx.arc(tx - 18, H * 0.63, 36, 0, 7); ctx.fill()
  }
  return c.toDataURL('image/jpeg', 0.92)
}
