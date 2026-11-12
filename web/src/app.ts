import { createSource, W, H } from './video/source'
import { MouseSource } from './gaze/mouse'
import { GazeSwitch } from './gaze/switch'
import { EyeTracker } from './gaze/tracker'
import { createCamView } from './ui/camview'

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
    if (e.key.toLowerCase() === 'm') {
      gazeSwitch.toggle()
      if (gazeSwitch.preferred === 'eyes') void startTracker()
    }
    if (e.key.toLowerCase() === 'v') { cam.canvas.hidden = !cam.canvas.hidden; void startTracker() } // show what the vision sees
  })
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
    g.arc(gaze.x, gaze.y, 8, 0, Math.PI * 2)
    g.stroke()
    if (tracker && !cam.canvas.hidden) cam.draw(tracker)
    frames++
    const why = r.fallback ? (tracker?.latest ? ' (fallback: face found, not calibrated yet)' : ' (fallback: no face)') : ''
    const camTxt = trackerErr ? ` · tracker ERROR ${trackerErr}` : tracker ? ` · tracker ${tracker.delegate || 'loading'} face ${tracker.latest ? 'yes' : 'no'}` : ''
    status.textContent = `source: ${src.kind} · gaze[${r.source}${why}] ${Math.round(gaze.x)},${Math.round(gaze.y)} · M toggles mouse/eyes · V camera view${camTxt} · frames ${frames}`
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
}
