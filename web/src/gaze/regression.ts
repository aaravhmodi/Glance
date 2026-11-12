/** Pure maths for gaze calibration: standardised 2nd-order polynomial ridge regression -> screen x,y. */

export interface Model {
  mean: number[]
  sd: number[]
  /** One weight vector per output (x, y) over poly(standardised features). */
  wx: number[]
  wy: number[]
  lambda: number
  /** Leave-one-point-out RMS error in px (honest residual; with few points the training error is meaningless). */
  sigma: number
}

/** A feature that barely changed during calibration (e.g. head pose with a still head) is mostly noise; don't scale it up to unit variance. */
const SD_FLOOR = 0.03

export interface Pt2 { x: number; y: number }

/**
 * Regression terms: 1 + the features (linear). The full 2nd-order set (21 terms for 5 features) was fitted
 * from only 9 dots and amplified landmark noise into a jumpy, misplaced gaze point on a real webcam.
 * shortcut: linear mapping only, add squared iris terms back if calibration grows past ~15 dots.
 */
export function poly(z: number[]): number[] {
  return [1, ...z]
}

/** Solve A w = b for each row b of B via Cholesky; A must be SPD (n x n). Returns null if not. */
export function choleskySolve(A: number[][], B: number[][]): number[][] | null {
  const n = A.length
  const L = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i][j]
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k]
      if (i === j) {
        if (!(s > 1e-12) || !Number.isFinite(s)) return null
        L[i][i] = Math.sqrt(s)
      } else L[i][j] = s / L[j][j]
    }
  }
  return B.map((b) => {
    const y = new Array<number>(n)
    for (let i = 0; i < n; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= L[i][k] * y[k]; y[i] = s / L[i][i] }
    const x = new Array<number>(n)
    for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k]; x[i] = s / L[i][i] }
    return x
  })
}

/** Ridge fit on already-standardised features. The intercept (term 0) is not penalised. */
export function ridgeFit(Z: number[][], T: Pt2[], lambda: number): { wx: number[]; wy: number[] } | null {
  const P = Z.map(poly)
  const n = P[0].length
  for (let tries = 0; tries < 6; tries++, lambda *= 10) {
    const A = Array.from({ length: n }, () => new Array<number>(n).fill(0))
    const bx = new Array<number>(n).fill(0), by = new Array<number>(n).fill(0)
    P.forEach((p, r) => {
      for (let i = 0; i < n; i++) {
        bx[i] += p[i] * T[r].x; by[i] += p[i] * T[r].y
        for (let j = 0; j < n; j++) A[i][j] += p[i] * p[j]
      }
    })
    for (let i = 1; i < n; i++) A[i][i] += lambda
    A[0][0] += 1e-9
    const s = choleskySolve(A, [bx, by])
    if (s && s.every((w) => w.every(Number.isFinite))) return { wx: s[0], wy: s[1] }
  }
  return null
}

const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0)

export function predict(m: Model, f: number[]): Pt2 {
  const p = poly(f.map((v, i) => (v - m.mean[i]) / m.sd[i]))
  return { x: dot(m.wx, p), y: dot(m.wy, p) }
}

export const LAMBDAS = [1e-3, 1e-2, 1e-1, 1, 10]

/**
 * Fit a calibration model: one feature row per calibration point (already aggregated) and its screen target.
 * Standardises features, picks lambda by leave-one-point-out CV, reports the CV RMS as sigma.
 */
export function fitCalibration(F: number[][], T: Pt2[], lambdas: number[] = LAMBDAS): Model | null {
  if (F.length < 5 || F.length !== T.length) return null
  const d = F[0].length
  const mean = Array.from({ length: d }, (_, k) => F.reduce((s, r) => s + r[k], 0) / F.length)
  const sd = Array.from({ length: d }, (_, k) => Math.max(SD_FLOOR, Math.sqrt(F.reduce((s, r) => s + (r[k] - mean[k]) ** 2, 0) / F.length)))
  const Z = F.map((r) => r.map((v, k) => (v - mean[k]) / sd[k]))
  const cv = (lam: number) => {
    let se = 0
    for (let i = 0; i < Z.length; i++) {
      const fit = ridgeFit(Z.filter((_, j) => j !== i), T.filter((_, j) => j !== i), lam)
      if (!fit) return Infinity
      const p = poly(Z[i])
      se += (dot(fit.wx, p) - T[i].x) ** 2 + (dot(fit.wy, p) - T[i].y) ** 2
    }
    return Math.sqrt(se / Z.length)
  }
  let best = { lambda: lambdas[0], err: Infinity }
  for (const lam of lambdas) { const e = cv(lam); if (e < best.err) best = { lambda: lam, err: e } }
  if (!Number.isFinite(best.err)) return null
  const fit = ridgeFit(Z, T, best.lambda)
  return fit ? { mean, sd, ...fit, lambda: best.lambda, sigma: best.err } : null
}

export function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Per-feature median of sample rows (robust to blinks and landmark jitter). */
export function aggregate(rows: number[][]): number[] {
  return rows[0].map((_, k) => median(rows.map((r) => r[k])))
}

/** 3x3 calibration grid at 10/50/90 % of the view. */
export function gridPoints(w: number, h: number, margin = 0.1, cornersFirst = false): Pt2[] {
  const xs = [margin, 0.5, 1 - margin], ys = [margin, 0.5, 1 - margin]
  const pts = ys.flatMap((y) => xs.map((x) => ({ x: x * w, y: y * h })))
  if (!cornersFirst) return pts
  // row-major indices: corners, then the centre, then edge midpoints
  return [0, 2, 6, 8, 4, 1, 3, 5, 7].map((i) => pts[i])
}
