import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import { GazeFilter } from './filter'
import { extractFeatures, type GazeFeatures } from './features'
import type { GazeSample, GazeSource } from './types'

import { W, H } from '../video/source'

const BLINK_LID = 0.12 // eyelid opening (in eye widths) below this counts as a blink
export type Mapper = (f: GazeFeatures) => { x: number; y: number; sigma: number } | null

/**
 * Webcam -> Face Landmarker (VIDEO mode, local files) -> per-frame GazeFeatures.
 * Acts as a GazeSource once a mapper (from calibration) is set; until then read() returns null.
 */
export class EyeTracker implements GazeSource {
  readonly name = 'eyes' as const
  video = document.createElement('video')
  latest: GazeFeatures | null = null
  /** Last features seen, kept even if the face is lost afterwards (for diagnostics). */
  lastFeatures: GazeFeatures | null = null
  latestAt = 0
  /** Raw landmarks of the current face (normalised 0..1), for the camera overlay. */
  landmarks: { x: number; y: number }[] | null = null
  frames = 0
  facesSeen = 0
  delegate = ''
  mapper: Mapper | null = null
  /** Drift correction: look at `target` and call recenter() (key X) to cancel a constant offset. */
  offset = { x: 0, y: 0 }
  private raw: { x: number; y: number } | null = null
  recenter(target: { x: number; y: number }) {
    if (this.raw) this.offset = { x: target.x - this.raw.x, y: target.y - this.raw.y }
  }
  readonly filter = new GazeFilter()
  private sample: GazeSample | null = null
  private lm!: FaceLandmarker
  private lastVideoTime = -1
  running = false

  async start(): Promise<void> {
    this.video.muted = true
    this.video.playsInline = true
    this.video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false })
    await this.video.play()
    const vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm')
    const make = (delegate: 'GPU' | 'CPU') => FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: '/mediapipe/models/face_landmarker.task', delegate },
      runningMode: 'VIDEO', numFaces: 1, outputFacialTransformationMatrixes: true,
    })
    try { this.lm = await make('GPU'); this.delegate = 'GPU' } catch { this.lm = await make('CPU'); this.delegate = 'CPU' }
    // Key X: "I'm looking at the centre of the video" -> cancel a constant offset. Key C (recalibrate) clears it.
    addEventListener('keydown', (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key.toLowerCase() === 'x') this.recenter({ x: W / 2, y: H / 2 })
      if (e.key.toLowerCase() === 'c') this.offset = { x: 0, y: 0 }
    })
    this.running = true
    this.loop()
  }

  stop() {
    this.running = false
    ;(this.video.srcObject as MediaStream | null)?.getTracks().forEach((t) => t.stop())
    this.lm?.close()
  }

  read(): GazeSample | null { return this.sample }

  private loop = () => {
    if (!this.running) return
    const v = this.video
    if (v.readyState >= 2 && v.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = v.currentTime
      const now = performance.now()
      let f: GazeFeatures | null = null
      try {
        const res = this.lm.detectForVideo(v, now)
        this.frames++
        this.landmarks = res.faceLandmarks[0] ?? null
        f = res.faceLandmarks[0]
          ? extractFeatures(res.faceLandmarks[0], res.facialTransformationMatrixes?.[0]?.data ?? null, v.videoWidth / v.videoHeight)
          : null
      } catch (e) {
        console.warn('face landmarker frame failed', e) // keep the loop alive; the gaze switch falls back to the mouse
      }
      if (f) {
        this.facesSeen++
        this.latest = f
        this.lastFeatures = f
        this.latestAt = now
        const m = f.lid < BLINK_LID ? null : this.mapper?.(f)
        if (m) { this.raw = { x: m.x, y: m.y }; m.x += this.offset.x; m.y += this.offset.y }
        if (!m && this.mapper && this.sample) return void requestAnimationFrame(this.loop) // blink: hold the last gaze point
        const p = m ? this.filter.update(m.x, m.y, now) : null
        this.sample = m && p ? { x: p.x, y: p.y, sigma: m.sigma, timestamp: now, confidence: 1 } : null
      } else {
        this.latest = null
        this.filter.reset() // face lost: restart rather than smoothing across the gap
        if (this.sample) this.sample = { ...this.sample, confidence: 0 }
      }
    }
    requestAnimationFrame(this.loop)
  }
}
