// Headless check of the built app in real Chrome (fake webcam). Exits 1 if any line says FAIL.
// Usage: npm run smoke   (extend the checks here as features land)
import { preview } from 'vite'
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const server = await preview({ preview: { port: 4174, strictPort: true }, logLevel: 'error' })
const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--enable-unsafe-swiftshader'],
})
let text = ''
try {
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))
  await page.goto('http://localhost:4174/?smoke')
  await page.waitForFunction(() => document.querySelector('#out')?.textContent?.includes('done'), null, { timeout: 90_000 })
  text = (await page.textContent('#out')) ?? ''
  console.log(text)
  // App shell: default page renders frames from the source and tracks mouse gaze.
  const app = await browser.newPage()
  app.on('pageerror', (e) => console.log('[pageerror]', e.message))
  await app.goto('http://localhost:4174/')
  await app.waitForSelector('#view')
  await app.mouse.move(300, 200)
  await app.mouse.move(400, 300)
  await app.waitForFunction(() => /frames [1-9]\d/.test(document.querySelector('#status')?.textContent ?? ''), null, { timeout: 20_000 })
  const status = (await app.textContent('#status')) ?? ''
  const ok = /source: (synthetic|clip)/.test(status) && /gaze\[mouse\] /.test(status) && !/gaze\[mouse\] 640,360/.test(status)
  const line = `${ok ? 'OK  ' : 'FAIL'} app shell: ${status}`
  console.log(line)
  text += '\n' + line
  // Key M: eyes preferred but no tracker yet -> automatic mouse fallback; M again -> plain mouse.
  await app.keyboard.press('m')
  await app.waitForFunction(() => /fallback: no face/.test(document.querySelector('#status')?.textContent ?? ''), null, { timeout: 5_000 })
  await app.keyboard.press('m')
  await app.waitForFunction(() => /gaze\[mouse\] /.test(document.querySelector('#status')?.textContent ?? '') && !/fallback/.test(document.querySelector('#status')?.textContent ?? ''), null, { timeout: 5_000 })
  const line2 = 'OK   gaze switch: M toggles, falls back to mouse without a face'
  console.log(line2)
  text += '\n' + line2
  // Real face end to end: Chrome's fake webcam plays a y4m cut from the talking-heads clip.
  const dir = mkdtempSync(join(tmpdir(), 'glance-fake-'))
  const y4m = join(dir, 'face.y4m')
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', '3', '-t', '8', '-i', 'public/clips/talking-heads.mp4', '-vf', 'scale=640:360,fps=15', '-pix_fmt', 'yuv420p', y4m])
  const camBrowser = await chromium.launch({
    channel: 'chrome',
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${y4m}`, '--enable-unsafe-swiftshader'],
  })
  try {
    const cam = await camBrowser.newPage()
    cam.on('pageerror', (e) => console.log('[pageerror]', e.message))
    await cam.goto('http://localhost:4174/?slowcam')
    await cam.waitForSelector('#view')
    await cam.keyboard.press('m')
    let line3
    try {
      await cam.waitForFunction(() => (window.glanceTracker?.facesSeen ?? 0) >= 10, null, { timeout: 60_000 })
      const info = await cam.evaluate(() => {
        const t = window.glanceTracker
        return { delegate: t.delegate, frames: t.frames, faces: t.facesSeen, f: t.lastFeatures }
      })
      const f = info.f
      const sane = !!f && (Math.abs(f.rx) < 1 && Math.abs(f.ry) < 1 && f.scale > 0.02 && f.scale < 1)
      line3 = `${sane ? 'OK  ' : 'FAIL'} tracker: real face detected (${info.delegate}) frames ${info.frames} faces ${info.faces} features ${JSON.stringify(f)}`
    } catch (e) {
      line3 = `FAIL tracker: no face detected from fake webcam: ${(await cam.textContent('#status')) ?? ''}`
    }
    console.log(line3)
    text += '\n' + line3
    // Calibration: key C runs the 9-point screen against the real face stream, fits, installs the mapper.
    let line4
    try {
      await cam.keyboard.press('c')
      await cam.waitForSelector('#calib', { timeout: 10_000 })
      await cam.waitForFunction(() => /calibrated \(/.test(window.glanceCalibStatus()), null, { timeout: 60_000 })
      const st = await cam.evaluate(() => window.glanceCalibStatus())
      const gone = (await cam.$('#calib')) === null
      const mapped = await cam.evaluate(() => {
        const t = window.glanceTracker
        const m = t.lastFeatures && t.mapper ? t.mapper(t.lastFeatures) : null
        return m
      })
      const good = gone && mapped && Number.isFinite(mapped.x) && Number.isFinite(mapped.y) && mapped.x >= 0 && mapped.x <= 1280 && st.includes('9 pts')
      line4 = `${good ? 'OK  ' : 'FAIL'} calibration: ${st}; mapped sample ${JSON.stringify(mapped)}; overlay removed ${gone}`
    } catch (e) {
      line4 = `FAIL calibration: ${(await cam.evaluate(() => window.glanceCalibStatus()).catch(() => '?'))} ${String(e).slice(0, 120)}`
    }
    console.log(line4)
    text += '\n' + line4
  } finally {
    await camBrowser.close()
    rmSync(dir, { recursive: true, force: true })
  }
} finally {
  await browser.close()
  server.httpServer.close()
}
process.exit(/FAIL/.test(text) ? 1 : 0)
