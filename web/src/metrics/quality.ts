// Pure image-quality metrics on luma (no DOM; unit-tested in tests/quality.test.ts).
// PSNR and SSIM can be restricted to a circular region (the "fovea") or cover the whole frame.

export const PSNR_CAP = 100 // returned when the two images are identical in the region

/** BT.601 luma (0..255) from RGBA bytes. */
export function lumaFromRGBA(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h)
  for (let i = 0, o = 0; i < out.length; i++, o += 4) out[i] = 0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2]
  return out
}

export interface Circle { cx: number; cy: number; r: number }

const inside = (c: Circle | null, x: number, y: number) => !c || (x + 0.5 - c.cx) ** 2 + (y + 0.5 - c.cy) ** 2 <= c.r * c.r

/** Number of pixels of a w x h frame inside the circle (the whole frame when circle is null). */
export function maskCount(w: number, h: number, c: Circle | null): number {
  let n = 0
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inside(c, x, y)) n++
  return n
}

/** PSNR (dB) of luma `b` against reference `a` over the circle (or full frame). NaN if the region is empty. */
export function psnr(a: Float32Array, b: Float32Array, w: number, h: number, c: Circle | null = null): number {
  let se = 0, n = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inside(c, x, y)) continue
      const d = a[y * w + x] - b[y * w + x]
      se += d * d
      n++
    }
  }
  if (n === 0) return NaN
  const mse = se / n
  return mse <= 1e-10 ? PSNR_CAP : Math.min(PSNR_CAP, 10 * Math.log10((255 * 255) / mse))
}

const C1 = (0.01 * 255) ** 2
const C2 = (0.03 * 255) ** 2

/**
 * Mean SSIM (uniform 8x8 windows, stride 4, Wang et al. 2004 constants K1=0.01, K2=0.03) over windows whose centre lies in the circle.
 * NaN if no window qualifies.
 */
export function ssim(a: Float32Array, b: Float32Array, w: number, h: number, c: Circle | null = null): number {
  const N = 8, S = 4
  let sum = 0, cnt = 0
  for (let y0 = 0; y0 + N <= h; y0 += S) {
    for (let x0 = 0; x0 + N <= w; x0 += S) {
      if (!inside(c, x0 + N / 2 - 0.5, y0 + N / 2 - 0.5)) continue
      let ma = 0, mb = 0
      for (let y = y0; y < y0 + N; y++) for (let x = x0; x < x0 + N; x++) { ma += a[y * w + x]; mb += b[y * w + x] }
      ma /= N * N
      mb /= N * N
      let va = 0, vb = 0, cov = 0
      for (let y = y0; y < y0 + N; y++) {
        for (let x = x0; x < x0 + N; x++) {
          const da = a[y * w + x] - ma, db = b[y * w + x] - mb
          va += da * da; vb += db * db; cov += da * db
        }
      }
      const k = N * N - 1
      va /= k; vb /= k; cov /= k
      sum += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2))
      cnt++
    }
  }
  return cnt ? sum / cnt : NaN
}

export interface QualitySample { fovPsnr: number; fovSsim: number; fullPsnr: number; fullSsim: number }

export function measure(ref: Float32Array, test: Float32Array, w: number, h: number, c: Circle): QualitySample {
  return { fovPsnr: psnr(ref, test, w, h, c), fovSsim: ssim(ref, test, w, h, c), fullPsnr: psnr(ref, test, w, h), fullSsim: ssim(ref, test, w, h) }
}

/** Rolling mean of the last `cap` finite samples. */
export class Rolling {
  private v: number[] = []
  private cap: number
  constructor(cap = 20) { this.cap = cap }
  add(x: number): void { if (Number.isFinite(x)) { this.v.push(x); if (this.v.length > this.cap) this.v.shift() } }
  get n(): number { return this.v.length }
  mean(): number { return this.v.length ? this.v.reduce((s, x) => s + x, 0) / this.v.length : NaN }
  min(): number { return this.v.length ? Math.min(...this.v) : NaN }
}
