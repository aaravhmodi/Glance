import { createSource, W, H } from './video/source'
import { MouseSource } from './gaze/mouse'
import { GazeSwitch } from './gaze/switch'
import { EyeTracker } from './gaze/tracker'
import { createCamView } from './ui/camview'
import { runCalibration } from './gaze/calib'
import { geometryFromUrl, runValidation, type ValidationResult } from './gaze/validate'

// App shell: video source drawn to a canvas. Gaze comes from GazeSwitch (mouse now, eyes once the tracker lands; key M toggles).
export const gaze = { x: W / 2, y: H / 2, sigma: 10 }
export let gazeSwitch: GazeSwitch

export async function startApp() {
  const root = document.querySelector<HTMLElement>('#app')!
  const view = document.createElement('canvas')
  view.width = W
  view.height = H
  view.id = 'view'
  const status = document.createElement('div')
  status.id = 'status'
  const cam = createCamView()
  cam.canvas.hidden = true
  const g = view.getContext('2d')!

  const src = await createSource()
  gazeSwitch = new GazeSwitch(new MouseSource(view, W, H))
  addEventListener('keydown', (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
    if (e.key.toLowerCase() === 'm' && !calibAbort) { // ignored while calibrating
      gazeSwitch.toggle()
      if (gazeSwitch.preferred === 'eyes') void startTracker()
    }
    if (e.key.toLowerCase() === 'v') { cam.canvas.hidden = !cam.canvas.hidden; void startTracker() } // show what the vision sees
    if (e.key.toLowerCase() === 'c') void calibrate()
    if (e.key.toLowerCase() === 't') void validate()
    if (e.key === 'Escape') { calibAbort?.abort(); validAbort?.abort() }
  })
  // Key C: (re)calibrate. Starts the tracker if needed, switches to eyes, runs the 9-point screen.
  let calibAbort: AbortController | null = null
  let calibMsg = 'not calibrated (press C)'
  const calibrate = async () => {
    if (calibAbort) return
    const ac = (calibAbort = new AbortController())
    try {
      await startTracker()
      const t = tracker
      if (!t) { calibMsg = 'calibration failed: no camera'; return }
      const deadline = performance.now() + 30_000
      while (!t.running && tracker === t && performance.now() < deadline && !ac.signal.aborted) await new Promise((r) => setTimeout(r, 100))
      if (!t.running) { calibMsg = ac.signal.aborted ? 'calibration cancelled' : `calibration failed: ${trackerErr || 'tracker not ready'}`; return }
      calibMsg = 'calibrating...'
      const res = await runCalibration(t, view, ac.signal, new URLSearchParams(location.search).has('slowcam') ? 1 : undefined,new URLSearchParams(location.search).has('slowcam') ? 120_000 : undefined) // ?slowcam: test hook for the slow headless software-GL tracker
      if (res) {
        calibMsg = `calibrated (${res.points} pts, sigma ${Math.round(res.model.sigma)}px)`
        if (gazeSwitch.preferred !== 'eyes') gazeSwitch.toggle()
      } else calibMsg = ac.signal.aborted ? 'calibration cancelled' : 'calibration failed (no face / bad fit)'
    } finally { calibAbort = null }
  }
  ;(window as unknown as { glanceCalibStatus: () => string }).glanceCalibStatus = () => calibMsg
  // Key T: 20-dot validation (needs a calibration). Shows mean/max error in degrees and the GO / PIVOT verdict.
  let validAbort: AbortController | null = null
  let validMsg = 'not validated (press T after C)'
  const validate = async () => {
    if (validAbort || calibAbort) return
    if (!tracker?.running || !tracker.mapper) { validMsg = 'validation needs a calibration first (press C)'; return }
    const ac = (validAbort = new AbortController())
    try {
      validMsg = 'validating...'
      const slow = new URLSearchParams(location.search).has('slowcam') // test hook for the slow headless tracker
      const res = await runValidation(tracker, view, geometryFromUrl(W), ac.signal, slow ? { minSamples: 1, minDots: 1, autoClose: true } : {})
      if (res) {
        const r = res.report
        validMsg = `${r.verdict}: mean ${r.meanDeg.toFixed(2)} deg, max ${r.maxDeg.toFixed(2)} deg (${r.n} dots)`
        ;(window as unknown as { glanceValidation: ValidationResult }).glanceValidation = res
      } else validMsg = ac.signal.aborted ? 'validation cancelled' : 'validation failed (too few dots with a face)'
    } finally { validAbort = null }
  }
  ;(window as unknown as { glanceValidStatus: () => string }).glanceValidStatus = () => validMsg
  // Webcam + Face Landmarker start the first time eyes are requested (triggers the camera permission prompt).
  let tracker: EyeTracker | null = null
  let trackerErr = ''
  const startTracker = async () => {
    if (tracker) return
    const t = new EyeTracker()
    tracker = t
    ;(window as unknown as { glanceTracker: EyeTracker }).glanceTracker = t
    gazeSwitch.setEyes(t)
    cam.canvas.hidden = false
    try { await t.start() } catch (err) { trackerErr = String(err); t.stop(); tracker = null; gazeSwitch.setEyes(null) }
  }

  root.append(view, status, cam.canvas) // only once keys and mouse are wired, so nothing typed early is lost
  void startTracker() // camera + face tracking start right away, so the camera view is visible without pressing anything

  let frames = 0
  const loop = (t: number) => {
    src.tick(t)
    g.drawImage(src.canvas, 0, 0, W, H)
    const r = gazeSwitch.read(performance.now())
    if (r.sample) {
      gaze.x = r.sample.x
      gaze.y = r.sample.y
      gaze.sigma = r.sample.sigma
    }
    g.strokeStyle = 'rgba(255,60,60,.9)'
    g.beginPath()
    g.lineWidth = 3
    g.arc(Math.max(40, Math.min(W - 40, gaze.x)), Math.max(40, Math.min(H - 40, gaze.y)), 40, 0, Math.PI * 2) // inset so it stays visible at the edges
    g.stroke()
    if (tracker && !cam.canvas.hidden) cam.draw(tracker)
    frames++
    const why = r.fallback ? (tracker?.latest ? ' (fallback: face found, not calibrated yet)' : ' (fallback: no face)') : ''
    const camTxt = trackerErr ? ` · tracker ERROR ${trackerErr}` : tracker ? ` · tracker ${tracker.delegate || 'loading'} face ${tracker.latest ? 'yes' : 'no'}` : ''
    status.textContent = `source: ${src.kind} · gaze[${r.source}${why}] ${Math.round(gaze.x)},${Math.round(gaze.y)} · M toggles mouse/eyes · C calibrates: ${calibMsg} · T validates: ${validMsg} · V camera view${camTxt} · frames ${frames}`
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
}
