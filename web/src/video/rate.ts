// Rate-control modes shared by both encoders (no imports, so node's test runner can load it).
export const CODEC = 'vp09.00.31.08' // VP9 profile 0, level 3.1, 8-bit: enough for 1280x720@30
export const BAD_NETWORK_KBPS = 500 // "bad network" cap, applied to both streams

/** How both encoders are rate-controlled: fixed quantizer (clean network) or constant bitrate at a cap (bad network). */
export type RateMode = { kind: 'qp'; qp: number } | { kind: 'cbr'; kbps: number }

/** Encoder config for a rate mode. Normal and Glance always get the same config. */
export function encoderConfigFor(width: number, height: number, framerate: number, mode: RateMode): VideoEncoderConfig {
  const base = { codec: CODEC, width, height, framerate, latencyMode: 'realtime' as const }
  return mode.kind === 'qp' ? { ...base, bitrateMode: 'quantizer' } : { ...base, bitrateMode: 'constant', bitrate: Math.round(mode.kbps * 1000) }
}

