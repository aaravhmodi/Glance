import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fitCalibration, predict, gridPoints, aggregate, median, choleskySolve } from '../src/gaze/regression.ts'

let seed = 7
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5)

// Realistic setup: the eye features are a smooth function of where the user looks (a known gaze model),
// calibrated on the 9-point grid, evaluated on random held-out screen positions inside the grid's range.
const toFeat = (x: number, y: number) => {
  const a = (x - 640) / 1000, b = (y - 360) / 800
  return [0.3 * a + 0.03 * a * a, 0.25 * b, 0.1 * a, 0.08 * b]
}
const g9 = gridPoints(1280, 720)

test('cholesky solves a small SPD system', () => {
  const x = choleskySolve([[4, 1], [1, 3]], [[1, 2]])!
  assert.ok(Math.abs(4 * x[0][0] + x[0][1] - 1) < 1e-9 && Math.abs(x[0][0] + 3 * x[0][1] - 2) < 1e-9)
})

test('ridge fit on the 9-point grid generalises to held-out screen positions', () => {
  const m = fitCalibration(g9.map((p) => toFeat(p.x, p.y)), g9)!
  assert.ok(m)
  let se = 0
  const N = 300
  for (let i = 0; i < N; i++) {
    const x = 128 + (rnd() + 0.5) * 1024, y = 72 + (rnd() + 0.5) * 576
    const p = predict(m, toFeat(x, y))
    se += Math.hypot(p.x - x, p.y - y) ** 2
  }
  const rms = Math.sqrt(se / N)
  assert.ok(rms < 60, `held-out rms ${rms}px (lambda ${m.lambda})`)
  assert.ok(Number.isFinite(m.sigma) && m.sigma >= 0)
})

test('calibration tolerates feature noise and keeps a sensible sigma', () => {
  const m = fitCalibration(g9.map((p) => toFeat(p.x, p.y).map((v) => v + rnd() * 0.01)), g9)!
  const p = predict(m, toFeat(640, 360))
  assert.ok(Math.hypot(p.x - 640, p.y - 360) < 150, `centre ${p.x},${p.y}`)
  assert.ok(m.sigma > 0 && m.sigma < 400, `sigma ${m.sigma}`)
})

test('zero-variance feature does not break the fit', () => {
  const F = g9.map((p) => { const f = toFeat(p.x, p.y); f[3] = 0.1; return f })
  const m = fitCalibration(F, g9)!
  assert.ok(m && Number.isFinite(predict(m, F[0]).x))
})

test('too few points -> null; grid has 9 points inside the view; aggregate is a median', () => {
  assert.equal(fitCalibration([[0, 0, 0, 0]], [{ x: 0, y: 0 }]), null)
  assert.equal(g9.length, 9)
  assert.ok(g9.every((p) => p.x > 0 && p.x < 1280 && p.y > 0 && p.y < 720))
  assert.equal(median([1, 100, 2]), 2)
  assert.deepEqual(aggregate([[1, 10], [2, 20], [99, 30]]), [2, 20])
})
