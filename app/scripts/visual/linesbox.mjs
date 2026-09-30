/* تشخيص عمود البنود: هل ترويسة اللوحة داخل صندوق التمرير؟ وكم ارتفاع كل جزء؟ */
import { open } from './lib.mjs'
const [w, h] = (process.env.SIZE ?? '1366x768').split('x').map(Number)
const PORT = process.env.PORT || 5173
const { browser, page } = await open(`http://localhost:${PORT}/#/sales/invoices`, w, h, 6000)
await page.evaluate(() => {
  const store = globalThis.__shopsysDev?.data; const s = () => store.getState()
  if (!s().items.length) { s().seed(['basic']) }
  if (document.querySelector('[data-window-kind="sales-invoice"]')) return
  ;[...document.querySelectorAll('button, a')].find((b) => b.textContent.includes('فاتورة مبيعات جديدة'))?.click()
})
await new Promise((r) => setTimeout(r, 3500))
await page.evaluate(() => {
  const sel = document.querySelector('.invoice-doc select[aria-label="نمط تحرير الفاتورة"]')
  const t = sel && [...sel.options].find((o) => o.textContent.includes('متقدم'))
  if (sel && t) { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, t.value); sel.dispatchEvent(new Event('change', { bubbles: true })) }
})
await new Promise((r) => setTimeout(r, 1200))
const r = await page.evaluate(() => {
  const box = (sel) => { const e = document.querySelector(sel); if (!e) return null
    const b = e.getBoundingClientRect(); const cs = getComputedStyle(e)
    return { sel, top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height), ch: e.clientHeight, sh: e.scrollHeight, st: e.scrollTop, ov: cs.overflowY, pos: cs.position, minH: cs.minHeight } }
  const scroll = document.querySelector('.invoice-lines-scroll') ?? document.querySelector('.invoice-lines-panel .overflow-y-auto')
  const head = document.querySelector('.invoice-lines-panel .invoice-doc-panel-head') ?? document.querySelector('.invoice-lines-panel > div')
  const thead = document.querySelector('.invoice-lines-table thead')
  return {
    parts: ['.invoice-doc', '.invoice-body-grid', '.invoice-lines-column', '.invoice-lines-panel', '.invoice-lines-table'].map(box),
    scroll: scroll ? { cls: String(scroll.className).slice(0, 60), top: Math.round(scroll.getBoundingClientRect().top), h: scroll.clientHeight, sh: scroll.scrollHeight, ov: getComputedStyle(scroll).overflowY } : null,
    head: head ? { cls: String(head.className).slice(0, 60), top: Math.round(head.getBoundingClientRect().top), h: Math.round(head.getBoundingClientRect().height), insideScroll: !!(scroll && scroll.contains(head)) } : null,
    thead: thead ? { top: Math.round(thead.getBoundingClientRect().top), pos: getComputedStyle(thead.querySelector('th')).position } : null,
    panels: [...document.querySelectorAll('.invoice-doc-panel')].map((p) => ({ t: (p.querySelector('b')?.textContent ?? '').slice(0, 18), h: Math.round(p.getBoundingClientRect().height) })),
    win: { h: innerHeight, docH: Math.round(document.querySelector('.invoice-doc')?.getBoundingClientRect().height ?? 0) },
  }
})
const extra = await page.evaluate(() => {
  const wrap = document.querySelector('.invoice-doc .invoice-lines-panel .overflow-x-auto')
  const grid = document.querySelector('.invoice-doc .invoice-body-grid')
  const g = grid && getComputedStyle(grid)
  const cs = wrap && getComputedStyle(wrap)
  return {
    wrap: wrap ? { cls: String(wrap.className).slice(0, 50), ovx: cs.overflowX, ovy: cs.overflowY, maxH: cs.maxHeight, minH: cs.minHeight, h: wrap.clientHeight, sh: wrap.scrollHeight, flex: cs.flex } : null,
    grid: g ? { rows: g.gridTemplateRows, ovy: g.overflowY, h: grid.clientHeight, sh: grid.scrollHeight } : null,
    rowsVisible: document.querySelectorAll('.invoice-doc tbody tr').length,
  }
})
console.log(JSON.stringify({ ...r, ...extra }, null, 1)); await browser.close()
