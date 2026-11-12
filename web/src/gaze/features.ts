/** Landmark indices in the 478-point MediaPipe Face Landmarker model (subject's right/left eye). */
export const EYES = {
  right: { iris: 468, outer: 33, inner: 133 },
  left: { iris: 473, outer: 263, inner: 362 },
} as const

export interface Pt { x: number; y: number }

export interface GazeFeatures {
  /** Iris offset along the eye axis (corner to corner, + toward the inner corner) and perpendicular (+ down), in eye widths. Right eye then left eye. */
  rx: number; ry: number; lx: number; ly: number
  /** Eyelid opening (upper to lower lid, in eye widths), mean of both eyes: the strongest cue for looking up/down. */
  lid: number
  /** Head pose in radians (from the facial transformation matrix). */
  yaw: number; pitch: number; roll: number
  /** Distance between the outer eye corners as a fraction of image width (face scale). */
  scale: number
}

/** Regression inputs: mean iris offset (2) + head yaw/pitch (2) + eyelid opening (1). */
export function featureVector(f: GazeFeatures): number[] {
  return [(f.rx + f.lx) / 2, (f.ry + f.ly) / 2, f.yaw, f.pitch, f.lid]
}

function eyeOffset(lm: Pt[], e: { iris: number; outer: number; inner: number }, aspect: number) {
  // Work in pixel-like units (x scaled by aspect = width/height) so angles are not distorted.
  const o = { x: lm[e.outer].x * aspect, y: lm[e.outer].y }
  const i = { x: lm[e.inner].x * aspect, y: lm[e.inner].y }
  const c = { x: lm[e.iris].x * aspect, y: lm[e.iris].y }
  const ax = i.x - o.x, ay = i.y - o.y
  const w = Math.hypot(ax, ay)
  if (w < 1e-6) return null
  const ux = ax / w, uy = ay / w // outer -> inner
  const dx = c.x - (o.x + i.x) / 2, dy = c.y - (o.y + i.y) / 2
  const sg = ux >= 0 ? 1 : -1 // perpendicular always points image-down, for both eyes
  return { u: (dx * ux + dy * uy) / w, v: (sg * (-dx * uy + dy * ux)) / w }
}

/** Upper-lid to lower-lid distance divided by the eye's width. */
function lidGap(lm: Pt[], up: number, low: number, e: { outer: number; inner: number }, aspect: number) {
  const w = Math.hypot((lm[e.inner].x - lm[e.outer].x) * aspect, lm[e.inner].y - lm[e.outer].y)
  return Math.hypot((lm[up].x - lm[low].x) * aspect, lm[up].y - lm[low].y) / (w || 1)
}

/** Euler angles (radians) from MediaPipe's column-major 4x4 facial transformation matrix `data`. */
export function headPose(m: ArrayLike<number>): { yaw: number; pitch: number; roll: number } {
  const s = Math.hypot(m[0], m[1], m[2]) || 1
  const R = (r: number, c: number) => m[c * 4 + r] / s
  return {
    yaw: Math.atan2(-R(2, 0), R(2, 2)),
    pitch: Math.asin(Math.max(-1, Math.min(1, R(2, 1)))),
    roll: Math.atan2(-R(0, 1), R(1, 1)),
  }
}

/** Per-frame features, or null when the landmarks are unusable. `aspect` = video width / height. */
export function extractFeatures(lm: Pt[], matrix: ArrayLike<number> | null, aspect: number): GazeFeatures | null {
  if (lm.length < 478) return null
  const r = eyeOffset(lm, EYES.right, aspect)
  const l = eyeOffset(lm, EYES.left, aspect)
  if (!r || !l) return null
  const pose = matrix && matrix.length >= 16 ? headPose(matrix) : { yaw: 0, pitch: 0, roll: 0 }
  const a = lm[EYES.right.outer], b = lm[EYES.left.outer]
  const f: GazeFeatures = {
    rx: r.u, ry: r.v, lx: l.u, ly: l.v, ...pose,
    lid: (lidGap(lm, 159, 145, EYES.right, aspect) + lidGap(lm, 386, 374, EYES.left, aspect)) / 2,
    scale: Math.hypot(a.x - b.x, (a.y - b.y) / aspect),
  }
  return Object.values(f).every(Number.isFinite) ? f : null
}
