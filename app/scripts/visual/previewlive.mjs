/* فحص بصري حيّ: نافذة المعاينة الحية العالمية (دفعة المالك ㉙ + إصلاحاتها)
   ① الإعدادات السريعة داخل النافذة: ورق/لون/تذييل/مفاتيح إظهار — بتحديث فوري للورقة
   ② تغيير عرض الورق 58↔80 لا يعيد تمركز النافذة المسحوبة (إصلاح ②)
   ③ Enter داخل حقل الإدخال لا يطبع (إصلاح ①) والوضع المصغّر لا يختطف لوحة المفاتيح
   ④ «إعدادات إضافية»: تصغير حي + فتح قسم الطباعة + تحديث المصغّرة من هناك فوراً
   ⑤ التكبير يعيد النافذة لوسط الشاشة، وEnter على جسم الصفحة يطبع ويغلق
   التشغيل: bash scripts/visual/setup.sh ثم PORT=5187 node previewlive.mjs (من tools/shot) */
import { open } from './lib.mjs'
const { browser, page } = await open(`http://localhost:${process.env.PORT}/#/sales/invoices`, 1440, 900, 6500)
await page.waitForFunction(() => !!globalThis.__shopsysDev?.data, { timeout: 30000 })
const wait = (ms = 900) => new Promise((r) => setTimeout(r, ms))
const res = []
const check = (l, ok, x = '') => { res.push(ok); console.log(`${ok ? '✓' : '✗'} ${l}${x ? ' — ' + x : ''}`) }
const errs = []
page.on('pageerror', (e) => errs.push(String(e).slice(0, 140)))

/* بذر صنف + توجيه الطباعة السريعة للحراري (كاشير) بلا صمت ⇒ المعاينة تفتح */
await page.evaluate(() => {
  const s = () => globalThis.__shopsysDev.data.getState()
  if (!s().items.length) {
    s().seed(['basic'])
    const base = { barcodes: [], categoryId: 1, baseUnit: 'كيس', extraUnits: [], minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isService: false, active: true, notes: '', imageUrl: '', taxable: true }
    try { s().addItem({ ...base, nameAr: 'أرز مصري 5 كجم', sku: 'RICE-5', costMinor: 12000, stockQty: 41, priceMinor: 15500 }) } catch { }
  }
  const app = globalThis.__shopsysDev.app.getState()
  app.updateReceipt({ cashierPrint: true, silentPrint: false, showFooter: true, paperWidth: '80' })
})
await wait(1500)
await page.evaluate(() => { const b = [...document.querySelectorAll('button,a')].filter((x) => x.textContent.includes('فاتورة مبيعات جديدة') && !x.disabled).pop(); b?.click() })
await wait(3200)
await page.evaluate(() => document.querySelector('.invoice-line-entry-cell input')?.focus())
await page.keyboard.type('أرز*2', { delay: 60 }); await wait(900); await page.keyboard.press('Enter'); await wait(900)
await page.evaluate(() => document.querySelector('[data-quick-print] button')?.click())
await wait(1800)

/* ── ① فتح المعاينة الحرارية + لوحة الإعدادات السريعة ── */
const prev = await page.evaluate(() => {
  const p = document.querySelector('[data-thermal-preview]')
  if (!p) return null
  const r = p.getBoundingClientRect()
  return { w: Math.round(r.width), centered: Math.abs(r.left + r.width / 2 - innerWidth / 2) < 60, quickBtn: !!p.querySelector('[data-thermal-settings]') }
})
check('المعاينة الحرارية تفتح (رول 80mm ≈ 330px) ومزودة بزر الإعدادات السريعة', !!prev && prev.w > 300 && prev.w < 360 && prev.quickBtn, JSON.stringify(prev))
await page.evaluate(() => document.querySelector('[data-thermal-settings]')?.click()); await wait(700)
const quick = await page.evaluate(() => {
  const q = document.querySelector('[data-thermal-quick]')
  if (!q) return null
  return {
    paper: !!q.querySelector('[data-quick-paper]'), accent: !!q.querySelector('[data-quick-accent]'),
    footer: !!q.querySelector('[data-quick-footer]'), toggles: q.querySelectorAll('[data-quick-toggle]').length,
    extra: !!q.querySelector('[data-thermal-extra-settings]'),
  }
})
check('لوحة الإعدادات السريعة: ورق + لون + تذييل + مفاتيح إظهار + زر الإعدادات الإضافية', !!quick && quick.paper && quick.accent && quick.footer && quick.toggles >= 5 && quick.extra, JSON.stringify(quick))

/* ── ① تكملة: التذييل ينعكس على الورقة فوراً (معاينة حية) ── */
const FOOTER = 'شكرا لزيارتكم الحية'
await page.evaluate(() => document.querySelector('[data-quick-footer]')?.focus())
await page.keyboard.type(FOOTER, { delay: 25 }); await wait(1200)
const footerLive = await page.evaluate(() => {
  const f = document.querySelector('[data-thermal-preview] iframe')
  return f?.contentDocument?.body?.innerText ?? ''
})
check('كتابة التذييل تظهر على الورقة فوراً بلا إغلاق', footerLive.includes(FOOTER), footerLive.slice(-90))

