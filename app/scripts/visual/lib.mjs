/** أدوات القياس البصري (اختيارية — خارج بوابات verify): تتطلب puppeteer-core و@sparticuz/chromium. */
import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'
export async function open(url, w = 1600, h = 1000, wait = 6000) {
  const browser = await puppeteer.launch({
    args: [...chromium.args, '--no-sandbox', '--disable-dev-shm-usage'],
    executablePath: await chromium.executablePath(),
    defaultViewport: { width: w, height: h, deviceScaleFactor: 2 },
    headless: 'shell',
  })
  const page = await browser.newPage()
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {})
  await new Promise((r) => setTimeout(r, wait))
  return { browser, page }
}
export const V = () => [Number(process.env.W || 1600), Number(process.env.H || 1000), Number(process.env.WAIT || 6000)]

/** اختيار قيمة من قائمة QuickSelect (ليست <select> أصلية بل combobox + أزرار) */
export async function selectQuick(page, ariaLabel, optionText, wait = 700) {
  /* القوائم ≤١٠ بنود صارت <select> أصلية (قرار المالك)، والأطول تبقى منتقياً بحثياً */
  const native = await page.evaluate(({ aria, text }) => {
    const select = document.querySelector(`[data-quick-native] select[aria-label="${aria}"]`)
    if (!select) return null
    const option = [...select.options].find((row) => (row.textContent ?? '').includes(text))
    if (!option) return false
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
    setter.call(select, option.value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  }, { aria: ariaLabel, text: optionText })
  if (native !== null) { await new Promise((r) => setTimeout(r, wait)); return native }
  const opened = await page.evaluate((aria) => {
    const input = document.querySelector(`input[aria-label="${aria}"]`)
    if (!input) return false
    input.focus()
    input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    return true
  }, ariaLabel)
  if (!opened) return false
  await new Promise((r) => setTimeout(r, wait))
  const picked = await page.evaluate((text) => {
    const option = [...document.querySelectorAll('[data-quick-option]')].find((b) => (b.textContent ?? '').includes(text))
    if (!option) return false
    option.click()
    return true
  }, optionText)
  await new Promise((r) => setTimeout(r, wait))
  return picked
}
