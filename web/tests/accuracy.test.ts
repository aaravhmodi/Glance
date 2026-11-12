import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pxToDeg, degToPx, verdictFor, summarize, randomDots, median } from '../src/gaze/accuracy.ts'

const g = { screenWidthCm: 32, viewWidthPx: 1280, distanceCm: 60 } // 40 px/cm

test('pxToDeg: 40 px/cm, 60 cm: 40 px = atan(1/60)', () => {
  assert.ok(Math.abs(pxToDeg(40, g) - 0.9546) < 1e-3)
  assert.equal(pxToDeg(0, g), 0)
})
test('degToPx inverts pxToDeg; 5 deg is ~210 px here', () => {
  assert.ok(Math.abs(pxToDeg(degToPx(5, g), g) - 5) < 1e-9)
  assert.ok(Math.abs(degToPx(5, g) - 209.9) < 0.5)
})
test('verdict thresholds', () => {
  assert.equal(verdictFor(2.5), 'GO')
  assert.equal(verdictFor(2.51), 'GO-with-big-fovea')
  assert.equal(verdictFor(4), 'GO-with-big-fovea')
  assert.equal(verdictFor(4.01), 'PIVOT')
  assert.equal(verdictFor(NaN), 'PIVOT')
})
test('summarize: mean/median/p95/max and NaN dropped', () => {
  const r = summarize([0, 40, 80, NaN, 120], g)!
  assert.equal(r.n, 4)
  assert.ok(Math.abs(r.meanPx - 60) < 1e-9)
  assert.ok(r.maxDeg >= r.p95Deg && r.p95Deg >= r.medianDeg)
  assert.ok(Math.abs(r.maxDeg - pxToDeg(120, g)) < 1e-9)
  assert.equal(summarize([], g), null)
  assert.equal(summarize([NaN], g), null)
})
test('randomDots: n dots inside margins, deterministic', () => {
  const a = randomDots(20, 1280, 720, 0.1, 7), b = randomDots(20, 1280, 720, 0.1, 7)
  assert.equal(a.length, 20)
  assert.deepEqual(a, b)
  for (const p of a) assert.ok(p.x >= 128 && p.x <= 1152 && p.y >= 72 && p.y <= 648)
})
test('median', () => { assert.equal(median([3, 1, 2]), 2); assert.equal(median([1, 2, 3, 4]), 2.5) })
