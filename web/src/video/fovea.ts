// Pure foveation maths (unit-tested; the shader in foveate.ts mirrors `blurLevel`).
import { degToPx, type Geometry } from '../gaze/accuracy.ts'

export const FOVEA_DEG = 5 // default fovea radius, degrees of visual angle
export const SIGMA_GAIN = 2 // radius grows as sqrt(r0^2 + (gain*sigma)^2) when tracking is uncertain
export const FALLOFF = 0.6 // falloff width as a fraction of the radius
export const MAX_LOD = 3.5 // mip level of the periphery: ~11x downscale (3.5 levels) + trilinear blur

/** Fovea radius in px: 5 deg (configurable) at the given geometry, widened by gaze uncertainty sigma (px). */
export function foveaRadiusPx(g: Geometry, sigmaPx = 0, deg = FOVEA_DEG): number {
  const r0 = degToPx(deg, g)
  const s = Number.isFinite(sigmaPx) && sigmaPx > 0 ? sigmaPx * SIGMA_GAIN : 0
  return Math.hypot(r0, s)
}

/** Quality weight: 1 inside the radius, Gaussian falloff outside (0 = peripheral quality). */
export function quality(dist: number, radius: number): number {
  if (dist <= radius) return 1
  const k = (dist - radius) / (radius * FALLOFF)
  return Math.exp(-k * k)
}

/** Mip level to sample at this distance: 0 (full) in the fovea up to MAX_LOD far away. */
export function blurLevel(dist: number, radius: number): number {
  return MAX_LOD * (1 - quality(dist, radius))
}
