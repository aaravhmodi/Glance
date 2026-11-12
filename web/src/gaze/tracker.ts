import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import { extractFeatures, type GazeFeatures } from './features'
import type { GazeSample, GazeSource } from './types'

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
  private sample: GazeSample | null = null
  private lm!: FaceLandmarker
  private lastVideoTime = -1
  private running = false

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
        const m = this.mapper?.(f)
        this.sample = m ? { x: m.x, y: m.y, sigma: m.sigma, timestamp: now, confidence: 1 } : null
      } else {
        this.latest = null
        if (this.sample) this.sample = { ...this.sample, confidence: 0 }
      }
    }
    requestAnimationFrame(this.loop)
  }
}
