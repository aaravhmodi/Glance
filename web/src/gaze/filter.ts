/**
 * One-Euro filter (Casiez, Roussel, Vogel, CHI 2012) for 2D gaze in screen px, plus a saccade snap:
 * a large, fast, *confirmed* jump bypasses the filter so the fovea does not trail behind the eyes.
 */
export interface GazeFilterOptions {
  /** Cutoff at rest, Hz. Lower = steadier fixations, more lag. */
  minCutoff: number
  /** Speed coefficient, Hz per (px/s). Higher = less lag while moving. */
  beta: number
  /** Cutoff of the speed estimate, Hz. */
  dCutoff: number
  /** A jump bigger than this from the filtered output (px) is a snap candidate. */
  snapDist: number
  /** ...and its speed must exceed this (px/s). */
  snapSpeed: number
  /** Gaps longer than this (ms) restart the filter (blink, lost face). */
  maxGapMs: number
}

// Webcam gaze is noisy (hundreds of px), so the snap distance is far above noise; beta is in px units.
export const DEFAULT_FILTER: GazeFilterOptions = {
  minCutoff: 0.8, beta: 0.004, dCutoff: 1.0, snapDist: 250, snapSpeed: 1200, maxGapMs: 500,
}

const alpha = (fc: number, dt: number) => 1 / (1 + 1 / (2 * Math.PI * fc) / dt)

export class GazeFilter {
  private o: GazeFilterOptions
  private x = 0
  private y = 0
  private dx = 0
  private dy = 0
  private t = -Infinity
  private init = false
  /** Pending snap candidate (first sample of a possible saccade). */
  private cand: { x: number; y: number } | null = null
  /** True if the last call snapped. */
  snapped = false

  constructor(opts: Partial<GazeFilterOptions> = {}) { this.o = { ...DEFAULT_FILTER, ...opts } }

  reset() { this.init = false; this.cand = null; this.snapped = false }

  /** Filter one sample (t in ms). Returns the smoothed point. */
  update(x: number, y: number, t: number): { x: number; y: number } {
    this.snapped = false
    if (!this.init || t - this.t > this.o.maxGapMs) return this.start(x, y, t)
    const dt = (t - this.t) / 1000
    if (!(dt > 0)) return { x: this.x, y: this.y } // duplicate / out-of-order timestamp
    const jump = Math.hypot(x - this.x, y - this.y)
    if (jump > this.o.snapDist && jump / dt > this.o.snapSpeed) {
      // Confirm with a second sample near the first one, so a one-frame outlier does not teleport the fovea.
      if (this.cand && Math.hypot(x - this.cand.x, y - this.cand.y) < this.o.snapDist) {
        this.snapped = true
        return this.start(x, y, t)
      }
      this.cand = { x, y }
      return { x: this.x, y: this.y } // hold until the next sample confirms (or refutes) the jump
    } else {
      this.cand = null
    }
    const ad = alpha(this.o.dCutoff, dt)
    const rx = (x - this.x) / dt, ry = (y - this.y) / dt
    this.dx += ad * (rx - this.dx)
    this.dy += ad * (ry - this.dy)
    const fc = this.o.minCutoff + this.o.beta * Math.hypot(this.dx, this.dy)
    const a = alpha(fc, dt)
    this.x += a * (x - this.x)
    this.y += a * (y - this.y)
    this.t = t
    return { x: this.x, y: this.y }
  }

  private start(x: number, y: number, t: number) {
    this.x = x; this.y = y; this.dx = 0; this.dy = 0; this.t = t; this.init = true; this.cand = null
    return { x, y }
  }
}
