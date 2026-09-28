/* تحقق حي من البند ⑮: الفاتورة نافذة حرة — تُصغَّر وتُستعاد، وتُفتح فاتورة ثانية فوقها
   بلا فقد الأولى، وكلتاهما في شريط النوافذ. */
import { open } from './lib.mjs'
const { browser, page } = await open('http://localhost:5173/#/sales/invoices/new', 1600, 900, 9000)
const count = async () => page.evaluate(() => ({
  windows: document.querySelectorAll('.app-window').length,
  taskbar: document.querySelectorAll('[data-window-taskbar] button').length,
  docs: document.querySelectorAll('.invoice-doc').length,
  dimmed: [...document.querySelectorAll('.app-window-backdrop, .layer-modal-backdrop')].length,
}))
console.log('بعد الفتح الأول:', JSON.stringify(await count()))

// فاتورة ثانية فوق الأولى
await page.evaluate(() => { window.location.hash = '#/sales/invoices/new' })
await new Promise((r) => setTimeout(r, 3500))
console.log('بعد الفتح الثاني:', JSON.stringify(await count()))

// تصغير النافذة العليا ثم استعادتها من شريط المهام
await page.evaluate(() => {
  const wins = [...document.querySelectorAll('.app-window')]
  const top = wins[wins.length - 1]
  const minimize = top?.querySelector('button[title*="تصغير"], button[aria-label*="تصغير"]')
  minimize?.click()
})
await new Promise((r) => setTimeout(r, 900))
console.log('بعد التصغير:', JSON.stringify(await count()))
await page.evaluate(() => document.querySelector('.app-window-task.is-minimized button')?.click())
await new Promise((r) => setTimeout(r, 900))
console.log('بعد الاستعادة:', JSON.stringify(await count()))
await page.screenshot({ path: process.env.OUT ?? '/home/user/win2.png' })
await browser.close()
