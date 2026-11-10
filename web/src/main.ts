import './style.css'
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'

// Stage 0 smoke test: codec support + offline MediaPipe load. Replaced by the real app in Stage 1.
const out = document.querySelector<HTMLPreElement>('#out')!
const log = (s: string) => (out.textContent += '\n' + s)

const codecs = ['vp09.00.10.08', 'av01.0.04M.08', 'avc1.42001F']
for (const codec of codecs) {
  for (const bitrateMode of ['quantizer', 'constant'] as const) {
    const config: VideoEncoderConfig = {
      codec, width: 1280, height: 720, framerate: 30, latencyMode: 'realtime', bitrateMode,
      ...(bitrateMode === 'constant' && { bitrate: 500_000 }),
    }
    const { supported } = await VideoEncoder.isConfigSupported(config).catch(() => ({ supported: false }))
    log(`${supported ? 'OK  ' : codec.startsWith('vp09') ? 'FAIL' : 'WARN'} ${codec} ${bitrateMode}`) // VP9 is required; others optional
  }
}

try {
  const t0 = performance.now()
  const vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm')
  await FaceLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: '/mediapipe/models/face_landmarker.task', delegate: 'GPU' },
    runningMode: 'VIDEO', numFaces: 1, outputFacialTransformationMatrixes: true,
  })
  log(`OK   FaceLandmarker loaded from local files in ${Math.round(performance.now() - t0)} ms`)
} catch (e) {
  log(`FAIL FaceLandmarker: ${e}`)
}
log('done')
