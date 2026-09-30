/* فحص حيّ لدفعة ⑬: الإدخال الذكي · اختصارات السطر · غياب كلمة «معفى» */
import { open, selectQuick } from './lib.mjs'

const [w, h] = (process.env.SIZE ?? '1440x860').split('x').map(Number)
const PORT = process.env.PORT || 5173
const { browser, page } = await open(`http://localhost:${PORT}/#/sales/invoices`, w, h, 5500)
const wait = (ms = 700) => new Promise((r) => setTimeout(r, ms))
const res = []
const check = (label, ok, extra = '') => { res.push(ok); console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`) }

await page.evaluate(() => {
  const s = () => globalThis.__shopsysDev.data.getState()
  if (!s().items.length) {
    s().seed(['basic'])
    const base = { barcodes: [], categoryId: 1, baseUnit: 'كيس', extraUnits: [], minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isService: false, active: true, notes: '', imageUrl: '', taxable: true }
    try { s().addItem({ ...base, nameAr: 'أرز مصري 5 كجم', sku: 'RICE-5', costMinor: 12000, stockQty: 41, priceMinor: 15500 }) } catch { /* موجود */ }
    try { s().addItem({ ...base, nameAr: 'سكر ناعم 1 كجم', sku: 'SUG-1', costMinor: 2400, stockQty: 90, priceMinor: 2800 }) } catch { /* موجود */ }
  }
})
await wait(1400)
await page.evaluate(() => { const b = [...document.querySelectorAll('button, a')].filter((x) => x.textContent.includes('فاتورة مبيعات جديدة') && !x.disabled).pop(); b?.click() })
await wait(3200)

/* ① الإدخال الذكي من خلية الصنف */
await page.evaluate(() => document.querySelector('.invoice-line-entry-cell input')?.focus())
await page.keyboard.type('أرز*3@140-10%', { delay: 60 })
await wait(1100)
await page.keyboard.press('Enter')
await wait(900)
const line = await page.evaluate(() => {
  const row = document.querySelector('[data-line-key]')
  if (!row) return null
  const cells = [...row.querySelectorAll('input, td')].map((n) => (n.value ?? n.textContent ?? '').trim()).filter(Boolean)
  return { cells: cells.slice(0, 8).join(' | ') }
})
check('الإدخال الذكي أضاف السطر', !!line, line?.cells ?? 'لا سطر')
const values = await page.evaluate(() => {
  const state = [...document.querySelectorAll('[data-line-key] input')].map((i) => i.value)
  return state
})
check('الكمية ٣ من «*3»', values.includes('3'), values.join(' · '))
check('السعر ١٤٠ من «@140»', values.some((v) => Number(String(v).replace(/,/g, '')) === 140), values.join(' · '))
check('الخصم ١٠٪ من «-10%»', values.includes('10'), values.join(' · '))

/* ② اختصارات السطر */
await page.evaluate(() => { const input = document.querySelector('[data-line-key] input'); input?.focus() })
await page.keyboard.down('Control'); await page.keyboard.press('KeyD'); await page.keyboard.up('Control')
await wait(800)
const afterDup = await page.evaluate(() => document.querySelectorAll('[data-line-key]').length)
check('Ctrl+D يكرر السطر', afterDup === 2, `عدد السطور ${afterDup}`)

await page.evaluate(() => document.querySelector('.invoice-line-entry-cell input')?.focus())
await page.keyboard.type('سكر', { delay: 60 }); await wait(900); await page.keyboard.press('Enter'); await wait(800)
const order0 = await page.evaluate(() => [...document.querySelectorAll('[data-line-key]')].map((r) => r.textContent.slice(0, 12).trim()))
await page.evaluate(() => { const rows = [...document.querySelectorAll('[data-line-key] input')]; rows[rows.length - 1]?.focus() })
await page.keyboard.down('Alt'); await page.keyboard.press('ArrowUp'); await page.keyboard.up('Alt')
await wait(800)
const order1 = await page.evaluate(() => [...document.querySelectorAll('[data-line-key]')].map((r) => r.textContent.slice(0, 12).trim()))
check('Alt+↑ ينقل السطر لأعلى', JSON.stringify(order0) !== JSON.stringify(order1), `${order0.length} سطور`)

await page.evaluate(() => { const input = document.querySelector('[data-line-key] input'); input?.focus() })
const before = await page.evaluate(() => document.querySelectorAll('[data-line-key]').length)
await page.keyboard.down('Control'); await page.keyboard.press('Delete'); await page.keyboard.up('Control')
await wait(800)
const after = await page.evaluate(() => document.querySelectorAll('[data-line-key]').length)
check('Ctrl+Delete يحذف السطر', after === before - 1, `${before} ⇐ ${after}`)

/* ③ لا كلمة «معفى» في المستند ولا في الطباعة */
await selectQuick(page, 'نمط تحرير الفاتورة', 'متقدم')
await wait(900)
const exempt = await page.evaluate(() => {
  const root = document.querySelector('[data-window-kind="sales-invoice"]') ?? document.body
  return /معف[يى]/.test(root.textContent ?? '')
})
check('لا كلمة «معفى» على شاشة الفاتورة', !exempt)
const printed = await page.evaluate(async () => {
  const mod = await import('/src/ui/print/printReceipt.ts')
  const cur = { code: 'EGP', symbol: 'ج.م', decimals: 2, nameAr: 'جنيه', rate: 1 }
  const row = (nameAr, vatPercent) => ({ nameAr, qtyLabel: '1', unitPriceMinor: 10000, totalMinor: 10000, discountPercent: 0, vatPercent, serials: [] })
  const model = {
    shopName: 'متجر', headerLines: [], docTitle: 'فاتورة مبيعات', operatorName: 'المالك', invoiceNumber: 'INV-1', refCode: '',
    dateLabel: '2026-09-29 10:00', customerName: 'عميل نقدي', paymentLabel: 'نقدي',
    rows: [row('صنف خاضع', 14), row('صنف بلا ضريبة', 0), row('صنف بلا نسبة', null)],
    itemCount: 3, totalQty: 3, grossMinor: 30000, taxBaseMinor: 30000, discountMinor: 0,
    taxLabel: null, taxMinor: 0, totalMinor: 30000, paidMinor: 30000, remainingMinor: 0, footerText: 'شكراً',
  }
  const settings = { paperWidth: '80mm', shopName: 'متجر', headerLines: [], footerText: 'شكراً', logoDataUrl: '', showHeaderLines: false }
  const html = mod.renderReceiptHtml(model, cur, settings)
  return { hasExempt: /معف[يى]/.test(html), hasVat: /ض\. 14٪/.test(html) }
})
check('لا كلمة «معفى» في الإيصال المطبوع', !printed.hasExempt)
check('نسبة الضريبة الفعلية ما زالت تُطبع', printed.hasVat)

await page.screenshot({ path: process.env.OUT ?? '/home/user/smartline.png' })
const bad = res.filter((r) => !r).length
console.log(bad ? `\n❌ ${bad} فحص فاشل من ${res.length}` : `\n✅ كل الفحوص ناجحة (${res.length})`)
await browser.close()
