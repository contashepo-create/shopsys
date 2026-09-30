/* ماسح التداخل والاقتصاص لكل الشاشات والمقاسات (بلاغ المالك: «أجزاء لا تظهر» و«تداخل»).
   لكل مسار × مقاس: يكشف (١) عناصر مقصوصة فعلاً داخل صندوق يخفي الفائض،
   (٢) عناصر تخرج عن حدود النافذة أفقياً، (٣) أزواج نصوص متداخلة بصرياً.
   التشغيل: ROUTES=a,b SIZES=1280x720 node audit.mjs */
import { open } from './lib.mjs'

const DEFAULT_ROUTES = [
  '/', '/sales/invoices/new', '/sales/invoices', '/sales/pos', '/purchases/invoices/new', '/purchases/invoices',
  '/items', '/inventory/warehouses', '/inventory/stocktake', '/parties/customers', '/parties/suppliers',
  '/parties/employees', '/parties/payroll', '/treasury/accounts', '/treasury/receipts', '/treasury/payments',
  '/reports', '/reports/trial-balance', '/reports/profit', '/accounting/journal', '/settings',
]
const DEFAULT_SIZES = ['1920x1080', '1440x900', '1280x720', '1152x720', '1024x680', '900x640']
const routes = (process.env.ROUTES ?? DEFAULT_ROUTES.join(',')).split(',').filter(Boolean)
const sizes = (process.env.SIZES ?? DEFAULT_SIZES.join(',')).split(',').filter(Boolean).map((s) => s.split('x').map(Number))
const PORT = process.env.PORT || 5173
const WAIT = Number(process.env.WAIT ?? 4500)
const LIMIT = Number(process.env.LIMIT ?? 6)

const probe = () => {
  const label = (el) => {
    const cls = String(el.className ?? '').split(' ').filter(Boolean).slice(0, 2).join('.')
    const txt = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 26)
    return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}${txt ? `«${txt}»` : ''}`
  }
  const vis = (el) => {
    const s = getComputedStyle(el)
    if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) < 0.05) return false
    const r = el.getBoundingClientRect()
    return r.width > 1 && r.height > 1
  }
  const all = [...document.querySelectorAll('body *')].filter((el) => !el.closest('.sr-only') && vis(el))

  // ① اقتصاص فعلي لنص: صندوق يخفي الفائض وبداخله نص يخرج عن حدوده ⇒ جزء لا يظهر
  const leavesAll = all.filter((el) => !el.children.length && (el.textContent ?? '').trim() && el.getAttribute('aria-hidden') !== 'true' && !el.closest('[aria-hidden="true"]'))
  const clipped = []
  for (const box of all) {
    const s = getComputedStyle(box)
    const hx = s.overflowX === 'hidden' || s.overflowX === 'clip'
    const hy = s.overflowY === 'hidden' || s.overflowY === 'clip'
    if (!hx && !hy) continue
    if (box.scrollWidth - box.clientWidth <= 2 && box.scrollHeight - box.clientHeight <= 2) continue
    const rb = box.getBoundingClientRect()
    const cut = leavesAll.filter((t) => {
      if (!box.contains(t) || t === box) return false
      const rt = t.getBoundingClientRect()
      return (hx && (rt.right > rb.right + 2 || rt.left < rb.left - 2)) || (hy && (rt.bottom > rb.bottom + 2 || rt.top < rb.top - 2))
    })
    if (cut.length) clipped.push(`${label(box)} ⇐ يقص ${cut.length}: ${cut.slice(0, 2).map(label).join(' , ')}`)
  }

  // ② خروج أفقي عن النافذة لنص (التمرير الرأسي للصفحة طبيعي فلا يُحسب)
  const vw = document.documentElement.clientWidth
  const offscreen = leavesAll.filter((el) => {
    const r = el.getBoundingClientRect()
    return r.left < -4 || r.right > vw + 4
  }).map((el) => {
    const r = el.getBoundingClientRect()
    return `${label(el)} [${Math.round(r.left)}..${Math.round(r.right)}]`
  })

  // ③ تداخل بصري بين نصين ليسا في علاقة احتواء ولا مكدّسين عمداً
  const leaves = leavesAll.filter((el) => {
    const st = getComputedStyle(el)
    return st.position !== 'absolute' && st.position !== 'fixed' && !el.closest('[data-allow-overlap]')
  })
  // الطبقة: نافذة عائمة/حوار/عنصر مطلق — لا يُقارن نص بطبقة أخرى فوقه أو تحته
  const layerOf = (el) => {
    let p = el
    while (p && p !== document.body) {
      if (p.matches('[data-window-id], [role="dialog"], .app-window, [data-window-taskbar]')) return p
      const st = getComputedStyle(p)
      if (st.position === 'fixed' || st.position === 'absolute' || st.position === 'sticky') return p
      p = p.parentElement
    }
    return document.body
  }
  const layers = new Map(leaves.map((el) => [el, layerOf(el)]))
  const overlaps = []
  for (let i = 0; i < leaves.length; i++) {
    const a = leaves[i], ra = a.getBoundingClientRect()
    if (ra.width < 4 || ra.height < 4) continue
    for (let j = i + 1; j < leaves.length; j++) {
      const b = leaves[j]
      if (a.contains(b) || b.contains(a)) continue
      if (layers.get(a) !== layers.get(b)) continue
      const rb2 = b.getBoundingClientRect()
      const ix = Math.min(ra.right, rb2.right) - Math.max(ra.left, rb2.left)
      const iy = Math.min(ra.bottom, rb2.bottom) - Math.max(ra.top, rb2.top)
      if (ix <= 2 || iy <= 2) continue
      const area = ix * iy
      const small = Math.min(ra.width * ra.height, rb2.width * rb2.height)
      if (area > small * 0.25) overlaps.push(`${label(a)} ⨯ ${label(b)}`)
    }
  }

  return {
    clipped: [...new Set(clipped)],
    offscreen: [...new Set(offscreen)],
    overlaps: [...new Set(overlaps)],
    scrollX: Math.max(0, document.documentElement.scrollWidth - vw),
  }
}

let problems = 0
for (const route of routes) {
  for (const [w, h] of sizes) {
    const { browser, page } = await open(`http://localhost:${PORT}/#${route}`, w, h, WAIT)
    let r
    try { r = await page.evaluate(probe) } catch (e) { r = { error: e.message } }
    const n = r.error ? 1 : r.clipped.length + r.offscreen.length + r.overlaps.length + (r.scrollX > 2 ? 1 : 0)
    if (n) {
      problems++
      console.log(`✗ ${route} @ ${w}×${h}`)
      if (r.error) console.log(`   خطأ: ${r.error}`)
      if (r.scrollX > 2) console.log(`   تمرير أفقي: ${r.scrollX}px`)
      if (r.clipped?.length) console.log(`   مقصوص (${r.clipped.length}): ${r.clipped.slice(0, LIMIT).join(' | ')}`)
      if (r.offscreen?.length) console.log(`   خارج الشاشة (${r.offscreen.length}): ${r.offscreen.slice(0, LIMIT).join(' | ')}`)
      if (r.overlaps?.length) console.log(`   متداخل (${r.overlaps.length}): ${r.overlaps.slice(0, LIMIT).join(' | ')}`)
    } else {
      console.log(`✓ ${route} @ ${w}×${h}`)
    }
    await browser.close()
  }
}
console.log(problems ? `\n❌ ${problems} حالة بها ملاحظات` : '\n✅ كل الشاشات نظيفة في كل المقاسات')
