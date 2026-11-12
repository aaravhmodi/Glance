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
  const ok = /source: clip call-desk/.test(status) && /gaze\[mouse\] /.test(status) && !/gaze\[mouse\] 640,360/.test(status)
  const line = `${ok ? 'OK  ' : 'FAIL'} app shell: ${status}`
  console.log(line)
  text += '\n' + line
  // Real video source: picker lists 3 clips + webcam; keys 1-3 switch clips and the frame is not black; key 4 = webcam.
  const lumaOf = () => app.evaluate(() => {
    const c = document.querySelector('#view')
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    let s = 0, n = 0
    for (let i = 0; i < d.length; i += 4 * 97) { s += d[i] + d[i + 1] + d[i + 2]; n += 3 }
    return s / n
  })
  const opts = await app.$$eval('#picker option', (o) => o.map((x) => x.value))
  const picks = []
  for (const [key, id] of [['2', 'call-plants'], ['3', 'call-teacher'], ['1', 'call-desk']]) {
    await app.keyboard.press(key)
    await app.waitForFunction((i) => document.querySelector('#status')?.textContent?.includes('clip ' + i), id, { timeout: 5_000 })
    await app.waitForFunction(() => { // a clip needs time to decode its first frame
      const c = document.querySelector('#view')
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
      let s = 0
      for (let i = 0; i < d.length; i += 388) s += d[i]
      return s / (d.length / 388) > 8
    }, null, { timeout: 8_000 }).catch(() => {})
    picks.push(`${id}:${Math.round(await lumaOf())}`)
  }
  await app.keyboard.press('4')
  await app.waitForFunction(() => /source: webcam webcam/.test(document.querySelector('#status')?.textContent ?? ''), null, { timeout: 5_000 })
  await app.keyboard.press('1')
  const lumas = picks.map((p) => Number(p.split(':')[1]))
  const okSrc = opts.join() === 'call-desk,call-plants,call-teacher,webcam' && lumas.every((l) => l > 8)
  const lineSrc = `${okSrc ? 'OK  ' : 'FAIL'} video source: picker ${opts.join('/')}; keys 1-3 switch clips (mean luma ${picks.join(' ')}); key 4 webcam`
  console.log(lineSrc)
  text += '\n' + lineSrc
  // Foveation: sharp (== source, same orientation) at the gaze point, much less detail far away, VideoFrame works.
  await app.waitForFunction(() => /clip call-desk/.test(document.querySelector('#status')?.textContent ?? ''), null, { timeout: 5_000 })
  await app.waitForFunction(() => { // clip 1 was just re-selected: wait for a real frame
    const c = document.querySelector('#view')
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    let s = 0
    for (let i = 0; i < d.length; i += 388) s += d[i]
    return s / (d.length / 388) > 8
  }, null, { timeout: 8_000 })
  const fv = await app.evaluate(async () => {
    const { fov, geom, src } = window.glanceFoveate
    const W = 1280, H = 720
    const gx = 300, gy = 200
    const r = window.glanceFoveate.radius(0)
    fov.render(src.frame, gx, gy, r)
    const grab = (c) => { const k = document.createElement('canvas'); k.width = W; k.height = H; const g = k.getContext('2d', { willReadFrequently: true }); g.drawImage(c, 0, 0, W, H); return g }
    const a = grab(fov.canvas), b = grab(src.frame)
    const diff = (x, y, w, h) => { const p = a.getImageData(x, y, w, h).data, q = b.getImageData(x, y, w, h).data; let s = 0; for (let i = 0; i < p.length; i += 4) s += Math.abs(p[i] - q[i]); return s / (p.length / 4) }
    const detail = (g, x, y, w, h) => { const p = g.getImageData(x, y, w, h).data; let s = 0; for (let i = 4; i < p.length; i += 4) s += Math.abs(p[i] - p[i - 4]); return s / (p.length / 4) }
    const near = diff(gx - 40, gy - 40, 80, 80) // inside the fovea: must equal the source
    const farOut = detail(a, 1100, 560, 160, 120), farSrc = detail(b, 1100, 560, 160, 120)
    const frame = fov.frame(1000)
    const vf = { w: frame.displayWidth, h: frame.displayHeight, ts: frame.timestamp }
    frame.close()
    return { r, near, farOut, farSrc, vf, bigger: window.glanceFoveate.radius(100) > r }
  })
  const okFov = fv.r > 150 && fv.near < 3 && fv.farOut < fv.farSrc * 0.6 && fv.vf.w === 1280 && fv.vf.h === 720 && fv.vf.ts === 1000 && fv.bigger
  const lineF = `${okFov ? 'OK  ' : 'FAIL'} foveate: radius ${Math.round(fv.r)}px; fovea diff vs source ${fv.near.toFixed(2)}; far detail ${fv.farOut.toFixed(2)} vs source ${fv.farSrc.toFixed(2)}; VideoFrame ${JSON.stringify(fv.vf)}`
  console.log(lineF)
  text += '\n' + lineF
  // Encoders: key E runs two VP9 quantizer-mode encoders (same QP) for ~5 s on the real clip; Glance must be smaller.
  await app.mouse.move(400, 300)
  await app.keyboard.press('e')
  await app.waitForFunction(() => !!window.glanceEnc, null, { timeout: 10_000 })
  await app.waitForTimeout(5_000)
  const en = await app.evaluate(async () => {
    const e = window.glanceEnc
    await e.flush()
    const n = e.normal.stats, g = e.glance.stats
    return { nb: n.total, gb: g.total, nk: n.chunks, gk: g.chunks, nkbps: n.averageKbps(), gkbps: g.averageKbps(), err: e.error, enc: e.encoded, dropped: e.dropped, cfg: e.glance.config, same: JSON.stringify(e.normal.config) === JSON.stringify(e.glance.config) && e.normal.qp === e.glance.qp }
  })
  const okEnc = !en.err && en.same && en.enc >= 8 && Math.abs(en.nk - en.gk) <= 2 &&en.nb > 0 && en.gb > 0 && en.gb < en.nb * 0.95 && en.cfg.bitrateMode === 'quantizer'
  const lineE = `${okEnc ? 'OK  ' : 'FAIL'} encoders: ${en.enc} frame pairs (${en.dropped} dropped), normal ${en.nkbps.toFixed(0)} kbps (${en.nb} B) vs glance ${en.gkbps.toFixed(0)} kbps (${en.gb} B) = ${(100 * (1 - en.gb / en.nb)).toFixed(1)}% saved; ${en.err}`
  console.log(lineE)
  text += '\n' + lineE
  await app.keyboard.press('e')
  // Split screen: key S starts the encoders, decodes both streams, draws them side by side with live kbps + % saved.
  await app.keyboard.press('s')
  let lineS
  try {
    await app.waitForFunction(() => window.glanceSplit && window.glanceSplit.n.decoded >= 2 && window.glanceSplit.g.decoded >= 2, null, { timeout: 30_000 })
    await app.waitForFunction(() => { // both panels must show a decoded picture (headless draws only ~2 fps)
      const g = document.querySelector('#view').getContext('2d', { willReadFrequently: true })
      const mean = (x, y, w, h) => { const d = g.getImageData(x, y, w, h).data; let t = 0; for (let i = 0; i < d.length; i += 4) t += d[i] + d[i + 1] + d[i + 2]; return t / (d.length / 4 * 3) }
      return mean(40, 200, 560, 300) > 8 && mean(680, 200, 560, 300) > 8
    }, null, { timeout: 15_000 })
    const sp = await app.evaluate(() => {
      const s = window.glanceSplit, c = document.querySelector('#view')
      const g = c.getContext('2d', { willReadFrequently: true })
      const mean = (x, y, w, h) => { const d = g.getImageData(x, y, w, h).data; let t = 0; for (let i = 0; i < d.length; i += 4) t += d[i] + d[i + 1] + d[i + 2]; return t / (d.length / 4 * 3) }
      return { nd: s.n.decoded, gd: s.g.decoded, ne: s.n.error, ge: s.g.error, l: mean(40, 200, 560, 300), r: mean(680, 200, 560, 300), status: document.querySelector('#status').textContent, enc: window.glanceEnc.error }
    })
    const okS =!sp.ne && !sp.ge && !sp.enc && sp.l > 8 && sp.r > 8 && /S split ON/.test(sp.status) && /normal \d+ kbps vs glance \d+ kbps/.test(sp.status)
    lineS = `${okS ? 'OK  ' : 'FAIL'} split screen: decoded normal ${sp.nd} / glance ${sp.gd} frames, panel luma L ${sp.l.toFixed(0)} R ${sp.r.toFixed(0)}; errors '${sp.ne}${sp.ge}${sp.enc}'`
    // E while S started the encoders must switch both off cleanly (regression: null.close() crash)
    await app.keyboard.press('e')
    await app.waitForFunction(() => /S split off/.test(document.querySelector('#status')?.textContent ?? '') && /E encode: off/.test(document.querySelector('#status')?.textContent ?? ''), null, { timeout: 5_000 })
    await app.keyboard.press('s')
    await app.waitForFunction(() => /S split ON/.test(document.querySelector('#status')?.textContent ?? ''), null, { timeout: 10_000 })
    await app.keyboard.press('s')
    await app.waitForFunction(() => /S split off/.test(document.querySelector('#status')?.textContent ?? '') && /E encode: off/.test(document.querySelector('#status')?.textContent ?? ''), null, { timeout: 5_000 })
  } catch (e) {
    lineS = `FAIL split screen: ${String(e).slice(0, 150)}`
  }
  console.log(lineS)
  text += '\n' + lineS
  // Key M: eyes preferred but no tracker yet -> automatic mouse fallback; M again -> plain mouse.
  await app.keyboard.press('m')
  await app.waitForFunction(() => /fallback: no face/.test(document.querySelector('#status')?.textContent ?? ''), null, { timeout: 5_000 })
  await app.keyboard.press('m')
  await app.waitForFunction(() => /gaze\[mouse\] /.test(document.querySelector('#status')?.textContent ?? '') && !/fallback/.test(document.querySelector('#status')?.textContent ?? ''), null, { timeout: 5_000 })
  const line2 = 'OK   gaze switch: M toggles, falls back to mouse without a face'
  console.log(line2)
  text += '\n' + line2
  // Real face end to end: Chrome's fake webcam plays a y4m cut from the call-plants clip (close-up face).
  const dir = mkdtempSync(join(tmpdir(), 'glance-fake-'))
  const y4m = join(dir, 'face.y4m')
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', '0', '-t', '8', '-i', 'public/clips/call-plants.mp4', '-vf', 'scale=640:360,fps=15', '-pix_fmt', 'yuv420p', y4m])
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
    // Validation: key T runs the 20-dot screen on the calibrated tracker and produces a report.
    let line5
    try {
      await cam.keyboard.press('t')
      await cam.waitForSelector('#validate', { timeout: 10_000 })
      await cam.waitForFunction(() => !!window.glanceValidation, null, { timeout: 120_000 })
      const v = await cam.evaluate(() => ({ r: window.glanceValidation.report, s: window.glanceValidStatus() }))
      const good = Number.isFinite(v.r.meanDeg) && v.r.maxDeg >= v.r.meanDeg && ['GO', 'GO-with-big-fovea', 'PIVOT'].includes(v.r.verdict)
      line5 = `${good ? 'OK  ' : 'FAIL'} validation: ${v.s}`
    } catch (e) {
      line5 = `FAIL validation: ${(await cam.evaluate(() => window.glanceValidStatus()).catch(() => '?'))} ${String(e).slice(0, 120)}`
    }
    console.log(line5)
    text += '\n' + line5
  } finally {
    await camBrowser.close()
    rmSync(dir, { recursive: true, force: true })
  }
} finally {
  await browser.close()
  server.httpServer.close()
}
process.exit(/FAIL/.test(text) ? 1 : 0)
