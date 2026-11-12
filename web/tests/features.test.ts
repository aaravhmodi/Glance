import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractFeatures, headPose, EYES, type Pt } from '../src/gaze/features.ts'

/** Synthetic face: eyes 0.1 wide at y=0.5; iris offset (du, dv) in eye widths. */
function face(du: number, dv: number): Pt[] {
  const lm: Pt[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }))
  const w = 0.1
  // Subject's right eye is image-left: outer corner further left than inner.
  lm[EYES.right.outer] = { x: 0.3, y: 0.5 }
  lm[EYES.right.inner] = { x: 0.3 + w, y: 0.5 }
  lm[EYES.left.inner] = { x: 0.6, y: 0.5 }
  lm[EYES.left.outer] = { x: 0.6 + w, y: 0.5 }
  // du > 0 = iris toward the inner corner in each eye.
  lm[EYES.right.iris] = { x: 0.35 + du * w, y: 0.5 + dv * w }
  lm[EYES.left.iris] = { x: 0.65 - du * w, y: 0.5 + dv * w }
  return lm
}

test('centred iris -> zero offset; offsets are in eye widths and mirror per eye', () => {
  const c = extractFeatures(face(0, 0), null, 1)!
  assert.ok(Math.abs(c.rx) < 1e-9 && Math.abs(c.ry) < 1e-9 && Math.abs(c.lx) < 1e-9)
  const f = extractFeatures(face(0.2, 0.1), null, 1)!
  assert.ok(Math.abs(f.rx - 0.2) < 1e-9 && Math.abs(f.lx - 0.2) < 1e-9)
  assert.ok(Math.abs(f.ry - 0.1) < 1e-9 && Math.abs(f.ly - 0.1) < 1e-9)
})

test('aspect ratio keeps offsets in the same units', () => {
  const f = extractFeatures(face(0.2, 0), null, 16 / 9)!
  assert.ok(Math.abs(f.rx - 0.2) < 1e-9)
})

test('head pose: identity -> zeros; rotation about Y gives yaw (scale-invariant)', () => {
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -50, 1]
  const p = headPose(I)
  assert.ok(Math.abs(p.yaw) < 1e-9 && Math.abs(p.pitch) < 1e-9 && Math.abs(p.roll) < 1e-9)
  const a = 0.3, s = 2
  const Ry = [Math.cos(a) * s, 0, -Math.sin(a) * s, 0, 0, s, 0, 0, Math.sin(a) * s, 0, Math.cos(a) * s, 0, 0, 0, 0, 1]
  const q = headPose(Ry)
  assert.ok(Math.abs(Math.abs(q.yaw) - a) < 1e-9 && Math.abs(q.pitch) < 1e-9)
})

test('unusable input -> null', () => {
  assert.equal(extractFeatures([], null, 1), null)
  const bad = face(0, 0)
  bad[EYES.right.inner] = bad[EYES.right.outer]
  assert.equal(extractFeatures(bad, null, 1), null)
  const nan = face(0, 0)
  nan[EYES.left.iris] = { x: NaN, y: 0 }
  assert.equal(extractFeatures(nan, null, 1), null)
})
