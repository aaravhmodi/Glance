// Video source: a clip from /clips/clip.mp4 if one is served, else a synthetic 1280x720 animated canvas.
export const W = 1280
export const H = 720

export interface Source {
  canvas: HTMLCanvasElement | HTMLVideoElement
  kind: 'clip' | 'synthetic'
  /** Advance/draw the frame for time t (ms). */
  tick(t: number): void
}

function synthetic(): Source {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const g = canvas.getContext('2d')!
  const tick = (t: number) => {
    const s = t / 1000
    g.fillStyle = '#20303c'
    g.fillRect(0, 0, W, H)
    // fine checker texture, scrolling
    const off = (s * 40) % 16
    g.fillStyle = '#2c4252'
    for (let y = 0; y < H; y += 16)
      for (let x = -16; x < W; x += 16)
        if (((x / 16 + y / 16) & 1) === 0) g.fillRect(x + off, y, 16, 16)
    // fine line grid
    g.strokeStyle = 'rgba(255,255,255,.25)'
    g.lineWidth = 1
    for (let x = 0; x < W; x += 6) {
      g.beginPath(); g.moveTo(x + 0.5, 520); g.lineTo(x + 0.5, H); g.stroke()
    }
    // moving text
    g.fillStyle = '#f2f2f2'
    g.font = '16px monospace'
    const span = W + 600
    for (let i = 0; i < 12; i++) {
      const x = (((i * 137 - s * 90) % span) + span) % span - 400
      g.fillText('The quick brown fox jumps over the lazy dog 0123456789', x, 40 + i * 20)
    }
    // face-like shape, drifting
    const fx = W / 2 + Math.sin(s * 0.7) * 220
    const fy = 340 + Math.cos(s * 0.9) * 70
    g.fillStyle = '#e8b890'
    g.beginPath(); g.ellipse(fx, fy, 110, 140, 0, 0, Math.PI * 2); g.fill()
    g.fillStyle = '#fff'
    for (const dx of [-42, 42]) { g.beginPath(); g.ellipse(fx + dx, fy - 30, 20, 12, 0, 0, Math.PI * 2); g.fill() }
    g.fillStyle = '#222'
    const look = Math.sin(s * 2) * 6
    for (const dx of [-42, 42]) { g.beginPath(); g.arc(fx + dx + look, fy - 30, 7, 0, Math.PI * 2); g.fill() }
    g.strokeStyle = '#a33'; g.lineWidth = 4
    g.beginPath(); g.arc(fx, fy + 30, 50, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke()
    // colored noise dots
    for (let i = 0; i < 400; i++) {
      const a = i * 12.9898
      const x = (Math.sin(a) * 43758.5453 % 1 + 1) % 1
      const y = (Math.sin(a * 1.7) * 24634.6345 % 1 + 1) % 1
      g.fillStyle = `hsl(${(i * 37 + s * 60) % 360} 70% 60%)`
      g.fillRect(x * W, 560 + y * 140 + Math.sin(s * 3 + i) * 4, 3, 3)
    }
  }
  tick(0)
  return { canvas, kind: 'synthetic', tick }
}

async function clip(): Promise<Source | null> {
  try {
    const r = await fetch('/clips/clip.mp4', { method: 'HEAD' })
    if (!r.ok || !(r.headers.get('content-type') ?? '').startsWith('video/')) return null
  } catch { return null }
  const v = document.createElement('video')
  v.src = '/clips/clip.mp4'
  v.loop = true
  v.muted = true
  await v.play().catch(() => {})
  return { canvas: v, kind: 'clip', tick: () => {} }
}

export async function createSource(): Promise<Source> {
  return (await clip()) ?? synthetic()
}
