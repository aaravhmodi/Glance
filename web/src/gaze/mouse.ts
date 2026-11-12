import type { GazeSample, GazeSource } from './types.ts'

/** Mouse as a gaze source. Coordinates are mapped into the given view size. */
export class MouseSource implements GazeSource {
  readonly name = 'mouse' as const
  private s: GazeSample
  constructor(el: HTMLElement, w: number, h: number, sigma = 10) {
    this.s = { x: w / 2, y: h / 2, sigma, timestamp: performance.now(), confidence: 1 }
    el.addEventListener('mousemove', (e) => {
      const r = el.getBoundingClientRect()
      this.s = {
        x: ((e.clientX - r.left) / r.width) * w,
        y: ((e.clientY - r.top) / r.height) * h,
        sigma,
        timestamp: performance.now(),
        confidence: 1,
      }
    })
  }
  read() { return this.s }
}
