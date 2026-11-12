import { createSource, W, H } from './video/source'

// App shell: video source drawn to a canvas; mouse position = gaze (BUILD_PLAN R9).
export const gaze = { x: W / 2, y: H / 2 }

export async function startApp() {
  const root = document.querySelector<HTMLElement>('#app')!
  const view = document.createElement('canvas')
  view.width = W
  view.height = H
  view.id = 'view'
  const status = document.createElement('div')
  status.id = 'status'
  root.append(view, status)
  const g = view.getContext('2d')!

  const src = await createSource()
  view.addEventListener('mousemove', (e) => {
    const r = view.getBoundingClientRect()
    gaze.x = ((e.clientX - r.left) / r.width) * W
    gaze.y = ((e.clientY - r.top) / r.height) * H
  })

  let frames = 0
  const loop = (t: number) => {
    src.tick(t)
    g.drawImage(src.canvas, 0, 0, W, H)
    g.strokeStyle = 'rgba(255,60,60,.9)'
    g.beginPath()
    g.arc(gaze.x, gaze.y, 8, 0, Math.PI * 2)
    g.stroke()
    frames++
    status.textContent = `source: ${src.kind} · gaze ${Math.round(gaze.x)},${Math.round(gaze.y)} · frames ${frames}`
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
}
