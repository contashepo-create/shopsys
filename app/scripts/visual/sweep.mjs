/* مسح تجاوب شامل (بلاغ المالك ⑧⑨⑩): كل الأقسام × كل المقاسات.
   يفحص لكل صفحة: ① لا قسم يختفي من الشريط العلوي ② لا تمرير أفقي
   ③ لا عنصر مقصوص داخل صندوق يخفي الفائض ④ لا تداخل بصري بين عنصرين
   يشتركان في نفس سياق التموضع. تشغيل: node sweep.mjs [PORT] */
import { open } from './lib.mjs'

const PORT = process.env.PORT ?? process.argv[2] ?? '5173'
const SIZES = (process.env.SIZES ?? '1366x768,1280x720,1024x680').split(',').map((s) => s.split('x').map(Number))
const ROUTES = (process.env.ROUTES ?? [
  '/', '/pos', '/sales/invoices', '/sales/invoices/new', '/sales/returns', '/sales/shifts', '/sales/price-lists',
  '/purchases/invoices', '/purchases/invoices/new', '/purchases/suppliers', '/parties/customers',
  '/inventory/items', '/inventory/warehouses', '/inventory/transfers', '/inventory/counting',
  '/parties/employees', '/parties/payroll', '/parties/installments',
  '/accounting/journal', '/accounting/treasury', '/accounting/vouchers', '/accounting/cheques', '/accounting/coa',
  '/reports', '/reports/statements', '/branches', '/settings/general', '/settings/permissions',
].join(',')).split(',')
const WAIT = Number(process.env.WAIT ?? 3500)

