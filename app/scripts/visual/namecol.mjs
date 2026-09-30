/* بلاغ المالك: في الأنماط الأعلى من «بيع مباشر» يختفي اسم الصنف داخل الجدول.
   يقيس عرض عمود «الصنف/الوصف» ونص الخلية في كل نمط. */
import { open, selectQuick } from './lib.mjs'
const [w, h] = (process.env.SIZE ?? '1366x768').split('x').map(Number)
const PORT = process.env.PORT || 5173
const KIND = process.env.KIND ?? 'sale'
const LIST = KIND === 'purchase' ? '/purchases/invoices' : '/sales/invoices'
const NEWBTN = KIND === 'purchase' ? 'فاتورة شراء' : 'فاتورة مبيعات جديدة'
const { browser, page } = await open(`http://localhost:${PORT}/#${LIST}`, w, h, 6000)
await page.evaluate((btn) => { globalThis.__newBtn = btn }, NEWBTN)
await page.evaluate(() => {
  const s = () => globalThis.__shopsysDev.data.getState()
  if (!s().items.length) {
    s().seed(['basic'])
    const base = { barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isService: false, active: true, notes: '', imageUrl: '', taxable: true }
    try { s().addItem({ ...base, nameAr: 'أرز مصري 5 كجم', sku: 'RICE-5', costMinor: 12000, stockQty: 41, priceMinor: 15500 }) } catch { /* موجود */ }
  }
}, undefined)
await new Promise((r) => setTimeout(r, 1500))
await page.evaluate(() => {
  if (document.querySelector('[data-app-window]')) return
  const btn = [...document.querySelectorAll('button, a')].filter((b) => b.textContent.includes(globalThis.__newBtn) && !b.disabled).pop()
  btn?.click()
})
await new Promise((r) => setTimeout(r, 3500))
// سطر واحد بالصنف
await page.evaluate(() => document.querySelector('.invoice-line-entry-cell input')?.focus())
await page.keyboard.type('أرز', { delay: 110 })
await new Promise((r) => setTimeout(r, 1100))
await page.keyboard.press('Enter')
await new Promise((r) => setTimeout(r, 700))
await page.keyboard.type('10'); await page.keyboard.press('Enter')
await new Promise((r) => setTimeout(r, 600))

for (const modeText of ['مبسط', 'بيع مباشر', 'ربحية', 'متقدم']) {
  const ok = await selectQuick(page, 'نمط تحرير الفاتورة', modeText)
  await new Promise((r) => setTimeout(r, 700))
  const m = await page.evaluate(() => {
    const table = document.querySelector('.invoice-doc .invoice-lines-table')
    const head = [...(table?.querySelectorAll('thead th') ?? [])].find((th) => th.textContent.includes('الصنف'))
    const cell = document.querySelector('.invoice-doc [data-line-name-cell]')
    const wrap = table?.closest('.overflow-x-auto')
    const box = (e) => e ? Math.round(e.getBoundingClientRect().width) : 0
    const inner = cell?.querySelector('b')
    return {
      cols: table?.getAttribute('data-columns'),
      tableW: box(table), wrapW: wrap?.clientWidth ?? 0, wrapScroll: wrap?.scrollWidth ?? 0,
      headW: box(head), cellW: box(cell), innerW: box(inner),
      text: (cell?.textContent ?? '').trim().slice(0, 26),
      visible: cell ? (cell.getBoundingClientRect().width > 24) : false,
      headers: [...(table?.querySelectorAll('thead th') ?? [])].map((th) => `${th.textContent.trim().slice(0, 9)}:${Math.round(th.getBoundingClientRect().width)}`).join(' | '),
    }
  })
  console.log(`\n【${modeText}】 ${ok ? '' : '(لم يتغيّر)'} أعمدة=${m.cols} جدول=${m.tableW} صندوق=${m.wrapW}/${m.wrapScroll}`)
  console.log(`   عمود الاسم: رأس=${m.headW} خلية=${m.cellW} نص«${m.text}» ${m.visible ? '✓ ظاهر' : '✗ مختفٍ'}`)
  console.log(`   ${m.headers}`)
}
await page.screenshot({ path: process.env.OUT ?? '/home/user/namecol.png' })
await browser.close()
