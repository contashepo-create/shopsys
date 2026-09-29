/* ميزانية ارتفاع اللوحات الثلاث: ما الذي يستهلك الارتفاع في «التحصيل الآن»؟ */
import { open } from './lib.mjs'
const [w, h] = (process.env.SIZE ?? '1366x768').split('x').map(Number)
const PORT = process.env.PORT || 5173
const { browser, page } = await open(`http://localhost:${PORT}/#/sales/invoices`, w, h, 6000)
await page.evaluate(() => {
  const s = () => globalThis.__shopsysDev.data.getState()
  if (!s().items.length) s().seed(['basic'])
  if (!document.querySelector('[data-window-kind="sales-invoice"]'))
    [...document.querySelectorAll('button, a')].find((b) => b.textContent.includes('فاتورة مبيعات جديدة'))?.click()
})
await new Promise((r) => setTimeout(r, 3500))
await page.evaluate(() => {
  const sel = document.querySelector('.invoice-doc select[aria-label="نمط تحرير الفاتورة"]')
  const t = sel && [...sel.options].find((o) => o.textContent.includes('متقدم'))
  if (sel && t) { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, t.value); sel.dispatchEvent(new Event('change', { bubbles: true })) }
  const btn = [...document.querySelectorAll('.invoice-doc button, .invoice-doc label')].find((b) => /تحصيل متعدد/.test(b.textContent ?? ''))
  btn?.click()
})
await new Promise((r) => setTimeout(r, 1200))
const out = await page.evaluate(() => {
  const panels = [...document.querySelectorAll('.invoice-doc-panel')]
  const pick = panels.find((p) => /التحصيل الآن/.test(p.textContent ?? '')) ?? panels[0]
  const kids = [...(pick?.querySelectorAll(':scope > *, :scope > .invoice-doc-panel-body > *') ?? [])]
  const grid = document.querySelector('.invoice-doc .invoice-body-grid')
  const doc = document.querySelector('.invoice-doc')
  return {
    root: getComputedStyle(document.documentElement).fontSize,
    win: { vh: innerHeight, docH: Math.round(doc?.getBoundingClientRect().height ?? 0) },
    grid: { rows: getComputedStyle(grid).gridTemplateRows, h: grid.clientHeight, sh: grid.scrollHeight, over: grid.scrollHeight - grid.clientHeight },
    panelH: Math.round(pick?.getBoundingClientRect().height ?? 0),
    parts: kids.map((k) => ({ cls: String(k.className).split(' ').slice(0, 2).join('.').slice(0, 34), t: (k.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 22), h: Math.round(k.getBoundingClientRect().height) })),
  }
})
console.log(JSON.stringify(out, null, 1)); await browser.close()
