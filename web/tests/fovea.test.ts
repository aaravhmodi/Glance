import test from 'node:test'
import assert from 'node:assert/strict'
import { foveaRadiusPx, quality, blurLevel, MAX_LOD, revealRGBA } from '../src/video/fovea.ts'

const g = { screenWidthCm: 31, viewWidthPx: 1280, distanceCm: 60 }

test('5 degrees is about 217 px on a 31 cm laptop view at 60 cm', () => {
  const r = foveaRadiusPx(g)
  assert.ok(r > 200 && r < 240, String(r))
})
test('radius grows with sigma and ignores NaN/negative', () => {
  const r0 = foveaRadiusPx(g)
  assert.ok(foveaRadiusPx(g, 100) > r0 + 50)
  assert.equal(foveaRadiusPx(g, NaN), r0)
  assert.equal(foveaRadiusPx(g, -5), r0)
})
test('quality is 1 inside, monotonic falling to ~0 outside', () => {
  assert.equal(quality(0, 200), 1)
  assert.equal(quality(200, 200), 1)
  let prev = 1
  for (let d = 201; d < 800; d += 20) { const q = quality(d, 200); assert.ok(q <= prev); prev = q }
  assert.ok(quality(700, 200) < 0.01)
})
test('blur level spans 0..MAX_LOD', () => {
  assert.equal(blurLevel(10, 200), 0)
  assert.ok(Math.abs(blurLevel(2000, 200) - MAX_LOD) < 1e-6)
})
test('revealRGBA: red at the gaze point, blue far away, monotone in between', () => {
  const W = 640, H = 360, ow = 64, oh = 36
  const px = revealRGBA(W, H, 320, 180, 100, ow, oh)
  const at = (i: number, j: number) => { const o = (j * ow + i) * 4; return [px[o], px[o + 1], px[o + 2], px[o + 3]] }
  const c = at(32, 18), far = at(0, 0)
  assert.ok(c[0] === 255 && c[2] === 0 && c[3] > 0)
  assert.ok(far[0] < 5 && far[2] > 250)
  let prev = 255
  for (let i = 32; i < ow; i++) { const r = at(i, 18)[0]; assert.ok(r <= prev); prev = r }
})
