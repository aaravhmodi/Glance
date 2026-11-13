/** Records the gaze trace shown to the encoder and exports it as JSON, same format as the offline harness (plan.md): t in s, x/y normalised 0..1, sigma in px of the view. */
export interface TracePoint { t: number; x: number; y: number; sigma: number }
export interface GazeTrace {
  format: 'glance-gaze-trace-v1'
  clip: string
  source: 'mouse' | 'eyes'
  /** Real recordings are never synthetic; the offline generator writes true. */
  synthetic: false
  width: number
  height: number
  samples: TracePoint[]
}

export const MAX_SAMPLES = 36000 // 20 min at 30 Hz; recording stops cleanly beyond this

export class GazeRecorder {
  private pts: TracePoint[] = []
  private t0 = 0
  private clipId = ''
  private src: 'mouse' | 'eyes' = 'mouse'
  recording = false
  readonly width: number
  readonly height: number
  constructor(width: number, height: number) {
    this.width = width
    this.height = height
  }

  get count(): number { return this.pts.length }

  start(nowMs: number, clip: string): void {
    this.pts = []
    this.t0 = nowMs
    this.clipId = clip
    this.recording = true
  }

  /** Adds one sample (x,y,sigma in view px, nowMs on the performance.now() clock). Non-finite values are skipped. */
  add(nowMs: number, x: number, y: number, sigma: number, source: 'mouse' | 'eyes'): void {
    if (!this.recording || this.pts.length >= MAX_SAMPLES) return
    if (![nowMs, x, y, sigma].every(Number.isFinite)) return
    this.src = source
    const clamp = (v: number) => Math.min(1, Math.max(0, v))
    this.pts.push({ t: (nowMs - this.t0) / 1000, x: clamp(x / this.width), y: clamp(y / this.height), sigma })
  }

  stop(): GazeTrace {
    this.recording = false
    return { format: 'glance-gaze-trace-v1', clip: this.clipId, source: this.src, synthetic: false, width: this.width, height: this.height, samples: this.pts.slice() }
  }
}

/** Triggers a browser download of the trace (no network). */
export function downloadTrace(trace: GazeTrace, doc: Document = document): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(trace)], { type: 'application/json' }))
  const a = doc.createElement('a')
  a.href = url
  a.download = `gaze-${trace.clip || 'clip'}-${trace.samples.length}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
