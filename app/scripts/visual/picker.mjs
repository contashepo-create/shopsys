/* تحقق حي من البند ⑦: نافذة اختيار الصنف الغنية (أعمدة + فلاتر) داخل الفاتورة. */
import { open } from './lib.mjs'
const PORT = process.env.PORT || 5174
const { browser, page } = await open(`http://localhost:${PORT}/#/sales/invoices/new`, 1600, 950, 9000)

// بذر بيانات تجريبية (DEV فقط)
await page.evaluate(() => {
  const S = globalThis.__shopsysDev?.data?.getState?.()
  if (!S) return 'no-dev'
  if (!S.items.length) S.seed(['basic'])
  const st = globalThis.__shopsysDev.data.getState()
  if (st.items.length < 6) {
    const cats = st.categories
    const mk = (nameAr, sku, categoryId, costMinor, priceMinor, stockQty) => globalThis.__shopsysDev.data.getState().addItem({
      nameAr, sku, barcodes: [], categoryId, baseUnit: 'قطعة', extraUnits: [], costMinor, stockQty, priceMinor,
      minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false,
      variantColors: [], variantSizes: [], isActive: true,
    })
    mk('زيت عباد الشمس 1 لتر', 'OIL-1', cats[0]?.id ?? 1, 4500, 6000, 42)
    mk('أرز مصري 5 كجم', 'RICE-5', cats[0]?.id ?? 1, 12000, 15500, 0)
    mk('سكر ناعم 1 كجم', 'SUG-1', cats[1]?.id ?? cats[0]?.id ?? 1, 2800, 3600, 130)
    mk('شاي أكياس 100', 'TEA-100', cats[1]?.id ?? cats[0]?.id ?? 1, 5200, 7000, 18)
  }
  return 'seeded'
}).then((r) => console.log('بذر:', r))
await page.evaluate(() => { window.location.hash = '#/sales/invoices/new' })
await new Promise((r) => setTimeout(r, 2500))

const cell = await page.$('.invoice-line-entry-cell input')
if (!cell) { console.log('❌ لا توجد خلية إدخال'); await browser.close(); process.exit(1) }
await cell.click()
await new Promise((r) => setTimeout(r, 300))
await page.keyboard.type('ز', { delay: 150 })
await new Promise((r) => setTimeout(r, 1500))
const info = await page.evaluate(() => {
  const dlg = document.querySelector('.invoice-search-dialog')
  const head = document.querySelector('[data-item-picker-head]')
  const row = document.querySelector('.invoice-item-result-row')
  const r = (el) => el ? el.getBoundingClientRect() : null
  return {
    dialog: !!dlg, filters: !!document.querySelector('[data-item-picker-filters]'),
    category: !!document.querySelector('[data-item-picker-category]'),
    available: !!document.querySelector('[data-item-picker-available]'),
    head: head ? head.textContent.trim().replace(/\s+/g, ' ') : null,
    rows: document.querySelectorAll('.invoice-item-result-row').length,
    firstRow: row ? row.textContent.trim().replace(/\s+/g, ' ') : null,
    cols: row ? getComputedStyle(row).gridTemplateColumns : null,
    width: Math.round(r(dlg)?.width ?? 0),
    clipped: dlg ? dlg.scrollHeight > dlg.clientHeight + 2 && ['hidden', 'clip'].includes(getComputedStyle(dlg).overflowY) : null,
    dimmed: document.querySelectorAll('.app-window-backdrop, .layer-modal-backdrop').length,
  }
})
console.log(JSON.stringify(info, null, 1))
await page.screenshot({ path: process.env.OUT ?? '/home/user/picker1.png' })

// نافذة «حركة الصنف» فوق الفاتورة بلا فقد النافذة الأم
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('.invoice-search-dialog button')].find((b) => b.textContent.includes('حركة الصنف'))
  btn?.click()
})
await new Promise((r) => setTimeout(r, 2200))
const nested = await page.evaluate(() => ({
  windows: document.querySelectorAll('.app-window').length,
  ledger: !!document.querySelector('[data-window-view="item-ledger"]'),
  filters: !!document.querySelector('[data-ledger-filters]'),
  from: document.querySelector('[data-ledger-from]')?.value ?? null,
  to: document.querySelector('[data-ledger-to]')?.value ?? null,
  warehouses: document.querySelector('[data-ledger-warehouse]')?.options?.length ?? 0,
  invoiceAlive: document.querySelectorAll('.invoice-doc').length,
  dimmed: document.querySelectorAll('.app-window-backdrop, .layer-modal-backdrop').length,
  clippedFilters: [...document.querySelectorAll('[data-ledger-filters] input, [data-ledger-filters] select')].filter((el) => el.scrollWidth > el.clientWidth + 1).length,
}))
console.log('نافذة الحركة فوق الفاتورة:', JSON.stringify(nested))
await page.screenshot({ path: process.env.OUT2 ?? '/home/user/ledgerwin.png' })
await browser.close()
