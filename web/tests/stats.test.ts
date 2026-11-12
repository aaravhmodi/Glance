import test from 'node:test'
import assert from 'node:assert/strict'
import { ByteStats, percentSaved } from '../src/metrics/stats.ts'

test('per-second kbps uses the last complete second', () => {
  const s = new ByteStats()
  s.add(10.1, 1000)
  s.add(10.9, 1000)
  s.add(11.2, 500)
  assert.equal(s.lastSecondKbps(11.5), 16) // 2000 B in second 10 = 16 kbps
  assert.equal(s.lastSecondKbps(10.5), 0)
  assert.equal(s.total, 2500)
})

test('average kbps over the span, floor of 1 s', () => {
  const s = new ByteStats()
  s.add(0, 12500)
  assert.equal(s.averageKbps(), 100) // 100 kbit over the 1 s floor
  s.add(4, 12500)
  assert.equal(s.averageKbps(), 50) // 200 kbit / 4 s
})

test('percentSaved', () => {
  assert.equal(percentSaved(1000, 400), 60)
  assert.equal(percentSaved(1000, 1500), -50)
  assert.equal(percentSaved(0, 10), 0)
})

test('ignores bad input', () => {
  const s = new ByteStats()
  s.add(NaN, 5)
  s.add(1, -3)
  assert.equal(s.chunks, 0)
  assert.equal(s.averageKbps(), 0)
})
