import type { EyeTracker } from '../gaze/tracker'

// Picture-in-picture "what the computer vision sees": mirrored webcam with the Face Landmarker's
// 478 points, eye corners and iris circles drawn on top. Key V shows/hides it.
const IRIS = [[468, 469], [473, 474]] // [centre, edge point] per eye
const CORNERS = [33, 133, 362, 263]

export function createCamView(): { canvas: HTMLCanvasElement; draw(t: EyeTracker): void } {
  const canvas = document.createElement('canvas')
  canvas.id = 'camview'
  canvas.width = 480
  canvas.height = 360
  const g = canvas.getContext('2d')!
  const draw = (t: EyeTracker) => {
    const w = canvas.width, h = canvas.height
    g.save()
    g.translate(w, 0)
    g.scale(-1, 1) // mirror, so moving left looks like moving left
    if (t.video.readyState >= 2) g.drawImage(t.video, 0, 0, w, h)
    const lm = t.landmarks
    if (lm) {
      g.fillStyle = 'rgba(0,255,160,.55)'
      for (const p of lm) g.fillRect(p.x * w - 0.5, p.y * h - 0.5, 1.5, 1.5)
      g.fillStyle = '#ffd400'
      for (const i of CORNERS) g.fillRect(lm[i].x * w - 2, lm[i].y * h - 2, 4, 4)
      g.strokeStyle = '#ff3c3c'
      g.lineWidth = 2
      for (const [c, e] of IRIS) {
        if (!lm[c] || !lm[e]) continue
        const r = Math.hypot((lm[c].x - lm[e].x) * w, (lm[c].y - lm[e].y) * h)
        g.beginPath()
        g.arc(lm[c].x * w, lm[c].y * h, r, 0, Math.PI * 2)
        g.stroke()
        g.fillStyle = '#ff3c3c'
        g.fillRect(lm[c].x * w - 1.5, lm[c].y * h - 1.5, 3, 3)
      }
    }
    g.restore()
    g.fillStyle = lm ? '#00ffa0' : '#ff3c3c'
    g.font = '13px ui-monospace, monospace'
    g.fillText(lm ? `face tracked · ${lm.length} landmarks · ${t.delegate}` : 'no face', 8, 18)
  }
  return { canvas, draw }
}
