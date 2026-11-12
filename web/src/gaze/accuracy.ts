/** Pure accuracy maths for the validation screen (no DOM, unit-tested). */
export type Verdict = 'GO' | 'GO-with-big-fovea' | 'PIVOT'

export interface Geometry { screenWidthCm: number; viewWidthPx: number; distanceCm: number }

/** Defaults: 14" 16:9 laptop panel is ~31 cm wide; 60 cm viewing distance. Override with ?screencm= and ?dist=. */
export const DEFAULT_SCREEN_CM = 31
export const DEFAULT_DISTANCE_CM = 60

/** Pixel error -> degrees of visual angle: deg = atan(err_cm / distance_cm). */
export function pxToDeg(errPx: number, g: Geometry): number {
  const pxPerCm = g.viewWidthPx / g.screenWidthCm
  return (Math.atan(errPx / pxPerCm / g.distanceCm) * 180) / Math.PI
}

/** Inverse: radius in px for an angle (for sizing the fovea). */
export function degToPx(deg: number, g: Geometry): number {
  return Math.tan((deg * Math.PI) / 180) * g.distanceCm * (g.viewWidthPx / g.screenWidthCm)
}

/** BUILD_PLAN Stage 1 gate: <=2.5 deg GO; 2.5-4 GO with big fovea (r ~9-10 deg); >4 PIVOT. */
export function verdictFor(meanDeg: number): Verdict {
  if (!Number.isFinite(meanDeg)) return 'PIVOT'
  if (meanDeg <= 2.5) return 'GO'
  if (meanDeg <= 4) return 'GO-with-big-fovea'
  return 'PIVOT'
}

export interface Report { n: number; meanDeg: number; medianDeg: number; p95Deg: number; maxDeg: number; meanPx: number; verdict: Verdict }

function quantile(sorted: number[], q: number): number {
  const i = (sorted.length - 1) * q
  const lo = Math.floor(i), hi = Math.ceil(i)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo)
}

/** Per-dot pixel errors -> report. Returns null when there are no usable dots. */
export function summarize(errPx: number[], g: Geometry): Report | null {
  const e = errPx.filter(Number.isFinite)
  if (!e.length) return null
  const deg = e.map((p) => pxToDeg(p, g)).sort((a, b) => a - b)
  const meanDeg = deg.reduce((s, v) => s + v, 0) / deg.length
  return {
    n: deg.length, meanDeg, medianDeg: quantile(deg, 0.5), p95Deg: quantile(deg, 0.95), maxDeg: deg[deg.length - 1],
    meanPx: e.reduce((s, v) => s + v, 0) / e.length, verdict: verdictFor(meanDeg),
  }
}

/** Deterministic pseudo-random validation dots inside a margin (same seed = same dots; the validation screen seeds from the clock so each run differs). */
export function randomDots(n: number, w: number, h: number, margin = 0.08, seed = 1): { x: number; y: number }[] {
  let s = seed >>> 0 || 1
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296)
  const out = []
  for (let i = 0; i < n; i++) out.push({ x: w * (margin + (1 - 2 * margin) * rnd()), y: h * (margin + (1 - 2 * margin) * rnd()) })
  return out
}

export function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b)
  return quantile(s, 0.5)
}
