import { open, selectQuick } from './lib.mjs'
const [w, h] = (process.env.SIZE ?? '1366x768').split('x').map(Number)
const { browser, page } = await open(`http://localhost:${process.env.PORT}/#/sales/invoices`, w, h, 6000)
await page.evaluate(() => {
  const s = () => globalThis.__shopsysDev.data.getState()
  const base = { barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isService: false, active: true, notes: '', imageUrl: '', taxable: true }
  if (!s().items.length) s().seed(['basic'])
  try { s().addItem({ ...base, nameAr: 'زيت عباد الشمس المكرر عبوة 1 لتر — عبوة بلاستيك', sku: 'OIL-1L-LONG', costMinor: 5200, stockQty: 40, priceMinor: 6500 }) } catch { /* موجود */ }
})
await new Promise((r) => setTimeout(r, 1200))
await page.evaluate(() => { if (!document.querySelector('[data-app-window]')) [...document.querySelectorAll('button,a')].find((b)=>b.textContent.includes('فاتورة مبيعات جديدة'))?.click() })
await new Promise((r) => setTimeout(r, 3500))
await page.evaluate(() => document.querySelector('.invoice-line-entry-cell input')?.focus())
await page.keyboard.type('زيت', { delay: 110 })
await new Promise((r) => setTimeout(r, 1100))
await page.keyboard.press('Enter')
await new Promise((r) => setTimeout(r, 700))
await page.keyboard.type('3'); await page.keyboard.press('Enter')
await new Promise((r) => setTimeout(r, 600))
console.log('النمط:', await selectQuick(page, 'نمط تحرير الفاتورة', process.env.MODE ?? 'ربحية'))
await new Promise((r) => setTimeout(r, 900))
console.log(JSON.stringify(await page.evaluate(() => {
  const cell = document.querySelector('[data-line-name-cell]')
  const wrap = document.querySelector('.invoice-doc .invoice-lines-panel .overflow-x-auto')
  return { cellW: Math.round(cell?.getBoundingClientRect().width ?? 0), text: (cell?.textContent ?? '').trim(),
    lines: cell ? Math.round(cell.getBoundingClientRect().height) : 0, hscroll: wrap ? wrap.scrollWidth - wrap.clientWidth : -1 }
})))
await page.screenshot({ path: process.env.OUT ?? '/home/user/nameshot.png' }); await browser.close()