/* ── ② سحب النافذة ثم تغيير عرض الورق: لا إعادة تمركز ── */
let dragInfo = { left: 0, after: 0, w: 0 }
{
  const head = await page.evaluate(() => { const h = document.querySelector('[data-thermal-drag]').getBoundingClientRect(); const p = document.querySelector('[data-thermal-preview]').getBoundingClientRect(); return { x: h.left + 60, y: h.top + 10, left: Math.round(p.left) } })
  await page.mouse.move(head.x, head.y); await page.mouse.down()
  await page.mouse.move(head.x - 140, head.y + 90, { steps: 8 }); await page.mouse.up()
  await wait(600)
  dragInfo.left = await page.evaluate(() => Math.round(document.querySelector('[data-thermal-preview]').getBoundingClientRect().left))
  /* تغيير الورق إلى 58mm */
  await page.evaluate(() => {
    const select = document.querySelector('[data-quick-paper]')
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
    setter.call(select, '58')
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await wait(1400)
  dragInfo.after = await page.evaluate(() => {
    const r = document.querySelector('[data-thermal-preview]')?.getBoundingClientRect()
    return r ? { left: Math.round(r.left), w: Math.round(r.width) } : null
  })
  const paperState = await page.evaluate(() => globalThis.__shopsysDev.app.getState().receipt.paperWidth)
  check('تغيير الورق 80→58: النافذة تضيق (≈248px) والإعداد يتحدث', !!dragInfo.after && dragInfo.after.w < 290 && paperState === '58', `عرض=${dragInfo.after?.w} · ورق=${paperState}`)
  check('…ولا تعود لوسط الشاشة — تبقى حيث سحبها المستخدم', Math.abs((dragInfo.after?.left ?? 0) - dragInfo.left) <= 6, `قبل=${dragInfo.left} بعد=${dragInfo.after?.left}`)
}

/* ── ③ Enter داخل حقل الإدخال لا يطعم الطباعة ولا يغلق ── */
await page.evaluate(() => document.querySelector('[data-quick-footer]')?.focus())
await page.keyboard.press('Enter'); await wait(700)
const stillOpen = await page.evaluate(() => !!document.querySelector('[data-thermal-preview]') && !document.querySelector('[data-thermal-mini]'))
check('Enter داخل حقل التذييل لا يطبع ولا يغلق المعاينة (حماية الحقول)', stillOpen)

/* ── ④ «إعدادات إضافية»: تصغير + فتح قسم الطباعة + المصغّرة تتحدث فوراً ── */
await page.evaluate(() => document.querySelector('[data-thermal-extra-settings]')?.click())
await wait(2200)
const miniState = await page.evaluate(() => ({
  mini: !!document.querySelector('[data-thermal-mini]'),
  fullGone: !document.querySelector('[data-thermal-preview]:not([data-thermal-mini])'),
  hash: location.hash,
  frame: !!document.querySelector('[data-thermal-mini] iframe'),
}))
check('«إعدادات إضافية»: تصغّر لشريط حي وتفتح قسم الطباعة', miniState.mini && miniState.fullGone && miniState.frame && /settings\/printing/.test(miniState.hash), JSON.stringify({ hash: miniState.hash, mini: miniState.mini }))
/* تحديث من داخل قسم الطباعة (المتجر مباشرة) ⇒ المصغّرة تتحدث فوراً */
const FOOTER2 = 'معاينة حية من قسم الطباعة'
await page.evaluate((t) => globalThis.__shopsysDev.app.getState().updateReceipt({ footerText: t, paperWidth: '58' }), FOOTER2)
await wait(1600)
const miniLive = await page.evaluate(() => document.querySelector('[data-thermal-mini] iframe')?.contentDocument?.body?.innerText ?? '')
check('تغيير الإعداد من قسم الطباعة ينعكس على المصغّرة فوراً', miniLive.includes(FOOTER2), miniLive.slice(-90))

/* ── ③ تكملة: الوضع المصغّر لا يختطف لوحة مفاتيح قسم الطباعة ── */
const hijack = await page.evaluate(() => {
  /* Escape وEnter على جسم صفحة القسم لا يغلقان المصغّرة ولا يطبعان */
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  return { miniStill: !!document.querySelector('[data-thermal-mini]') }
})
await wait(700)
const miniStill2 = await page.evaluate(() => !!document.querySelector('[data-thermal-mini]'))
check('المصغّر لا يختطف Escape/Enter — تظل معلقة أثناء العمل في القسم', hijack.miniStill && miniStill2)

/* ── ⑤ التكبير يعيد لوسط الشاشة ثم Enter على الجسم يطبع ويغلق ── */
await page.evaluate(() => document.querySelector('[data-thermal-expand]')?.click()); await wait(1000)
const expanded = await page.evaluate(() => {
  const p = document.querySelector('[data-thermal-preview]:not([data-thermal-mini])')
  if (!p) return null
  const r = p.getBoundingClientRect()
  return { centered: Math.abs(r.left + r.width / 2 - innerWidth / 2) < 80, w: Math.round(r.width) }
})
check('التكبير يعيد النافذة الكاملة لوسط الشاشة', !!expanded && expanded.centered, JSON.stringify(expanded))
await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
await wait(900)
const closed = await page.evaluate(() => !document.querySelector('[data-thermal-preview]'))
check('Enter على جسم النافذة يطبع ويغلق المعاينة', closed)

console.log('أخطاء JS:', errs.slice(0, 2).join(' | ') || 'لا شيء')
await page.screenshot({ path: '/home/user/previewlive.png' })
const bad = res.filter((r) => !r).length
console.log(bad ? `\n❌ ${bad} فحص فاشل من ${res.length}` : `\n✅ كل الفحوص ناجحة (${res.length})`)
await browser.close()
process.exit(bad ? 1 : 0)
