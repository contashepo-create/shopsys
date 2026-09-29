/* تحقق حي من سلوك النوافذ (بلاغ المالك):
   ① الفاتورة نافذة حرة لا ملتصقة  ② منتقي الصنف نافذة مستقلة
   ③ إغلاق «تعديل الصنف»/«حركة الصنف»/«أسعار الصنف» لا يغلق المنتقي
   ④ «أسعار الصنف» تعرض بيانات فعلاً  ⑤ نقرتان على صنف في الجدول تفتحان المنتقي */
import { open } from './lib.mjs'
const [w, h] = (process.env.SIZE ?? '1440x900').split('x').map(Number)
const out = process.env.OUT ?? '/home/user/winflow.png'
const PORT = process.env.PORT || 5173
const { browser, page } = await open(`http://localhost:${PORT}/#/sales/invoices`, w, h, 7000)

await page.evaluate(() => {
  const store = globalThis.__shopsysDev?.data
  if (!store) return
  const s = () => store.getState()
  if (!s().items.length) {
    s().seed(['basic'])
    const base = { barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true }
    s().addItem({ ...base, nameAr: 'أرز مصري 5 كجم', sku: 'RICE-5', costMinor: 12000, stockQty: 41, priceMinor: 15500 })
    s().addItem({ ...base, nameAr: 'زيت عباد الشمس 1 لتر', sku: 'OIL-1L', costMinor: 5200, stockQty: 40, priceMinor: 6500 })
  }
})
await new Promise((r) => setTimeout(r, 600))

const wins = () => page.evaluate(() => [...document.querySelectorAll('[data-app-window]')].map((el) => ({
  kind: el.getAttribute('data-window-kind'),
  mode: el.getAttribute('data-window-mode'),
  rect: (() => { const r = el.getBoundingClientRect(); return `${Math.round(r.width)}×${Math.round(r.height)} @${Math.round(r.left)},${Math.round(r.top)}` })(),
})))

// ① فتح الفاتورة
await page.evaluate(() => [...document.querySelectorAll('button, a')].find((b) => b.textContent.includes('فاتورة مبيعات جديدة'))?.click())
await new Promise((r) => setTimeout(r, 4000))
console.log('① نوافذ بعد فتح الفاتورة:', JSON.stringify(await wins()))
console.log('   حرة؟', JSON.stringify(await page.evaluate(() => {
  const el = document.querySelector('[data-window-kind="sales-invoice"]')
  if (!el) return { found: false }
  const r = el.getBoundingClientRect()
  return {
    found: true, mode: el.getAttribute('data-window-mode'),
    fillsViewport: Math.round(r.width) >= window.innerWidth && Math.round(r.height) >= window.innerHeight,
    hasTitlebar: !!el.querySelector('.app-window-bar'),
    buttons: [...el.querySelectorAll('[data-window-button]')].map((b) => b.getAttribute('aria-label')),
  }
})))

// ② فتح المنتقي بالكتابة في خلية الصنف
await page.evaluate(() => document.querySelector('.invoice-line-entry-cell input')?.focus())
await page.keyboard.type('أرز', { delay: 120 })
await new Promise((r) => setTimeout(r, 1500))
console.log('② بعد الكتابة:', JSON.stringify(await wins()))

// ③ فتح «تعديل الصنف» ثم إغلاقها — يجب أن يبقى المنتقي
await page.evaluate(() => document.querySelector('[data-item-picker-edit]')?.click())
await new Promise((r) => setTimeout(r, 1500))
console.log('③ بعد فتح تعديل الصنف:', JSON.stringify(await wins()))
await page.keyboard.press('Escape')
await new Promise((r) => setTimeout(r, 1200))
console.log('   بعد إغلاق التعديل:', JSON.stringify(await wins()))

// ④ أسعار الصنف
await page.evaluate(() => document.querySelector('[data-item-picker-prices]')?.click())
await new Promise((r) => setTimeout(r, 1500))
const prices = await page.evaluate(() => {
  const view = document.querySelector('[data-window-view="item-prices"]')
  if (!view) return { found: false }
  return {
    found: true,
    summary: [...view.querySelectorAll('[data-item-prices-summary] b')].map((b) => b.textContent.trim()),
    rows: view.querySelectorAll('[data-item-prices-row]').length,
    text: view.textContent.replace(/\s+/g, ' ').slice(0, 160),
  }
})
console.log('④ نافذة الأسعار:', JSON.stringify(prices, null, 1))
await page.screenshot({ path: out })
await page.keyboard.press('Escape')
await new Promise((r) => setTimeout(r, 1000))
console.log('   بعد إغلاق الأسعار:', JSON.stringify(await wins()))

// ⑤ اختيار الصنف يعيدنا للفاتورة ويغلق المنتقي
await page.evaluate(() => {
  const opt = document.querySelector('[data-window-view="item-picker"] [data-quick-option]')
  if (opt) { opt.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) }
})
await new Promise((r) => setTimeout(r, 1500))
console.log('⑤ بعد اختيار الصنف:', JSON.stringify(await wins()))
console.log('   سطور الفاتورة:', await page.evaluate(() => document.querySelectorAll('.invoice-doc tbody tr[data-entry-row]').length))

// ⑥ نقرتان على اسم الصنف داخل الجدول
await page.evaluate(() => {
  const cell = document.querySelector('[data-line-name-cell]')
  cell?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
})
await new Promise((r) => setTimeout(r, 1500))
console.log('⑥ بعد النقر المزدوج على اسم الصنف:', JSON.stringify(await wins()))
await browser.close()
