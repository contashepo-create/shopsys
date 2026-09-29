/* مراجعة شاملة لكل أنواع النوافذ: تفتحها واحدة فوق الأخرى وتفحص لكل نافذة
   (١) بقاءها داخل الشاشة (٢) عدم اقتصاص نصها (٣) عدم تداخل عناصرها.
   تشغيل: PORT=5173 SIZE=1024x680 node winsuite.mjs */
import { open } from './lib.mjs'

const [w, h] = (process.env.SIZE ?? '1024x680').split('x').map(Number)
const PORT = process.env.PORT || 5173
const { browser, page } = await open(`http://localhost:${PORT}/#/sales/invoices`, w, h, 6000)

await page.evaluate(() => {
  const s = () => globalThis.__shopsysDev.data.getState()
  if (!s().items.length) s().seed(['basic'])
  const base = { barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isService: false, active: true, notes: '', imageUrl: '', taxable: true }
  try { s().addItem({ ...base, nameAr: 'أرز مصري 5 كجم', sku: 'RICE-5', costMinor: 12000, stockQty: 41, priceMinor: 15500 }) } catch { /* موجود */ }
  if (!s().customers.length) {
    try {
      s().addCustomer({ nameAr: 'شركة الأمل', phone: '01000000001', notes: '', taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', building: '', district: '', openingBalanceMinor: 0, creditLimitMinor: 0, priceListId: null, categoryId: null, active: true })
    } catch { /* موجود */ }
  }
})
await new Promise((r) => setTimeout(r, 1200))
await page.evaluate(() => {
  if (!document.querySelector('[data-app-window]')) [...document.querySelectorAll('button, a')].find((b) => b.textContent.includes('فاتورة مبيعات جديدة'))?.click()
})
await new Promise((r) => setTimeout(r, 3500))

/** فحص نافذة واحدة: داخل الشاشة · بلا اقتصاص نص · بلا تداخل */
const inspect = async (label) => {
  const out = await page.evaluate(() => {
    const wins = [...document.querySelectorAll('[data-app-window]')]
    const win = wins[wins.length - 1]
    if (!win) return { missing: true }
    const wr = win.getBoundingClientRect()
    const notes = []
    if (wr.left < -2 || wr.top < -2 || wr.right > innerWidth + 2 || wr.bottom > innerHeight + 2)
      notes.push(`خارج الشاشة (${Math.round(wr.left)},${Math.round(wr.top)} ${Math.round(wr.width)}×${Math.round(wr.height)} في ${innerWidth}×${innerHeight})`)
    const visibleRect = (el) => {
      const r = el.getBoundingClientRect()
      let rect = { top: r.top, bottom: r.bottom, left: r.left, right: r.right }
      let n = el.parentElement
      while (n) {
        const s = getComputedStyle(n)
        if (s.overflowY !== 'visible' || s.overflowX !== 'visible') {
          const b = n.getBoundingClientRect()
          rect = { top: Math.max(rect.top, b.top), bottom: Math.min(rect.bottom, b.bottom), left: Math.max(rect.left, b.left), right: Math.min(rect.right, b.right) }
          if (rect.bottom - rect.top <= 1 || rect.right - rect.left <= 1) return null
        }
        n = n.parentElement
      }
      return rect
    }
    /* نص مقصوص: صندوق يخفي الفائض بلا تمرير، وبداخله نص خارج حدوده */
    for (const box of win.querySelectorAll('*')) {
      const s = getComputedStyle(box)
      const hidX = s.overflowX === 'hidden' || s.overflowX === 'clip'
      const hidY = s.overflowY === 'hidden' || s.overflowY === 'clip'
      if (!hidX && !hidY) continue
      if (box.clientHeight < 4 || box.clientWidth < 4) continue
      if (box.scrollWidth - box.clientWidth <= 1 && box.scrollHeight - box.clientHeight <= 1) continue
      const br = box.getBoundingClientRect()
      for (const el of box.querySelectorAll('*')) {
        if (el.children.length || !(el.textContent ?? '').trim()) continue
        const es = getComputedStyle(el)
        if (es.position === 'absolute' || es.position === 'fixed' || es.display === 'none' || es.visibility === 'hidden') continue
        if (Number(es.opacity) < 0.3 || el.getAttribute('aria-hidden') === 'true') continue
        const r = el.getBoundingClientRect()
        if ((hidX && (r.right > br.right + 2 || r.left < br.left - 2)) || (hidY && (r.bottom > br.bottom + 2 || r.top < br.top - 2))) {
          notes.push(`نص مقصوص «${el.textContent.trim().slice(0, 20)}»'`)
          break
        }
      }
      if (notes.length > 3) break
    }
    /* تداخل بصري */
    const ctx = (el) => { let n = el.parentElement; while (n) { const s = getComputedStyle(n); if (s.position !== 'static') return n; n = n.parentElement } return document.body }
    const adornment = (a, b) => {
      const [field, mark] = a.tagName === 'INPUT' || a.tagName === 'SELECT' ? [a, b] : [b, a]
      if (field.tagName !== 'INPUT' && field.tagName !== 'SELECT') return false
      if (getComputedStyle(mark).position === 'static') return false
      const cs = getComputedStyle(field)
      const pad = Math.max(parseFloat(cs.paddingInlineEnd) || 0, parseFloat(cs.paddingInlineStart) || 0)
      return mark.getBoundingClientRect().width <= pad + 2
    }
    const leaves = [...win.querySelectorAll('*')].filter((el) => {
      const cs = getComputedStyle(el)
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.2) return false
      const r = el.getBoundingClientRect()
      if (r.width < 4 || r.height < 4) return false
      if (!(el.value ?? el.textContent ?? '').trim()) return false
      return el.children.length === 0 || el.tagName === 'INPUT' || el.tagName === 'SELECT'
    })
    let hits = 0
    for (let i = 0; i < leaves.length && hits < 3; i++) for (let j = i + 1; j < leaves.length && hits < 3; j++) {
      const a = leaves[i], b = leaves[j]
      if (a.contains(b) || b.contains(a) || ctx(a) !== ctx(b) || adornment(a, b)) continue
      const ra = visibleRect(a), rb = visibleRect(b)
      if (!ra || !rb) continue
      const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left)
      const oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top)
      if (ox > 2 && oy > 2) { hits++; notes.push(`تداخل «${(a.value ?? a.textContent).trim().slice(0, 14)}» ✕ «${(b.value ?? b.textContent).trim().slice(0, 14)}»`) }
    }
    return { kind: win.getAttribute('data-window-kind'), count: wins.length, notes }
  })
  if (out.missing) { console.log(`✗ ${label}: لم تُفتح النافذة`); return false }
  const ok = out.notes.length === 0
  console.log(`${ok ? '✓' : '✗'} ${label} [${out.kind}] نوافذ=${out.count}${ok ? '' : '\n    ' + out.notes.join('\n    ')}`)
  return ok
}

let bad = 0
if (!await inspect('نافذة الفاتورة')) bad++

// منتقي الصنف من خلية الاسم
await page.evaluate(() => document.querySelector('.invoice-line-entry-cell input')?.focus())
await page.keyboard.type('أرز', { delay: 120 })
await new Promise((r) => setTimeout(r, 1500))
if (!await inspect('منتقي الصنف')) bad++

for (const [label, sel] of [['تعديل الصنف', '[data-item-picker-edit]'], ['حركة الصنف', '[data-item-picker-movement]'], ['أسعار الصنف', '[data-item-picker-prices]']]) {
  const opened = await page.evaluate((sel) => { const b = document.querySelector(sel); if (!b) return false; b.click(); return true }, sel)
  if (!opened) { console.log(`— ${label}: لا زر`); continue }
  await new Promise((r) => setTimeout(r, 1600))
  if (!await inspect(label)) bad++
  await page.keyboard.press('Escape')
  await new Promise((r) => setTimeout(r, 900))
}

await page.screenshot({ path: process.env.OUT ?? '/home/user/winsuite.png' })
console.log(bad ? `\n❌ ${bad} نافذة بها ملاحظات` : '\n✅ كل النوافذ نظيفة')
await browser.close()
