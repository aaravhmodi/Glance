import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GazeFilter } from '../src/gaze/filter.ts'

let seed = 3
const noise = (s: number) => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2 * s
const dtMs = 33

test('first sample passes through; duplicate timestamps do not break it', () => {
  const f = new GazeFilter()
  assert.deepEqual(f.update(100, 200, 0), { x: 100, y: 200 })
  assert.deepEqual(f.update(900, 900, 0), { x: 100, y: 200 })
})

test('fixation: noise is reduced substantially', () => {
  const f = new GazeFilter()
  let raw = 0, out = 0, n = 0
  for (let i = 0; i < 300; i++) {
    const nx = noise(40), ny = noise(40)
    const p = f.update(600 + nx, 300 + ny, i * dtMs)
    if (i > 30) { raw += nx * nx + ny * ny; out += (p.x - 600) ** 2 + (p.y - 300) ** 2; n++ }
  }
  assert.ok(Math.sqrt(out / n) < 0.5 * Math.sqrt(raw / n), `rms out ${Math.sqrt(out / n)} vs raw ${Math.sqrt(raw / n)}`)
})

test('saccade: confirmed large fast jump snaps; a single-frame outlier does not', () => {
  const f = new GazeFilter()
  for (let i = 0; i < 40; i++) f.update(200, 300, i * dtMs)
  const o = f.update(1000, 300, 40 * dtMs)
  assert.ok(o.x < 400 && !f.snapped)
  f.update(200, 300, 41 * dtMs)
  f.update(1000, 300, 42 * dtMs)
  const p = f.update(1005, 302, 43 * dtMs)
  assert.ok(f.snapped && p.x === 1005 && p.y === 302)
})

test('slow drift is smoothed, never snapped', () => {
  const f = new GazeFilter()
  f.update(200, 300, 0)
  let p = { x: 0, y: 0 }
  for (let i = 1; i <= 60; i++) { p = f.update(200 + i * 10, 300, i * dtMs); assert.ok(!f.snapped) }
  assert.ok(p.x < 800 && p.x > 400)
})

test('gap longer than maxGapMs restarts the filter', () => {
  const f = new GazeFilter()
  for (let i = 0; i < 20; i++) f.update(100, 100, i * dtMs)
  assert.deepEqual(f.update(900, 600, 20 * dtMs + 2000), { x: 900, y: 600 })
})
