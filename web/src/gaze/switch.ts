import type { GazeSample, GazeSource } from './types.ts'

/** No usable eye sample for this long -> fall back to the mouse. */
export const FACE_LOST_MS = 500
/** Confidence at or below this counts as "no face". */
export const MIN_CONFIDENCE = 0.05

export type Mode = 'mouse' | 'eyes'

export interface Reading {
  source: Mode
  fallback: boolean
  sample: GazeSample | null
}

/**
 * Picks between the mouse and the eye tracker.
 * Key M toggles the preferred mode. In 'eyes' mode the last good eye sample is
 * held for up to FACE_LOST_MS after the face disappears, then we fall back to
 * the mouse; we return to the eyes as soon as a usable sample arrives.
 */
export class GazeSwitch {
  preferred: Mode = 'mouse'
  private lastGood: GazeSample | null = null
  private lastGoodAt = -Infinity
  private mouse: GazeSource
  private eyes: GazeSource | null
  constructor(mouse: GazeSource, eyes: GazeSource | null = null) {
    this.mouse = mouse
    this.eyes = eyes
  }

  setEyes(eyes: GazeSource | null) { this.eyes = eyes }
  toggle() { this.preferred = this.preferred === 'mouse' ? 'eyes' : 'mouse' }

  /** `now` is performance.now(). */
  read(now: number): Reading {
    if (this.preferred === 'eyes') {
      const s = this.eyes?.read() ?? null
      if (s && s.confidence > MIN_CONFIDENCE && Number.isFinite(s.x) && Number.isFinite(s.y) && now - s.timestamp <= FACE_LOST_MS) {
        this.lastGood = s
        this.lastGoodAt = now
        return { source: 'eyes', fallback: false, sample: s }
      }
      if (this.lastGood && now - this.lastGoodAt <= FACE_LOST_MS) return { source: 'eyes', fallback: false, sample: this.lastGood }
      return { source: 'mouse', fallback: true, sample: this.mouse.read() }
    }
    return { source: 'mouse', fallback: false, sample: this.mouse.read() }
  }
}