function audit() {
  const notes = []
  /* عنصر «مطوي» داخل قسم مغلق (grid-rows-[0fr]/max-height:0) ليس مقصوصاً — إنه مخفي بإرادة المستخدم */
  const insideCollapsed = (el) => {
    let node = el.parentElement
    while (node && node !== document.body) {
      const s = getComputedStyle(node)
      if ((s.overflowY === 'hidden' || s.overflowY === 'clip' || s.overflowX === 'hidden' || s.overflowX === 'clip')
        && (node.clientHeight < 4 || node.clientWidth < 4)) return true
      node = node.parentElement
    }
    return false
  }
  /* ① الشريط العلوي: كل قسم إما ظاهر كاملاً داخل الشريط أو داخل «المزيد» */
  const strip = document.querySelector('.menubar-scroll')
  if (strip) {
    const sr = strip.getBoundingClientRect()
    const titles = [...strip.querySelectorAll('[data-menubar-title]')]
    const cut = titles.filter((el) => {
      const r = el.getBoundingClientRect()
      return r.right > sr.right + 1 || r.left < sr.left - 1
    }).map((el) => el.getAttribute('data-menubar-title'))
    if (cut.length) notes.push(`قسم مبتور من الشريط: ${cut.join('،')}`)
    const more = strip.querySelector('[data-menubar-more]')
    const overflowed = strip.scrollWidth - strip.clientWidth > 1
    if (overflowed && !more) notes.push('الشريط يفيض بلا زر «المزيد» ⇒ أقسام غير قابلة للوصول')
  }
  /* ② لا تمرير أفقي للصفحة */
  const hx = document.documentElement.scrollWidth - document.documentElement.clientWidth
  if (hx > 1) notes.push(`تمرير أفقي ${hx}px`)
  /* ③ نص مقصوص فعلاً: صندوق يخفي الفائض + بداخله نص في السياق العادي خارج حدوده.
     الزخارف المطلقة (أيقونة مائية داخل بطاقة) لا تُحتسب — قصّها مقصود. */
  const clipped = []
  for (const box of document.querySelectorAll('main *, .app-menubar *')) {
    if (box.classList.contains('menubar-scroll')) continue
    const s = getComputedStyle(box)
    if (s.display === 'none' || s.visibility === 'hidden') continue
    const hidX = s.overflowX === 'hidden' || s.overflowX === 'clip'
    const hidY = s.overflowY === 'hidden' || s.overflowY === 'clip'
    if (!hidX && !hidY) continue
    if (box.clientHeight < 4 || box.clientWidth < 4) continue
    if (insideCollapsed(box)) continue
    if (box.scrollWidth - box.clientWidth <= 1 && box.scrollHeight - box.clientHeight <= 1) continue
    const br = box.getBoundingClientRect()
    for (const el of box.querySelectorAll('*')) {
      if (el.children.length > 0) continue
      if (el.closest('.sr-only') || el.getAttribute('aria-hidden') === 'true') continue
      const es = getComputedStyle(el)
      if (es.display === 'none' || es.visibility === 'hidden' || Number(es.opacity) < 0.3) continue
      if (es.position === 'absolute' || es.position === 'fixed') continue
      if ((el.textContent || '').trim().length === 0) continue
      const r = el.getBoundingClientRect()
      const cutX = hidX && (r.right > br.right + 2 || r.left < br.left - 2)
      const cutY = hidY && (r.bottom > br.bottom + 2 || r.top < br.top - 2)
      if (cutX || cutY) { clipped.push(`${el.tagName.toLowerCase()}«${(el.textContent || '').trim().slice(0, 18)}»`); break }
    }
  }
  if (clipped.length) notes.push(`نص مقصوص(${clipped.length}): ${[...new Set(clipped)].slice(0, 4).join(' | ')}`)
  /* ④ تداخل بصري: ورقتان مرئيتان في نفس سياق التموضع تتقاطع مساحتاهما */
  const ctx = (el) => {
    let node = el.parentElement
    while (node) {
      const s = getComputedStyle(node)
      if (s.position !== 'static' || node.hasAttribute('data-app-window')) return node
      node = node.parentElement
    }
    return document.body
  }
  const leaves = [...document.querySelectorAll('main *, .app-menubar *')].filter((el) => {
    if (el.children.length > 0) return false
    if (el.closest('.sr-only') || el.getAttribute('aria-hidden') === 'true') return false
    const s = getComputedStyle(el)
    if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false
    const r = el.getBoundingClientRect()
    if (insideCollapsed(el)) return false
    return r.width > 6 && r.height > 6 && (el.textContent || '').trim().length > 0
  })
  const hits = []
  for (let i = 0; i < leaves.length && hits.length < 6; i++) {
    for (let j = i + 1; j < leaves.length && hits.length < 6; j++) {
      const a = leaves[i], b = leaves[j]
      if (a.contains(b) || b.contains(a)) continue
      if (ctx(a) !== ctx(b)) continue
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect()
      const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left)
      const oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top)
      if (ox > 3 && oy > 3) hits.push(`${a.tagName.toLowerCase()}«${(a.textContent || '').trim().slice(0, 14)}» ✕ ${b.tagName.toLowerCase()}«${(b.textContent || '').trim().slice(0, 14)}»`)
    }
  }
  if (hits.length) notes.push(`تداخل(${hits.length}): ${hits.slice(0, 3).join(' · ')}`)
  return notes
}

let bad = 0, total = 0
for (const [w, h] of SIZES) {
  console.log(`\n── ${w}×${h} ──`)
  for (const route of ROUTES) {
    total++
    const { browser, page } = await open(`http://localhost:${PORT}/#${route}`, w, h, WAIT)
    let notes = []
    try { notes = await page.evaluate(audit) } catch (error) { notes = [`تعذّر الفحص: ${error.message}`] }
    if (notes.length) bad++
    console.log(`${notes.length ? '✗' : '✓'} ${route}${notes.length ? '\n    ' + notes.join('\n    ') : ''}`)
    await browser.close()
  }
}
console.log(bad ? `\n❌ ${bad} من ${total} شاشة بها ملاحظات` : `\n✅ ${total}/${total} شاشة نظيفة`)
