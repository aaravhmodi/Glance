import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GazeRecorder, MAX_SAMPLES } from '../src/gaze/recorder.ts'

test('records normalised samples relative to start', () => {
  const r = new GazeRecorder(1280, 720)
  r.add(50, 1, 1, 1, 'mouse') // before start: ignored
  r.start(1000, 'call-desk')
  r.add(1000, 640, 360, 20, 'eyes')
  r.add(1500, 1280, 0, 30, 'eyes')
  const t = r.stop()
  assert.equal(t.samples.length, 2)
  assert.deepEqual(t.samples[0], { t: 0, x: 0.5, y: 0.5, sigma: 20 })
  assert.ok(Math.abs(t.samples[1].t - 0.5) < 1e-9 && t.samples[1].x === 1 && t.samples[1].y === 0)
  assert.equal(t.clip, 'call-desk')
  assert.equal(t.source, 'eyes')
  assert.equal(t.synthetic, false)
  assert.equal(r.recording, false)
})

test('clamps off-screen, skips NaN, restart clears', () => {
  const r = new GazeRecorder(100, 100)
  r.start(0, 'a')
  r.add(1, -50, 500, 5, 'mouse')
  r.add(2, NaN, 1, 5, 'mouse')
  const t = r.stop()
  assert.equal(t.samples.length, 1)
  assert.equal(t.samples[0].x, 0)
  assert.equal(t.samples[0].y, 1)
  r.start(10, 'b')
  assert.equal(r.count, 0)
})

test('caps at MAX_SAMPLES and JSON round-trips', () => {
  const r = new GazeRecorder(10, 10)
  r.start(0, 'c')
  for (let i = 0; i < MAX_SAMPLES + 5; i++) r.add(i, 5, 5, 1, 'mouse')
  assert.equal(r.count, MAX_SAMPLES)
  const t = r.stop()
  assert.deepEqual(JSON.parse(JSON.stringify(t)), t)
})
