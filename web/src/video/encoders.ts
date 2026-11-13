// Two VP9 encoders with an identical config: "normal" gets the plain source frame, "glance" gets the foveated frame.
// Same fixed quantizer for both (WebCodecs QP is per frame, not per region), so any size difference comes from the
// foveated pre-filter making the periphery cheap to code. Keyframe every KEYFRAME_SEC seconds. Realtime latency mode.
import { ByteStats } from '../metrics/stats'
import { encoderConfigFor, BAD_NETWORK_KBPS, CODEC, type RateMode } from './rate'
export { encoderConfigFor, BAD_NETWORK_KBPS, CODEC, type RateMode }

export const KEYFRAME_SEC = 2
export const DEFAULT_QP = 32 // VP9 quantizer 0..63 (lower = better); same for both streams
const MAX_QUEUE = 4 // drop a frame pair if either encoder is this far behind, so both always see the same frames

export interface EncodedPart {
  chunk: EncodedVideoChunk
  keyframe: boolean
}

export class StreamEncoder {
  readonly stats = new ByteStats()
  readonly config: VideoEncoderConfig
  private enc: VideoEncoder
  error = ''
  /** Optional tap for the decoder (later tasks): receives every encoded chunk. */
  onChunk: ((c: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata) => void) | null = null

  constructor(width: number, height: number, framerate: number, mode: RateMode) {
    this.config = encoderConfigFor(width, height, framerate, mode)
    this.mode = mode
    this.qp = mode.kind === 'qp' ? mode.qp : -1
    this.enc = new VideoEncoder({
      output: (chunk, meta) => {
        this.stats.add(chunk.timestamp / 1e6, chunk.byteLength)
        this.onChunk?.(chunk, meta)
      },
      error: (e) => { this.error = String(e) },
    })
    this.enc.configure(this.config)
  }
  qp: number // -1 in constant-bitrate mode
  readonly mode: RateMode

  get queue(): number { return this.enc.encodeQueueSize }
  get closed(): boolean { return this.enc.state === 'closed' }

  encode(frame: VideoFrame, keyFrame: boolean): void {
    // vp9.quantizer is in the WebCodecs VP9 registration but missing from TS lib.dom
    const opts = this.mode.kind === 'qp' ? { keyFrame, vp9: { quantizer: this.qp } } : { keyFrame }
    this.enc.encode(frame, opts as VideoEncoderEncodeOptions)
  }

  async flush(): Promise<void> { await this.enc.flush() }
  close(): void { if (this.enc.state !== 'closed') this.enc.close() }
}

export class DualEncoder {
  readonly normal: StreamEncoder
  readonly glance: StreamEncoder
  private lastKeyUs = -Infinity
  dropped = 0
  encoded = 0

  constructor(width: number, height: number, framerate = 30, mode: RateMode = { kind: 'qp', qp: DEFAULT_QP }) {
    this.normal = new StreamEncoder(width, height, framerate, mode)
    this.glance = new StreamEncoder(width, height, framerate, mode)
  }

  /** Encode one frame pair (same timestamp). Takes ownership of both frames (closes them). Returns false if dropped. */
  push(normalFrame: VideoFrame, glanceFrame: VideoFrame): boolean {
    try {
      const behind = Math.max(this.normal.queue, this.glance.queue) >= MAX_QUEUE
      if (behind || this.normal.closed || this.glance.closed || this.normal.error || this.glance.error) { this.dropped++; return false }
      const ts = normalFrame.timestamp
      const key = ts - this.lastKeyUs >= KEYFRAME_SEC * 1e6
      if (key) this.lastKeyUs = ts
      this.normal.encode(normalFrame, key)
      this.glance.encode(glanceFrame, key)
      this.encoded++
      return true
    } finally {
      normalFrame.close()
      glanceFrame.close()
    }
  }

  get error(): string { return this.normal.error || this.glance.error }

  async flush(): Promise<void> { await Promise.all([this.normal.flush(), this.glance.flush()]) }
  close(): void { this.normal.close(); this.glance.close() }
}

export async function vp9QuantizerSupported(width: number, height: number): Promise<boolean> {
  try {
    const r = await VideoEncoder.isConfigSupported({ codec: CODEC, width, height, latencyMode: 'realtime', bitrateMode: 'quantizer' })
    return !!r.supported
  } catch { return false }
}

export async function cbrSupported(width: number, height: number, kbps: number): Promise<boolean> {
  try {
    const r = await VideoEncoder.isConfigSupported(encoderConfigFor(width, height, 30, { kind: 'cbr', kbps }))
    return !!r.supported
  } catch { return false }
}
