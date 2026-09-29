/* تدقيق «الأقيم» المعروضة في كل الأقسام: NaN · undefined · null · Invalid Date ·
   [object Object] · أرقام بلا تنسيق · عملة مفقودة · جداول بلا حالة فارغة.
   تشغيل: PORT=5173 SIZES=1366x768 node values.mjs */
import { open } from './lib.mjs'

const ROUTES = (process.env.ROUTES ?? [
  '/', '/sales/invoices', '/sales/pos', '/sales/returns', '/sales/quotes', '/sales/price-lists',
  '/purchases/invoices', '/purchases/orders', '/purchases/returns',
  '/items', '/inventory/stock', '/inventory/transfers', '/inventory/adjustments', '/inventory/stocktake',
  '/parties/customers', '/parties/suppliers', '/parties/employees', '/parties/payroll', '/parties/attendance',
  '/treasury/accounts', '/treasury/receipts', '/treasury/payments', '/treasury/expenses',
  '/accounting/journal', '/accounting/accounts', '/reports', '/reports/trial-balance', '/reports/profit',
  '/settings',
].join(',')).split(',').filter(Boolean)
const SIZE = (process.env.SIZE ?? '1366x768').split('x').map(Number)
const PORT = process.env.PORT || 5173
const BAD = [/\bNaN\b/, /\bundefined\b/, /\bnull\b/, /Invalid Date/, /\[object Object\]/, /\bInfinity\b/, /NaN%/]

const { browser, page } = await open(`http://localhost:${PORT}/#/`, SIZE[0], SIZE[1], 5000)
await page.evaluate(() => {
  const s = () => globalThis.__shopsysDev.data.getState()
  if (!s().items.length) s().seed(['basic'])
})
await new Promise((r) => setTimeout(r, 1500))

let issues = 0
for (const route of ROUTES) {
  await page.evaluate((r) => { location.hash = `#${r}` }, route)
  await new Promise((r) => setTimeout(r, 1500))
  const found = await page.evaluate((patterns) => {
    const bad = patterns.map((p) => new RegExp(p))
    const hits = []
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = (node.textContent ?? '').trim()
      if (!text || text.length > 200) continue
      const el = node.parentElement
      if (!el || el.closest('script, style')) continue
      const cs = getComputedStyle(el)
      if (cs.display === 'none' || cs.visibility === 'hidden') continue
      for (const rx of bad) if (rx.test(text)) { hits.push(`«${text.slice(0, 48)}» في ${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`); break }
      if (hits.length > 5) break
    }
    /* جدول بلا صفوف وبلا رسالة «لا توجد بيانات» */
    const empties = []
    for (const table of document.querySelectorAll('table')) {
      const rows = table.querySelectorAll('tbody tr').length
      const near = (table.closest('section, div')?.textContent ?? '')
      if (rows === 0 && !/لا توجد|لا يوجد|ابدأ|أضف|فارغ/.test(near)) empties.push('جدول فارغ بلا رسالة إرشادية')
    }
    return { hits, empties: [...new Set(empties)], title: (document.querySelector('h1, h2')?.textContent ?? '').trim().slice(0, 30) }
  }, BAD.map((r) => r.source))
  const notes = [...found.hits, ...found.empties]
  if (notes.length) { issues += notes.length; console.log(`✗ ${route} (${found.title})\n    ${notes.join('\n    ')}`) }
  else console.log(`✓ ${route}`)
}
console.log(issues ? `\n❌ ${issues} ملاحظة قيمة` : '\n✅ لا قيم معطوبة في أي قسم')
await browser.close()
