import test from 'node:test'
import assert from 'node:assert/strict'
import { psnr, ssim, maskCount, lumaFromRGBA, measure, Rolling, PSNR_CAP } from '../src/metrics/quality.ts'

const W = 64, H = 48
function texture(): Float32Array {
  const a = new Float32Array(W * H)
  let s = 12345
  for (let i = 0; i < a.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; a[i] = 40 + (s % 160) }
  return a
}

test('identical images: PSNR capped, SSIM 1', () => {
  const a = texture()
  assert.equal(psnr(a, a, W, H), PSNR_CAP)
  assert.ok(Math.abs(ssim(a, a, W, H) - 1) < 1e-9)
})

test('constant offset of 5 gives 20*log10(255/5) dB', () => {
  const a = texture(), b = a.map((v) => v + 5)
  assert.ok(Math.abs(psnr(a, b, W, H) - 20 * Math.log10(255 / 5)) < 0.01)
})

test('mask area is about pi r^2 and the circle only counts its own pixels', () => {
  const c = { cx: 32, cy: 24, r: 15 }
  assert.ok(Math.abs(maskCount(W, H, c) - Math.PI * 225) / (Math.PI * 225) < 0.03)
  const a = texture(), b = a.slice()
  for (let y = 0; y < H; y++) for (let x = 0; x < 16; x++) b[y * W + x] += 50 // damage far left only (the circle spans x 17..47)
  assert.equal(psnr(a, b, W, H, c), PSNR_CAP)
  assert.ok(psnr(a, b, W, H) < 40)
  assert.ok(Math.abs(ssim(a, b, W, H, { cx: 48, cy: 24, r: 8 }) - 1) < 1e-9)
})

test('blurring lowers SSIM and PSNR; more blur lowers more', () => {
  const a = texture()
  const blur = (k: number) => {
    const o = new Float32Array(a.length)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = 0, n = 0
      for (let dy = -k; dy <= k; dy++) for (let dx = -k; dx <= k; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H) { s += a[yy * W + xx]; n++ } }
      o[y * W + x] = s / n
    }
    return o
  }
  const b1 = blur(1), b3 = blur(3)
  assert.ok(ssim(a, b1, W, H) > ssim(a, b3, W, H))
  assert.ok(ssim(a, b3, W, H) < 0.5)
  assert.ok(psnr(a, b1, W, H) > psnr(a, b3, W, H))
})

test('measure: fovea intact, periphery damaged -> foveal PSNR >> full PSNR', () => {
  const c = { cx: 32, cy: 24, r: 10 }
  const a = texture(), b = a.slice()
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (Math.hypot(x - 32, y - 24) > 14) b[y * W + x] = 100
  const m = measure(a, b, W, H, c)
  assert.ok(m.fovPsnr - m.fullPsnr > 20)
  assert.ok(m.fovSsim > 0.99 && m.fullSsim < 0.6)
})

test('luma of white/black/red RGBA and empty mask', () => {
  const l = lumaFromRGBA(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255]), 3, 1)
  assert.ok(Math.abs(l[0] - 255) < 0.01 && l[1] === 0 && Math.abs(l[2] - 76.245) < 0.01)
  assert.ok(Number.isNaN(psnr(l, l, 3, 1, { cx: 100, cy: 100, r: 1 })))
})

test('rolling mean keeps the last N finite values', () => {
  const r = new Rolling(3)
  for (const x of [1, 2, 3, 4, NaN]) r.add(x)
  assert.equal(r.n, 3)
  assert.equal(r.mean(), 3)
  assert.equal(r.min(), 2)
})
