/** تشغيل: CHROMIUM_EXECUTABLE_PATH=/path/to/chromium node tests/browser/preview-smoke.mjs
 * يحتاج Vite على 127.0.0.1:5173. لا يغني عن تجربة طابعة أو Electron ويندوز. */
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH
if (!executablePath) throw new Error('حدد CHROMIUM_EXECUTABLE_PATH')
const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (err) => errors.push(err.message))
  await page.goto('http://127.0.0.1:5173/tests/browser/preview-harness.html')
  await page.click('#open-preview')
  const frame = page.locator('iframe[title="معاينة المستند"]')
  await frame.waitFor()
  assert.equal(await frame.getAttribute('sandbox'), 'allow-same-origin')
  const report = page.frameLocator('iframe[title="معاينة المستند"]').locator('#report')
  await report.waitFor()
  const originalHeight = await report.evaluate(el => el.getBoundingClientRect().height)
  await page.getByLabel('مقياس الطباعة').fill('70')
  await page.waitForFunction(() => {
    const doc = document.querySelector('iframe[title="معاينة المستند"]')?.contentDocument
    return doc && getComputedStyle(doc.documentElement).zoom === '0.7'
  })
  const scaledHeight = await report.evaluate(el => el.getBoundingClientRect().height)
  assert.ok(scaledHeight < originalHeight * 0.8 && scaledHeight > originalHeight * 0.6, `لم يتغير تخطيط المستند بالمقياس: ${originalHeight} → ${scaledHeight}`)
  await page.waitForTimeout(300)
  assert.equal(await page.evaluate(() => window.__previewScriptRan ?? false), false)
  assert.equal(await page.evaluate(() => window.__previewEventRan ?? false), false)
  // نراقب حدث beforeprint الحقيقي من iframe الطباعة دون استبدال window.print.
  await page.evaluate(() => {
    window.__printEvents = 0
    new MutationObserver((mutations) => {
      for (const m of mutations) for (const n of m.addedNodes) {
        if (n instanceof HTMLIFrameElement && n.getAttribute('sandbox') === 'allow-same-origin allow-modals') {
          n.contentWindow?.addEventListener('beforeprint', () => {
            window.__printEvents++
            window.__printZoom = n.contentDocument && getComputedStyle(n.contentDocument.documentElement).zoom
            window.__printedReport = n.contentDocument?.querySelector('#report')?.textContent
          })
        }
      }
    }).observe(document.body, { childList: true })
  })
  await page.getByRole('button', { name: /طباعة/ }).last().click()
  await page.waitForFunction(() => window.__printEvents === 1, null, { timeout: 5000 })
  assert.equal(await page.evaluate(() => window.__printZoom), '0.7')
  assert.equal(await page.evaluate(() => window.__printedReport), 'بيان اختبار')
  assert.equal(await page.evaluate(() => window.__previewScriptRan ?? false), false)
  assert.equal(await page.evaluate(() => window.__previewEventRan ?? false), false)
  assert.deepEqual(errors, [])
  console.log('PASS: عرض HTML المعاينة، حظر script/onerror، وحدث beforeprint في Chromium headless')
} finally { await browser.close() }
