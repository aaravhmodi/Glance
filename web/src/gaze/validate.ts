import { DEFAULT_DISTANCE_CM, DEFAULT_SCREEN_CM, median, randomDots, summarize, type Geometry, type Report } from './accuracy'
import type { EyeTracker } from './tracker'

/** 20 dots, 1.5 s each; the first 500 ms are dropped (eye still travelling), the median of the rest is the estimate. */
export const DOTS = 20
export const DOT_MS = 1500
export const DROP_MS = 500

export interface ValidationResult { report: Report; geometry: Geometry; errorsPx: number[] }

/** Geometry from URL params: ?dist=<cm viewing distance> &screencm=<physical width of the 1280x720 view in cm>. */
export function geometryFromUrl(viewWidthPx: number, search = location.search): Geometry {
  const q = new URLSearchParams(search)
  const num = (k: string, d: number) => { const v = Number(q.get(k)); return v > 0 && Number.isFinite(v) ? v : d }
  return { screenWidthCm: num('screencm', DEFAULT_SCREEN_CM), viewWidthPx, distanceCm: num('dist', DEFAULT_DISTANCE_CM) }
}

/**
 * 20-dot validation over the view: shows each dot, compares the tracker's (filtered, calibrated) gaze with
 * the dot, then shows mean/median/95th/max error in degrees and the go/no-go verdict. Resolves null if
 * cancelled or too few dots got a gaze estimate (needs 75% of them; `minDots` lowers this for the slow test camera).
 */
export async function runValidation(tracker: EyeTracker, view: HTMLCanvasElement, geometry: Geometry, signal?: AbortSignal, opts: { minSamples?: number; minDots?: number; autoClose?: boolean } = {}): Promise<ValidationResult | null> {
  const { minSamples = 5, minDots = Math.ceil(DOTS * 0.75), autoClose = false } = opts
  const W = view.width, H = view.height
  const ov = document.createElement('canvas')
  ov.width = W
  ov.height = H
  const r = view.getBoundingClientRect()
  ov.style.cssText = `position:absolute;left:${r.left + scrollX}px;top:${r.top + scrollY}px;width:${r.width}px;height:${r.height}px;background:#000;z-index:10`
  ov.id = 'validate'
  document.body.append(ov)
  const g = ov.getContext('2d')!
  const text = (lines: string[], y0: number, color = '#ccc') => {
    g.fillStyle = color
    g.font = '22px monospace'
    g.textAlign = 'center'
    lines.forEach((l, i) => g.fillText(l, W / 2, y0 + i * 30))
  }
  const dots = randomDots(DOTS, W, H, 0.08, (Date.now() & 0xffff) | 1)
  const errs: number[] = []
  try {
    for (let i = 0; i < dots.length; i++) {
      const d = dots[i]
      const xs: number[] = [], ys: number[] = []
      let lastT = 0
      const t0 = performance.now()
      while (performance.now() - t0 < DOT_MS) {
        if (signal?.aborted) return null
        const el = performance.now() - t0
        g.fillStyle = '#000'
        g.fillRect(0, 0, W, H)
        text([`Validation ${i + 1}/${dots.length}: look at the dot. Esc cancels`], 40)
        g.fillStyle = '#fff'
        g.beginPath()
        g.arc(d.x, d.y, 12, 0, 7)
        g.fill()
        g.fillStyle = '#f33'
        g.beginPath()
        g.arc(d.x, d.y, 3, 0, 7)
        g.fill()
        const s = tracker.read()
        if (el > DROP_MS && s && s.confidence > 0 && s.timestamp !== lastT) {
          lastT = s.timestamp
          xs.push(s.x)
          ys.push(s.y)
        }
        await new Promise(requestAnimationFrame)
      }
      if (xs.length >= minSamples) errs.push(Math.hypot(median(xs) - d.x, median(ys) - d.y))
    }
    if (errs.length < minDots) return null
    const report = summarize(errs, geometry)
    if (!report) return null
    g.fillStyle = '#000'
    g.fillRect(0, 0, W, H)
    const colour = report.verdict === 'GO' ? '#4f4' : report.verdict === 'PIVOT' ? '#f55' : '#fd4'
    text([report.verdict], 200, colour)
    text([
      `mean ${report.meanDeg.toFixed(2)} deg (${Math.round(report.meanPx)} px)   median ${report.medianDeg.toFixed(2)} deg`,
      `95th ${report.p95Deg.toFixed(2)} deg   max ${report.maxDeg.toFixed(2)} deg   dots ${report.n}/${DOTS}`,
      `assumed: ${geometry.distanceCm} cm distance, view ${geometry.screenWidthCm} cm wide (?dist= ?screencm= to change)`,
      'GO <= 2.5 deg | GO-with-big-fovea 2.5-4 deg (r ~9-10 deg) | PIVOT > 4 deg',
      'Press any key to close',
    ], 260)
    await new Promise<void>((res) => {
      const done = () => { removeEventListener('keydown', done); res() }
      setTimeout(() => addEventListener('keydown', done), 300)
      signal?.addEventListener('abort', done)
      if (autoClose) setTimeout(done, 1500) // test hook: no human to press a key
    })
    return { report, geometry, errorsPx: errs }
  } finally {
    ov.remove()
  }
}
