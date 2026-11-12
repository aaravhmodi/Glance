// Video sources: clips from /clips/clips.json (keys 1-3), the live webcam (next key), and a synthetic canvas
// that is only used by tests (?synthetic) or when no clips are served.
import { fitRect, sourceForKey, type SourceInfo } from './layout'
export const W = 1280
export const H = 720

export interface Source {
  canvas: HTMLCanvasElement | HTMLVideoElement
  kind: 'clip' | 'webcam' | 'synthetic'
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

interface ClipEntry { id: string; file: string; title?: string }

/** Owns the selectable sources. `frame` is a W x H canvas that always holds the current source, letterboxed. */
export class SourceManager {
  readonly frame = document.createElement('canvas')
  readonly options: SourceInfo[] = []
  current: SourceInfo | null = null
  onChange: (s: SourceInfo) => void = () => {}
  /** Supplies the webcam <video> (shared with the eye tracker, so the camera is opened once). */
  webcam: () => HTMLVideoElement | null = () => null
  private g = this.frame.getContext('2d')!
  private video = document.createElement('video')
  private synth: Source | null = null
  private clips: ClipEntry[] = []
  private own: MediaStream | null = null

  private forceSynthetic: boolean
  constructor(forceSynthetic = false) {
    this.forceSynthetic = forceSynthetic
    this.frame.width = W
    this.frame.height = H
    this.video.loop = true
    this.video.muted = true
    this.video.playsInline = true
  }

  get kind(): Source['kind'] { return this.current?.kind ?? 'synthetic' }

  async init(): Promise<void> {
    if (!this.forceSynthetic) {
      try {
        const list = await (await fetch('/clips/clips.json')).json()
        if (Array.isArray(list)) this.clips = list.filter((c) => c && typeof c.file === 'string' && typeof c.id === 'string')
      } catch { /* no clips served: synthetic fallback below */ }
    }
    for (const c of this.clips) this.options.push({ id: c.id, label: c.title ?? c.id, kind: 'clip' })
    if (this.clips.length === 0) this.options.push({ id: 'synthetic', label: 'Synthetic test pattern', kind: 'synthetic' })
    if (!this.forceSynthetic) this.options.push({ id: 'webcam', label: 'Live webcam', kind: 'webcam' })
    await this.select(this.options[0].id)
  }

  /** Key '1'..'9' picks clips first, then the webcam. Returns true when the key picked a source. */
  async key(k: string): Promise<boolean> {
    const o = sourceForKey(k, this.options)
    if (!o) return false
    await this.select(o.id)
    return true
  }

  async select(id: string): Promise<void> {
    const o = this.options.find((x) => x.id === id)
    if (!o || o === this.current) return
    const my = ++this.token
    this.current = o
    const v = this.video
    if (o.kind === 'clip') {
      this.stopOwn()
      v.srcObject = null
      v.onerror = () => console.warn('clip failed to load', id)
      v.src = '/clips/' + encodeURIComponent(this.clips.find((c) => c.id === id)!.file)
      await v.play().catch(() => {})
    } else if (o.kind === 'webcam') {
      v.removeAttribute('src')
      await this.ensureOwn(my)
    } else { this.stopOwn(); this.synth ??= synthetic() }
    if (my === this.token) this.onChange(o)
  }
  private token = 0
  private opening = false
  /** Opens our own camera only when the tracker's is unavailable; a stale call (token changed) closes what it opened. */
  private async ensureOwn(my: number): Promise<void> {
    if (this.webcam() || this.own || this.opening) return
    this.opening = true
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, facingMode: 'user' }, audio: false })
      if (my !== this.token || this.current?.kind !== 'webcam') { s.getTracks().forEach((t) => t.stop()); return }
      this.own = s
      this.video.srcObject = s
      await this.video.play().catch(() => {})
    } catch { /* camera missing/denied: the frame stays black */ } finally { this.opening = false }
  }
  private stopOwn() { this.own?.getTracks().forEach((t) => t.stop()); this.own = null }

  /** Draw the current source into `frame`. Call once per animation frame. */
  tick(t: number): void {
    const g = this.g
    const o = this.current
    if (!o) return
    if (o.kind === 'synthetic') {
      this.synth!.tick(t)
      g.drawImage(this.synth!.canvas, 0, 0, W, H)
      return
    }
    if (o.kind === 'webcam' && !this.webcam() && !this.own && !this.opening) void this.ensureOwn(this.token) // tracker stopped: reopen
    if (o.kind === 'webcam' && this.webcam() && this.own) { this.stopOwn(); this.video.srcObject = null } // tracker's camera took over
    const v = o.kind === 'webcam' ? (this.webcam() ?? this.video) : this.video
    g.fillStyle = '#000'
    g.fillRect(0, 0, W, H)
    if (v.readyState < 2 || !v.videoWidth) return // videoWidth is 0 before the first frame
    const r = fitRect(v.videoWidth, v.videoHeight, W, H)
    if (o.kind === 'webcam') { // mirrored, like a self-view
      g.save(); g.translate(W, 0); g.scale(-1, 1); g.drawImage(v, W - r.x - r.w, r.y, r.w, r.h); g.restore()
    } else g.drawImage(v, r.x, r.y, r.w, r.h)
  }
}
