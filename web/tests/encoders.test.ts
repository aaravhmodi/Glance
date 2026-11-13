import test from 'node:test'
import assert from 'node:assert/strict'
import { encoderConfigFor, BAD_NETWORK_KBPS, CODEC } from '../src/video/rate.ts'

test('quantizer config has no bitrate', () => {
  const c = encoderConfigFor(1280, 720, 30, { kind: 'qp', qp: 32 })
  assert.equal(c.bitrateMode, 'quantizer')
  assert.equal(c.bitrate, undefined)
  assert.equal(c.codec, CODEC)
})

test('bad-network config is constant bitrate at the cap, in bit/s', () => {
  const c = encoderConfigFor(1280, 720, 30, { kind: 'cbr', kbps: BAD_NETWORK_KBPS })
  assert.equal(c.bitrateMode, 'constant')
  assert.equal(c.bitrate, 500_000)
  assert.equal(c.latencyMode, 'realtime')
  assert.equal(c.framerate, 30)
})

test('same inputs give identical configs (fair baseline)', () => {
  const m = { kind: 'cbr', kbps: 500 } as const
  assert.deepEqual(encoderConfigFor(1280, 720, 30, m), encoderConfigFor(1280, 720, 30, m))
})
