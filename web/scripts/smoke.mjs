// Headless check of the built app in real Chrome (fake webcam). Exits 1 if any line says FAIL.
// Usage: npm run smoke   (extend the checks here as features land)
import { preview } from 'vite'
import { chromium } from 'playwright'

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
} finally {
  await browser.close()
  server.httpServer.close()
}
process.exit(/FAIL/.test(text) ? 1 : 0)
