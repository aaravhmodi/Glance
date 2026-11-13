// Live quality meter: every Nth frame pair, the untouched source frame is kept (luma) until the decoded normal and Glance frames
// with the same timestamp arrive; each is then compared to the source inside the nominal gaze circle and on the whole frame.
// The circle is the SAME for both streams (nominal fovea radius at the gaze position when the frame was sent).
import { StreamDecoder, decoderConfigFor } from '../video/decoder'
import { lumaFromRGBA, measure, Rolling, type Circle, type QualitySample } from './quality'

export type StreamName = 'normal' | 'glance'

class Series {
  fovPsnr = new Rolling(20)
  fovSsim = new Rolling(20)
  fullPsnr = new Rolling(20)
  fullSsim = new Rolling(20)
  add(s: QualitySample): void { this.fovPsnr.add(s.fovPsnr); this.fovSsim.add(s.fovSsim); this.fullPsnr.add(s.fullPsnr); this.fullSsim.add(s.fullSsim) }
}

interface Pending { luma: Float32Array; circle: Circle; got: number }

export class QualityMeter {
  readonly normal = new Series()
  readonly glance = new Series()
  readonly decoders: Record<StreamName, StreamDecoder>
  samples = 0 // source frames kept so far
  private pending = new Map<number, Pending>()
  private counter = 0
  private canvas: OffscreenCanvas
  private g: OffscreenCanvasRenderingContext2D
  error = ''

  private w: number
  private h: number
  private every: number

  constructor(w: number, h: number, codec: string, every = 6) {
    this.w = w
    this.h = h
    this.every = every
    this.canvas = new OffscreenCanvas(w, h)
    this.g = this.canvas.getContext('2d', { willReadFrequently: true })!
    const mk = (name: StreamName) => {
      const d = new StreamDecoder(decoderConfigFor(codec, w, h))
      d.onFrame = (f) => this.onDecoded(name, f)
      return d
    }
    this.decoders = { normal: mk('normal'), glance: mk('glance') }
  }

  private luma(src: CanvasImageSource): Float32Array {
    this.g.drawImage(src, 0, 0, this.w, this.h)
    return lumaFromRGBA(this.g.getImageData(0, 0, this.w, this.h).data, this.w, this.h)
  }

  /** Call for each frame pair pushed to the encoders (same timestamp as the VideoFrames). Keeps every Nth source frame. */
  offer(tsUs: number, source: CanvasImageSource, circle: Circle): void {
    if (this.counter++ % this.every !== 0) return
    this.pending.set(tsUs, { luma: this.luma(source), circle, got: 0 })
    this.samples++
    while (this.pending.size > 8) this.pending.delete(this.pending.keys().next().value as number) // never grow if a stream stalls
  }

  push(name: StreamName, chunk: EncodedVideoChunk): void { this.decoders[name].push(chunk) }

  private onDecoded(name: StreamName, f: VideoFrame): void {
    const p = this.pending.get(f.timestamp)
    if (!p) return
    try {
      const m = measure(p.luma, this.luma(f), this.w, this.h, p.circle)
      this[name].add(m)
    } catch (e) { this.error = String(e) }
    if (++p.got >= 2) this.pending.delete(f.timestamp)
  }

  close(): void { this.decoders.normal.close(); this.decoders.glance.close(); this.pending.clear() }
}

const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '–')
const f3 = (x: number) => (Number.isFinite(x) ? x.toFixed(3) : '–')

/** One dashboard line: foveal and full-frame PSNR (dB) / SSIM, normal vs Glance, rolling mean of the last 20 samples. */
export function qualityLabel(m: QualityMeter): string {
  const n = m.normal, g = m.glance
  if (n.fovPsnr.n === 0 && g.fovPsnr.n === 0) return 'quality: waiting for samples'
  return `foveal PSNR ${f1(n.fovPsnr.mean())}/${f1(g.fovPsnr.mean())} dB SSIM ${f3(n.fovSsim.mean())}/${f3(g.fovSsim.mean())} · full PSNR ${f1(n.fullPsnr.mean())}/${f1(g.fullPsnr.mean())} dB SSIM ${f3(n.fullSsim.mean())}/${f3(g.fullSsim.mean())} (normal/Glance, n=${Math.min(n.fovPsnr.n, g.fovPsnr.n)})`
}
