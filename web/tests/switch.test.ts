import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GazeSwitch, FACE_LOST_MS } from '../src/gaze/switch.ts'
import type { GazeSample, GazeSource } from '../src/gaze/types.ts'

type Fake = GazeSource & { s: GazeSample | null }
const mk = (name: 'mouse' | 'eyes', s: GazeSample | null): Fake => ({
  name,
  s,
  read() { return this.s },
})
const smp = (x: number, t: number, c = 1): GazeSample => ({ x, y: 5, sigma: 10, timestamp: t, confidence: c })

test('defaults to mouse; M toggles to eyes', () => {
  const sw = new GazeSwitch(mk('mouse', smp(1, 0)), mk('eyes', smp(2, 0)))
  assert.equal(sw.read(0).source, 'mouse')
  sw.toggle()
  const r = sw.read(0)
  assert.equal(r.source, 'eyes')
  assert.equal(r.sample!.x, 2)
  sw.toggle()
  assert.equal(sw.read(0).source, 'mouse')
})

test('falls back to mouse after FACE_LOST_MS without a face, recovers when it returns', () => {
  const eyes = mk('eyes', smp(2, 0))
  const sw = new GazeSwitch(mk('mouse', smp(1, 0)), eyes)
  sw.toggle()
  assert.equal(sw.read(0).source, 'eyes')
  eyes.s = smp(2, 0, 0) // face lost
  assert.equal(sw.read(FACE_LOST_MS - 50).source, 'eyes') // grace: holds last good
  const f = sw.read(FACE_LOST_MS + 50)
  assert.equal(f.source, 'mouse')
  assert.equal(f.fallback, true)
  eyes.s = smp(3, 900)
  const r = sw.read(900)
  assert.equal(r.source, 'eyes')
  assert.equal(r.sample!.x, 3)
})

test('stale eye sample and missing tracker fall back; mouse mode is never a fallback', () => {
  const sw = new GazeSwitch(mk('mouse', smp(1, 0)), null)
  sw.toggle()
  assert.equal(sw.read(10).source, 'mouse')
  assert.equal(sw.read(10).fallback, true)
  sw.setEyes(mk('eyes', smp(2, 0)))
  assert.equal(sw.read(5000).source, 'mouse') // sample too old
  sw.toggle()
  assert.equal(sw.read(5000).fallback, false)
})
