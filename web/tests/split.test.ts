import test from 'node:test'
import assert from 'node:assert/strict'
import { splitPanels, panelLabel, savedLabel } from '../src/ui/split.ts'

test('panels fit, do not overlap, are 16:9 and vertically centred', () => {
  const { left, right } = splitPanels(1280, 720)
  assert.ok(left.x + left.w <= right.x)
  assert.ok(right.x + right.w <= 1280)
  assert.ok(Math.abs(left.w / left.h - 16 / 9) < 0.01)
  assert.equal(left.y, right.y)
  assert.ok(left.y > 0 && left.y + left.h < 720)
})
test('labels', () => {
  assert.equal(panelLabel('Normal', 1234.4, 250000), 'Normal: 1234 kbps (250 kB total)')
  assert.equal(savedLabel(52.4), '52% bandwidth saved vs normal')
  assert.match(savedLabel(-5), /MORE/)
})
