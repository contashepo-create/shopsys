/* دفعة ㉓: نظام اعتماد المستندات */
import { open } from './lib.mjs'
const { browser, page } = await open(`http://localhost:${process.env.PORT}/#/settings/approvals`, 1440, 880, 6500)
await page.waitForFunction(() => !!globalThis.__shopsysDev?.data, { timeout: 30000 })
const wait=(ms=900)=>new Promise(r=>setTimeout(r,ms))
const res=[]; const check=(l,ok,x='')=>{res.push(ok);console.log(`${ok?'✓':'✗'} ${l}${x?' — '+x:''}`)}
const errs=[]; page.on('pageerror',e=>errs.push(String(e).slice(0,130)))
await wait(1800)
check('شاشة اعتماد المستندات موجودة', await page.evaluate(() => !!document.querySelector('[data-approvals-list]')))
// النظام موقوف ⇒ لا اعتماد
const off = await page.evaluate(() => {
  const core = globalThis.__shopsysDev.app.getState()
  return { enabled: core.approvals.enabled, scope: core.approvals.scope.length }
})
check('النظام موقوف افتراضياً ويُرحَّل كل شيء فوراً', off.enabled === false, `النطاق ${off.scope} أنواع`)
// فعّله وسجّل طلباً
const submitted = await page.evaluate(() => {
  globalThis.__shopsysDev.app.getState().updateApprovals({ enabled: true, scope: ['sale','purchase','receipt','payment'], thresholdMinor: 0 })
  const s = globalThis.__shopsysDev.data.getState()
  const req = s.submitDocForApproval({ kind:'sale', title:'فاتورة مبيعات — 3 بنود', partyName:'شركة الأمل', amountMinor: 56459, payload:'{}', requestedBy: 99, requestedByName:'محاسب الفرع' })
  return { id: req.id, status: req.status }
})
check('تسجيل طلب اعتماد يعمل', submitted.status === 'pending', `#${submitted.id}`)
await wait(1200)
const shown = await page.evaluate(() => {
  const row = document.querySelector('[data-approval-row]')
  return row ? row.textContent.replace(/\s+/g,' ').slice(0, 80) : null
})
check('الطلب يظهر في الشاشة', !!shown, shown)
// شارة التنبيه في الشريط العلوي
const badge = await page.evaluate(() => { const b=document.querySelector('[data-approvals-alert]'); return b? b.textContent.replace(/\s+/g,' ').trim():null })
check('شارة «اعتماد» تظهر للمخوَّل في الشريط العلوي', !!badge, badge)
// الاعتماد
await page.evaluate(() => { const b=[...document.querySelectorAll('[data-approval-row] button')].find(x=>/اعتماد/.test(x.textContent)); b?.click() })
await wait(1200)
const decided = await page.evaluate(() => {
  const r = globalThis.__shopsysDev.data.getState().docApprovals[0]
  return { status: r?.status, by: r?.decidedByName, badge: !!document.querySelector('[data-approvals-alert]') }
})
check('الاعتماد يغيّر الحالة ويُسجَّل باسم المعتمِد', decided.status === 'approved', `${decided.status} · ${decided.by}`)
check('الشارة تختفي بعد إفراغ المعلّق', decided.badge === false)
// الرفض يتطلب سبباً
const rejected = await page.evaluate(() => {
  const s = globalThis.__shopsysDev.data.getState()
  const req = s.submitDocForApproval({ kind:'payment', title:'سند صرف', partyName:'مورد', amountMinor: 20000, payload:'{}', requestedBy: 99, requestedByName:'أمين الخزينة' })
  try { s.decideDocApproval(req.id, { status:'rejected', by:1, byName:'المالك' }); return 'قُبل بلا سبب ✗' }
  catch (error) { return String(error.message).slice(0, 40) }
})
check('الرفض بلا سبب مرفوض', /سبب الرفض مطلوب/.test(rejected), rejected)
console.log('أخطاء JS:', errs.slice(0,2).join(' | ') || 'لا شيء')
await page.screenshot({ path:'/home/user/batch23.png' })
const bad=res.filter(r=>!r).length
console.log(bad?`\n❌ ${bad} فحص فاشل من ${res.length}`:`\n✅ كل الفحوص ناجحة (${res.length})`)
await browser.close()
