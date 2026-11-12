import { SourceManager, W, H } from './video/source'
import { MouseSource } from './gaze/mouse'
import { GazeSwitch } from './gaze/switch'
import { EyeTracker } from './gaze/tracker'
import { createCamView } from './ui/camview'
import { runCalibration } from './gaze/calib'
import { Foveator } from './video/foveate'
import { foveaRadiusPx } from './video/fovea'
import { DualEncoder, vp9QuantizerSupported, CODEC } from './video/encoders'
import { StreamDecoder, decoderConfigFor } from './video/decoder'
import { splitPanels, panelLabel, savedLabel } from './ui/split'
import { percentSaved } from './metrics/stats'
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

  const src = new SourceManager(new URLSearchParams(location.search).has('synthetic')) // ?synthetic = tests only
  await src.init()
  src.webcam = () => (tracker?.running ? tracker.video : null) // share the tracker's camera stream
  const fov = new Foveator(W, H) // key F: show the foveated picture (what Glance would send)
  let foveate = false
  const geom = geometryFromUrl(W)
  ;(window as unknown as { glanceFoveate: unknown }).glanceFoveate = { fov, geom, src, radius: (sigma: number) => foveaRadiusPx(geom, sigma) }
  const picker = document.createElement('select')
  picker.id = 'picker'
  for (const o of src.options) picker.add(new Option(`${picker.length + 1}: ${o.label}`, o.id))
  picker.onchange = () => { void src.select(picker.value); picker.blur() }
  src.onChange = (o) => { picker.value = o.id }
  picker.value = src.current?.id ?? ''
  gazeSwitch = new GazeSwitch(new MouseSource(view, W, H))
  addEventListener('keydown', (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
    if (/^[1-9]$/.test(e.key) && !calibAbort && !validAbort) void src.key(e.key) // keys 1-3 clips, then webcam
    if (e.key.toLowerCase() === 'm' && !calibAbort) { // ignored while calibrating
      gazeSwitch.toggle()
      if (gazeSwitch.preferred === 'eyes') void startTracker()
    }
    if (e.key.toLowerCase() === 'v') { cam.canvas.hidden = !cam.canvas.hidden; void startTracker() } // show what the vision sees
    if (e.key.toLowerCase() === 'f') foveate = !foveate
    if (e.key.toLowerCase() === 'e') void toggleEncode()
    if (e.key.toLowerCase() === 's') void toggleSplit()
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
  // Key E: run the two VP9 encoders (normal vs Glance) on the live frames and show kbps / % saved.
  let enc: DualEncoder | null = null
  let encMsg = 'off'
  let lastPushMs = -Infinity
  const encT0 = performance.now() // chunk timestamps are relative to this, so stats seconds start at 0
  const toggleEncode = async () => {
    if (enc) {
      stopSplit() // may already have closed and cleared enc (when S started the encoders)
      if (enc) { const e: DualEncoder = enc; enc = null; e.close(); encMsg = 'off' }
      return
    }
    if (!(await vp9QuantizerSupported(W, H))) { encMsg = 'VP9 quantizer mode not supported here'; return }
    if (enc) return // a second E press while the support check was pending
    enc = new DualEncoder(W, H, 30)
    ;(window as unknown as { glanceEnc: DualEncoder }).glanceEnc = enc
  }
  // Key S: split screen. Left = decoded "normal" stream, right = decoded Glance stream, each with live kbps; starts the encoders if needed.
  let split: { n: StreamDecoder; g: StreamDecoder; startedEnc: boolean } | null = null
  let splitPending = false
  function stopSplit() {
    if (!split) return
    const s = split
    split = null
    if (enc) { enc.normal.onChunk = null; enc.glance.onChunk = null }
    s.n.close(); s.g.close()
    if (s.startedEnc && enc) { const e = enc; enc = null; e.close(); encMsg = 'off' }
  }
  const toggleSplit = async () => {
    if (split) { stopSplit(); return }
    if (splitPending) return
    splitPending = true
    try {
      const startedEnc = !enc
      if (!enc) await toggleEncode()
      if (!enc || split) return
      const cfg = decoderConfigFor(CODEC, W, H)
      const n = new StreamDecoder(cfg), g2 = new StreamDecoder(cfg)
      enc.normal.onChunk = (c) => n.push(c)
      enc.glance.onChunk = (c) => g2.push(c)
      split = { n, g: g2, startedEnc }
      ;(window as unknown as { glanceSplit: unknown }).glanceSplit = split
    } finally { splitPending = false }
  }
  const drawSplit = (nowMs: number) => {
    if (!split || !enc) return
    const { left, right } = splitPanels(W, H)
    const t = (nowMs - encT0) / 1000
    g.fillStyle = '#000'
    g.fillRect(0, 0, W, H)
    const k = left.w / W
    for (const [rect, dec, st, title] of [[left, split.n, enc.normal.stats, 'Normal stream'], [right, split.g, enc.glance.stats, 'Glance stream']] as const) {
      if (dec.latest) g.drawImage(dec.latest, rect.x, rect.y, rect.w, rect.h)
      else { g.fillStyle = '#888'; g.font = '20px ui-monospace, monospace'; g.fillText('waiting for first keyframe...', rect.x + 20, rect.y + 40) }
      g.strokeStyle = 'rgba(255,60,60,.9)'
      g.lineWidth = 2
      g.beginPath()
      g.arc(rect.x + gaze.x * k, rect.y + gaze.y * k, 20, 0, Math.PI * 2)
      g.stroke()
      g.fillStyle = '#fff'
      g.font = 'bold 20px ui-monospace, monospace'
      g.fillText(panelLabel(title, st.lastSecondKbps(t), st.total), rect.x + 4, rect.y - 12)
    }
    g.fillStyle = '#7CFC9A'
    g.font = 'bold 26px ui-monospace, monospace'
    g.fillText(savedLabel(percentSaved(enc.normal.stats.total, enc.glance.stats.total)), right.x + 4, right.y + right.h + 34)
  }
  const encText =(nowMs: number) => {
    if (!enc) return encMsg
    const ns = enc.normal.stats, gs = enc.glance.stats, t = (nowMs - encT0) / 1000
    return `normal ${ns.lastSecondKbps(t).toFixed(0)} kbps vs glance ${gs.lastSecondKbps(t).toFixed(0)} kbps · ${percentSaved(ns.total, gs.total).toFixed(0)}% saved${enc.error ? ' ERR ' + enc.error : ''}`
  }
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

  root.append(view, status, picker, cam.canvas) // only once keys and mouse are wired, so nothing typed early is lost
  void startTracker() // camera + face tracking start right away, so the camera view is visible without pressing anything

  let frames = 0
  const loop = (t: number) => {
    src.tick(t)
    const r = gazeSwitch.read(performance.now())
    if (r.sample) {
      gaze.x = r.sample.x
      gaze.y = r.sample.y
      gaze.sigma = r.sample.sigma
    }
    if (enc && performance.now() - lastPushMs >= 1000 / 30 - 2) { // ~30 fps frame pair into both encoders
      lastPushMs = performance.now()
      fov.render(src.frame, gaze.x, gaze.y, foveaRadiusPx(geom, gaze.sigma))
      const tsUs = Math.round((lastPushMs - encT0) * 1000)
      const gf = fov.frame(tsUs)
      try { enc.push(new VideoFrame(src.frame, { timestamp: tsUs }), gf) } catch (e) { gf.close(); throw e }
    }
    if (split) drawSplit(performance.now())
    else {
      if (foveate) { fov.render(src.frame, gaze.x, gaze.y, foveaRadiusPx(geom, gaze.sigma)); g.drawImage(fov.canvas, 0, 0, W, H) }
      else g.drawImage(src.frame, 0, 0, W, H)
      g.strokeStyle = 'rgba(255,60,60,.9)'
      g.beginPath()
      g.lineWidth = 3
      g.arc(Math.max(40, Math.min(W - 40, gaze.x)), Math.max(40, Math.min(H - 40, gaze.y)), 40, 0, Math.PI * 2) // inset so it stays visible at the edges
      g.stroke()
    }
    if (tracker && !cam.canvas.hidden) cam.draw(tracker)
    frames++
    const why = r.fallback ? (tracker?.latest ? ' (fallback: face found, not calibrated yet)' : ' (fallback: no face)') : ''
    const camTxt = trackerErr ? ` · tracker ERROR ${trackerErr}` : tracker ? ` · tracker ${tracker.delegate || 'loading'} face ${tracker.latest ? 'yes' : 'no'}` : ''
    status.textContent = `source: ${src.kind} ${src.current?.id ?? ''} (keys 1-${src.options.length}) · gaze[${r.source}${why}] ${Math.round(gaze.x)},${Math.round(gaze.y)} · M toggles mouse/eyes · C calibrates: ${calibMsg} · T validates: ${validMsg} · F foveate ${foveate ? 'ON' : 'off'} · E encode: ${encText(performance.now())} · S split ${split ? 'ON' : 'off'} · V camera view${camTxt} · frames ${frames}`
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
}
