import test from 'node:test'
import assert from 'node:assert/strict'
import { fitRect, sourceForKey, type SourceInfo } from '../src/video/layout.ts'

test('fitRect letterboxes a 4:3 source into 16:9', () => {
  const r = fitRect(640, 480, 1280, 720)
  assert.equal(r.h, 720)
  assert.equal(r.w, 960)
  assert.equal(r.x, 160)
  assert.equal(r.y, 0)
})
test('fitRect pillarboxes wide into tall and keeps same aspect exact', () => {
  assert.deepEqual(fitRect(1280, 720, 1280, 720), { x: 0, y: 0, w: 1280, h: 720 })
  const r = fitRect(1000, 100, 500, 500)
  assert.deepEqual(r, { x: 0, y: 225, w: 500, h: 50 })
})
test('fitRect with unknown size (videoWidth 0) fills the target', () => {
  assert.deepEqual(fitRect(0, 0, 1280, 720), { x: 0, y: 0, w: 1280, h: 720 })
})
test('sourceForKey maps 1..9 to options in order and ignores other keys', () => {
  const o: SourceInfo[] = [
    { id: 'a', label: 'A', kind: 'clip' }, { id: 'b', label: 'B', kind: 'clip' },
    { id: 'c', label: 'C', kind: 'clip' }, { id: 'webcam', label: 'W', kind: 'webcam' },
  ]
  assert.equal(sourceForKey('1', o)?.id, 'a')
  assert.equal(sourceForKey('4', o)?.id, 'webcam')
  assert.equal(sourceForKey('5', o), undefined)
  assert.equal(sourceForKey('0', o), undefined)
  assert.equal(sourceForKey('m', o), undefined)
  assert.equal(sourceForKey('12', o), undefined)
})
