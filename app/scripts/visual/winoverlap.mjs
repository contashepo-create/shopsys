/* تداخل داخل نوافذ التطبيق (المحتوى يُركَّب على body عبر Portal فلا تكفي main) */
import { open } from './lib.mjs'
const [w, h] = (process.env.SIZE ?? '1024x680').split('x').map(Number)
const PORT = process.env.PORT || 5173
const { browser, page } = await open(`http://localhost:${PORT}/#/sales/invoices`, w, h, 5500)
await page.evaluate(() => {
  const s = () => globalThis.__shopsysDev.data.getState()
  if (!s().items.length) s().seed(['basic'])
  if (!document.querySelector('[data-window-kind="sales-invoice"]'))
    [...document.querySelectorAll('button, a')].find((b) => b.textContent.includes('فاتورة مبيعات جديدة'))?.click()
})
await new Promise((r) => setTimeout(r, 3500))
const out = await page.evaluate(() => {
  const win = document.querySelector('[data-app-window]')
  const leaves = [...win.querySelectorAll('*')].filter((el) => {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.2) return false
    const r = el.getBoundingClientRect()
    if (r.width < 4 || r.height < 4) return false
    const text = (el.value ?? el.textContent ?? '').trim()
    if (!text) return false
    return el.children.length === 0 || el.tagName === 'INPUT' || el.tagName === 'SELECT'
  })
  const ctx = (el) => { let n = el.parentElement; while (n) { const s = getComputedStyle(n); if (s.position !== 'static') return n; n = n.parentElement } return document.body }
  /* المستطيل المرئي فعلاً = تقاطع العنصر مع كل أسلافه التي تخفي الفائض */
  const visibleRect = (el) => {
    let r = el.getBoundingClientRect()
    let rect = { top: r.top, bottom: r.bottom, left: r.left, right: r.right }
    let n = el.parentElement
    while (n) {
      const s = getComputedStyle(n)
      if (s.overflowY !== 'visible' || s.overflowX !== 'visible') {
        const b = n.getBoundingClientRect()
        rect = {
          top: Math.max(rect.top, b.top), bottom: Math.min(rect.bottom, b.bottom),
          left: Math.max(rect.left, b.left), right: Math.min(rect.right, b.right),
        }
        if (rect.bottom - rect.top <= 1 || rect.right - rect.left <= 1) return null
      }
      n = n.parentElement
    }
    return rect
  }
  /* زخرفة ملحقة بحقل (رمز العملة داخل حشوة الحقل) ليست تداخلاً */
  const adornment = (a, b) => {
    const [field, mark] = a.tagName === 'INPUT' || a.tagName === 'SELECT' ? [a, b] : [b, a]
    if (field.tagName !== 'INPUT' && field.tagName !== 'SELECT') return false
    if (getComputedStyle(mark).position === 'static') return false
    const cs = getComputedStyle(field)
    const pad = Math.max(parseFloat(cs.paddingInlineEnd) || 0, parseFloat(cs.paddingInlineStart) || 0)
    return mark.getBoundingClientRect().width <= pad + 2
  }
  const hits = []
  for (let i = 0; i < leaves.length; i++) for (let j = i + 1; j < leaves.length; j++) {
    const a = leaves[i], b = leaves[j]
    if (a.contains(b) || b.contains(a) || ctx(a) !== ctx(b)) continue
    if (adornment(a, b)) continue
    const ra = visibleRect(a), rb = visibleRect(b)
    if (!ra || !rb) continue
    const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left)
    const oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top)
    if (ox > 2 && oy > 2) hits.push(`${a.tagName}«${(a.value ?? a.textContent).trim().slice(0, 18)}» ✕ ${b.tagName}«${(b.value ?? b.textContent).trim().slice(0, 18)}» (${Math.round(ox)}×${Math.round(oy)})`)
  }
  return [...new Set(hits)]
})
console.log(out.length ? out.join('\n') : '✅ لا تداخل داخل النافذة')
await browser.close()
