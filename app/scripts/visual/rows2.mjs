/* لقطة لجدول الأصناف بسطرين حقيقيين: للتأكد بصرياً من إلغاء «التقسيمات»،
   وتوسيط كل الخلايا، وخلوّ خلية الاسم من أي نص أو أيقونة. */
import { open } from './lib.mjs'
const [w, h] = (process.env.SIZE ?? '1600x900').split('x').map(Number)
const out = process.env.OUT ?? '/home/user/rows2.png'
const { browser, page } = await open('http://localhost:5173/#/sales/invoices/new', w, h, 8000)
const state = await page.evaluate(() => {
  const store = globalThis.__shopsysDev?.data
  const data = store?.getState()
  if (!data) return { items: -1, customers: -1 }
  if (!data.items.length) {
    data.seed(['basic'])
    const base = {
      barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], minQty: 0,
      trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false,
      variantColors: [], variantSizes: [], isActive: true,
    }
    store.getState().addItem({ ...base, nameAr: 'زيت عباد الشمس 1 لتر', sku: 'OIL-1L', costMinor: 5200, stockQty: 40, priceMinor: 6500 })
    store.getState().addItem({ ...base, nameAr: 'سكر ناعم 1 كجم', sku: 'SUG-1K', costMinor: 2800, stockQty: 6, priceMinor: 3200 })
    store.getState().addItem({ ...base, nameAr: 'أرز مصري 5 كجم', sku: 'RIC-5K', costMinor: 14000, stockQty: 25, priceMinor: 16500 })
  }
  const after = store.getState()
  return { items: after.items.length, customers: after.customers.length }
})
console.log('حالة المتجر:', JSON.stringify(state))
async function addLine(query, qty, price) {
  await page.evaluate(() => {
    const input = document.querySelector('.invoice-line-entry-cell input')
    input?.focus()
  })
  await page.keyboard.type(query, { delay: 120 })
  await new Promise((r) => setTimeout(r, 900))
  await page.keyboard.press('Enter')
  await new Promise((r) => setTimeout(r, 700))
  await page.keyboard.type(String(qty), { delay: 90 })
  await page.keyboard.press('Enter')
  await new Promise((r) => setTimeout(r, 300))
  await page.keyboard.type(String(price), { delay: 90 })
  await page.keyboard.press('Enter')
  await new Promise((r) => setTimeout(r, 600))
}
const names = (process.env.ITEMS ?? '').split('|').filter(Boolean)
if (names.length) {
  await addLine(names[0], 3, 25)
  if (names[1]) await addLine(names[1], 40, 12)
}
const rows = await page.evaluate(() => ({
  lines: document.querySelectorAll('.invoice-doc tbody tr[data-entry-row]').length,
  ghost: document.querySelectorAll('.invoice-doc tbody tr.invoice-line-ghost').length,
  tax: document.querySelectorAll('.invoice-doc .invoice-doc-taxchip').length,
  sub: document.querySelectorAll('.invoice-doc-linesub').length,
}))
console.log('السطور:', JSON.stringify(rows))
await page.screenshot({ path: out })
console.log('لقطة:', out)
await browser.close()
