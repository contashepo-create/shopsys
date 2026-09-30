/* فحص الفاتورة في حالاتها الحقيقية (بلاغ المالك: تداخل في الترويسة والتحصيل والجدول):
   يبذر أصنافاً وعميلاً ⇐ يضيف سطراً ⇐ يفتح لوحة التحصيل ⇐ يقيس التداخل والاقتصاص
   داخل نافذة الفاتورة فقط ⇐ يقيس توسيط خلايا الجدول ⇐ لقطة. */
import { open } from './lib.mjs'
const [w, h] = (process.env.SIZE ?? '1366x768').split('x').map(Number)
const out = process.env.OUT ?? '/home/user/inv-state.png'
const PORT = process.env.PORT || 5173
const { browser, page } = await open(`http://localhost:${PORT}/#/sales/invoices`, w, h, 6000)

const seeded = await page.evaluate(() => {
  const store = globalThis.__shopsysDev?.data
  if (!store) return { dev: false }
  const s = () => store.getState()
  if (!s().items.length) {
    s().seed(['basic'])
    const base = { barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true }
    s().addItem({ ...base, nameAr: 'أرز مصري 5 كجم', sku: 'RICE-5', costMinor: 12000, stockQty: 41, priceMinor: 15500 })
    s().addItem({ ...base, nameAr: 'زيت عباد الشمس 1 لتر', sku: 'OIL-1L', costMinor: 5200, stockQty: 40, priceMinor: 6500 })
    s().addItem({ ...base, nameAr: 'سكر ناعم 1 كجم', sku: 'SUG-1K', costMinor: 2800, stockQty: 6, priceMinor: 3200 })
  }
  if (!s().customers.length) {
    s().addCustomer({ nameAr: 'شركة الأمل', phone: '01000000001', notes: '', taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', building: '', district: '', openingBalanceMinor: 0, creditLimitMinor: 1500000 })
  }
  if (!s().paymentTerminals?.length) {
    try { s().addPaymentTerminal({ nameAr: 'الماكينة 1', treasury: '1102', provider: 'بنك مصر', feePercent: 0, settlementDays: 1, isActive: true }) } catch { /* موجودة */ }
  }
  return { dev: true, items: s().items.length, customers: s().customers.length, terminals: s().paymentTerminals?.length ?? 0 }
})
console.log('البذر:', JSON.stringify(seeded))
// نافذة واحدة فقط: تُفتح من زر «فاتورة مبيعات جديدة» ولا تُكرَّر (وإعادة التحميل تفقدها)
await page.evaluate(() => {
  if (document.querySelector('[data-window-kind="sales-invoice"]')) return
  const btn = [...document.querySelectorAll('button, a')].find((b) => b.textContent.includes('فاتورة مبيعات جديدة'))
  btn?.click()
})
await new Promise((r) => setTimeout(r, 4000))
console.log('نوافذ مفتوحة:', await page.evaluate(() => document.querySelectorAll('[data-app-window]').length))

// اختيار العميل من بطاقة الطرف
await page.evaluate(() => {
  const sel = document.querySelector('.invoice-doc select')
  if (sel && sel.options.length > 1) { sel.selectedIndex = 1; sel.dispatchEvent(new Event('change', { bubbles: true })) }
})
await new Promise((r) => setTimeout(r, 600))

// إدخال سطر: اسم الصنف ⇐ كمية ⇐ سعر
await page.evaluate(() => document.querySelector('.invoice-line-entry-cell input')?.focus())
await page.keyboard.type('أرز', { delay: 120 })
await new Promise((r) => setTimeout(r, 1000))
await page.keyboard.press('Enter')
await new Promise((r) => setTimeout(r, 800))
await page.keyboard.type('10', { delay: 100 })
await page.keyboard.press('Enter')
await new Promise((r) => setTimeout(r, 400))
await page.keyboard.type('155', { delay: 100 })
await page.keyboard.press('Enter')
await new Promise((r) => setTimeout(r, 900))

// وضع «احترافي — متقدم» (يُظهر شريط ترويسة الصنف ولوحات الاحتراف) + تحصيل متعدد
await page.evaluate(() => {
  const sel = document.querySelector('.invoice-doc select[aria-label="نمط تحرير الفاتورة"]')
  const target = sel && [...sel.options].find((o) => o.textContent.includes('متقدم'))
  if (sel && target) {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
    setter.call(sel, target.value)
    sel.dispatchEvent(new Event('change', { bubbles: true }))
  }
})
await new Promise((r) => setTimeout(r, 900))
// تركيز خلية صنف السطر الأول كي يمتلئ شريط «الصنف المحدد»
await page.evaluate(() => {
  const row = document.querySelector('.invoice-doc tbody tr[data-entry-row]')
  row?.querySelector('input')?.focus()
})
await new Promise((r) => setTimeout(r, 500))
// فتح «تحصيل متعدد» داخل لوحة التحصيل الآن
const multi = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('.invoice-doc button, .invoice-doc label')]
    .find((b) => /تحصيل متعدد|متعدد/.test(b.textContent ?? ''))
  if (!btn) return false
  btn.click(); return true
})
console.log('تحصيل متعدد:', multi)
await new Promise((r) => setTimeout(r, 900))

