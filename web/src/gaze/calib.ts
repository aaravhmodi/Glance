import { featureVector } from './features'
import { aggregate, fitCalibration, gridPoints, predict, type Model, type Pt2 } from './regression'
import type { EyeTracker } from './tracker'

/** Per dot: wait for the eye to land (drop first 300 ms), then sample ~1 s. 9 dots x 1.3 s ~ 12 s. */
export const DROP_MS = 300
export const SAMPLE_MS = 1000
export const MIN_SAMPLES = 8
const RETRY_EXTRA_MS = 500 // extra patience on a retry of a dot
/** Hard cap: after this, remaining dots are skipped and we fit on what we have (needs >= 5 dots). Happy path is ~12 s. */
export const MAX_TOTAL_MS = 30_000

export interface CalibResult { model: Model; points: number }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * 9-point calibration over the 1280x720 view. Shows an overlay with one dot at a time, collects feature
 * vectors from the tracker, fits the model and installs `tracker.mapper`. Resolves null if cancelled/failed.
 */
export async function runCalibration(tracker: EyeTracker, view: HTMLCanvasElement, signal?: AbortSignal, minSamples = MIN_SAMPLES): Promise<CalibResult | null> {
  const W = view.width, H = view.height
  const ov = document.createElement('canvas')
  ov.width = W
  ov.height = H
  const r = view.getBoundingClientRect()
  ov.style.cssText = `position:absolute;left:${r.left + scrollX}px;top:${r.top + scrollY}px;width:${r.width}px;height:${r.height}px;background:#000;z-index:10`
  ov.id = 'calib'
  document.body.append(ov)
  const g = ov.getContext('2d')!
  const draw = (x: number, y: number, k: number, msg: string) => {
    g.fillStyle = '#000'
    g.fillRect(0, 0, W, H)
    g.fillStyle = '#ccc'
    g.font = '22px monospace'
    g.textAlign = 'center'
    g.fillText(msg, W / 2, H / 2 - 60)
    g.fillStyle = '#fff'
    g.beginPath()
    g.arc(x, y, 14 - 6 * k, 0, 7)
    g.fill()
    g.fillStyle = '#f33'
    g.beginPath()
    g.arc(x, y, 3, 0, 7)
    g.fill()
  }
  const rows: number[][] = []
  const targets = gridPoints(W, H)
  const pts: Pt2[] = []
  const start = performance.now()
  try {
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i]
      let samples: number[][] = []
      for (let attempt = 0; attempt < 2 && samples.length < minSamples && performance.now() - start < MAX_TOTAL_MS; attempt++) {
        samples = []
        const t0 = performance.now()
        let lastAt = 0
        while (performance.now() - t0 < DROP_MS + SAMPLE_MS + (attempt ? RETRY_EXTRA_MS : 0)) {
          if (signal?.aborted) return null
          const el = performance.now() - t0
          draw(t.x, t.y, Math.min(1, el / (DROP_MS + SAMPLE_MS)), `Look at the dot (${i + 1}/${targets.length}). Keep your head still. Esc cancels`)
          if (el > DROP_MS && tracker.latest && tracker.latestAt !== lastAt) {
            lastAt = tracker.latestAt
            samples.push(featureVector(tracker.latest))
          }
          await new Promise(requestAnimationFrame)
        }
        if (samples.length < minSamples) {
          draw(t.x, t.y, 0, 'No face seen - face the camera')
          await sleep(500)
        }
      }
      if (samples.length < minSamples) continue
      rows.push(aggregate(samples))
      pts.push(t)
    }
  } finally {
    ov.remove()
  }
  const model = fitCalibration(rows, pts)
  if (!model) return null
  tracker.mapper = (f) => {
    const p = predict(model, featureVector(f))
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null
    return { x: Math.max(0, Math.min(W, p.x)), y: Math.max(0, Math.min(H, p.y)), sigma: model.sigma }
  }
  return { model, points: rows.length }
}
