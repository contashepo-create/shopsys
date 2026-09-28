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
