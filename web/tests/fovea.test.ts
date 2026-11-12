import test from 'node:test'
import assert from 'node:assert/strict'
import { foveaRadiusPx, quality, blurLevel, MAX_LOD } from '../src/video/fovea.ts'

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