const state = await page.evaluate(() => ({
  rows: document.querySelectorAll('.invoice-doc tbody tr[data-entry-row]').length,
  total: document.querySelector('.invoice-table-total')?.textContent ?? null,
}))
console.log('الحالة:', JSON.stringify(state))

// قياس التوسيط داخل خلايا الجدول
const cells = await page.evaluate(() => {
  const row = document.querySelector('.invoice-doc tbody tr[data-entry-row]')
  if (!row) return []
  return [...row.children].map((td, i) => {
    const rt = td.getBoundingClientRect()
    const inner = td.querySelector('input, select, .invoice-table-total, b, span') ?? td
    const ri = inner.getBoundingClientRect()
    const gapStart = ri.left - rt.left
    const gapEnd = rt.right - ri.right
    return {
      i, cls: String(td.className).split(' ').filter((c) => c.includes('cell') || c.startsWith('w-')).join('.'),
      text: (td.textContent ?? '').trim().slice(0, 14) || (inner.value ?? ''),
      off: Math.round(gapStart - gapEnd), // 0 = موسّط تماماً
      w: Math.round(rt.width), iw: Math.round(ri.width),
      overflow: Math.round(Math.max(0, ri.right - rt.right, rt.left - ri.left)),
    }
  })
})
console.log('خلايا السطر:')
for (const c of cells) console.log(`   #${c.i} ${c.cls || '—'} «${c.text}» عرض=${c.w} داخلي=${c.iw} انحراف=${c.off} تجاوز=${c.overflow}`)

// التداخل والاقتصاص داخل نافذة الفاتورة فقط
const probe = await page.evaluate(() => {
  const root = document.querySelector('.invoice-doc') ?? document.body
  const label = (el) => {
    const cls = String(el.className ?? '').split(' ').filter(Boolean).slice(0, 2).join('.')
    const txt = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 24)
    return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}«${txt}»`
  }
  const vis = (el) => {
    const s = getComputedStyle(el)
    if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) < 0.05) return false
    const r = el.getBoundingClientRect()
    return r.width > 1 && r.height > 1
  }
  const all = [...root.querySelectorAll('*')].filter((el) => !el.closest('.sr-only') && vis(el))
  const leaves = all.filter((el) => !el.children.length && (el.textContent ?? '').trim() && el.getAttribute('aria-hidden') !== 'true')
  const clipped = []
  for (const box of all) {
    const s = getComputedStyle(box)
    const hx = s.overflowX === 'hidden' || s.overflowX === 'clip'
    const hy = s.overflowY === 'hidden' || s.overflowY === 'clip'
    if (!hx && !hy) continue
    const rb = box.getBoundingClientRect()
    const cut = leaves.filter((t) => {
      if (!box.contains(t)) return false
      const rt = t.getBoundingClientRect()
      return (hx && (rt.right > rb.right + 2 || rt.left < rb.left - 2)) || (hy && (rt.bottom > rb.bottom + 2 || rt.top < rb.top - 2))
    })
    if (cut.length) clipped.push(`${label(box)} ⇐ ${cut.slice(0, 2).map(label).join(' , ')}`)
  }
  const layerOf = (el) => {
    let p = el
    while (p && p !== root) {
      const st = getComputedStyle(p)
      if (st.position === 'fixed' || st.position === 'absolute' || st.position === 'sticky') return p
      p = p.parentElement
    }
    return root
  }
  const layers = new Map(leaves.map((el) => [el, layerOf(el)]))
  const overlaps = []
  for (let i = 0; i < leaves.length; i++) {
    const a = leaves[i], ra = a.getBoundingClientRect()
    for (let j = i + 1; j < leaves.length; j++) {
      const b = leaves[j]
      if (a.contains(b) || b.contains(a) || layers.get(a) !== layers.get(b)) continue
      const rb = b.getBoundingClientRect()
      const ix = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left)
      const iy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top)
      if (ix <= 2 || iy <= 2) continue
      if (ix * iy > Math.min(ra.width * ra.height, rb.width * rb.height) * 0.25) overlaps.push(`${label(a)} ⨯ ${label(b)}`)
    }
  }
  return { clipped: [...new Set(clipped)], overlaps: [...new Set(overlaps)] }
})
console.log('مقصوص:', probe.clipped.length ? '\n   ' + probe.clipped.join('\n   ') : 'لا شيء')
console.log('متداخل:', probe.overlaps.length ? '\n   ' + probe.overlaps.join('\n   ') : 'لا شيء')

await page.screenshot({ path: out })
console.log('لقطة:', out)
await browser.close()
