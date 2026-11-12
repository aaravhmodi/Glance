// Decodes the EncodedVideoChunks of one StreamEncoder so the split-screen can show what the receiver would see.
// Holds only the newest decoded frame (older ones are closed immediately so the decoder never stalls).
export class StreamDecoder {
  latest: VideoFrame | null = null
  decoded = 0
  resyncs = 0
  error = ''
  private dec: VideoDecoder
  private needKey = true
  private closedByUs = false

  private config: VideoDecoderConfig

  constructor(config: VideoDecoderConfig) {
    this.config = config
    this.dec = this.make()
  }

  private make(): VideoDecoder {
    const d = new VideoDecoder({
      output: (f) => { this.latest?.close(); this.latest = f; this.decoded++ },
      error: (e) => { this.error = String(e); this.needKey = true },
    })
    d.configure(this.config)
    return d
  }

  /** Feed a chunk in decode order. Waits for a key chunk first; after an error or a backlog, resyncs at the next key chunk. */
  push(chunk: EncodedVideoChunk): void {
    if (this.closedByUs) return
    if (this.dec.state === 'closed') this.dec = this.make()
    if (!this.needKey && this.dec.decodeQueueSize > 8) { this.needKey = true; this.resyncs++ } // too far behind: skip to next keyframe
    if (this.needKey) {
      if (chunk.type !== 'key') return
      this.needKey = false
      this.error = ''
    }
    try { this.dec.decode(chunk) } catch (e) { this.error = String(e); this.needKey = true }
  }

  close(): void {
    this.closedByUs = true
    if (this.dec.state !== 'closed') this.dec.close()
    this.latest?.close()
    this.latest = null
  }
}

export function decoderConfigFor(codec: string, width: number, height: number): VideoDecoderConfig {
  return { codec, codedWidth: width, codedHeight: height, optimizeForLatency: true }
}
