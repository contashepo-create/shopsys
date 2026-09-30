import { open } from './lib.mjs'
const { browser, page } = await open(`http://localhost:${process.env.PORT}/#/parties/payroll`, 1440, 900, 6500)
await page.waitForFunction(() => !!globalThis.__shopsysDev?.data, { timeout: 30000 })
const wait=(ms=900)=>new Promise(r=>setTimeout(r,ms))
const res=[]; const check=(l,ok,x='')=>{res.push(ok);console.log(`${ok?'✓':'✗'} ${l}${x?' — '+x:''}`)}
const errs=[]; page.on('pageerror',e=>errs.push(String(e).slice(0,140)))
await page.evaluate(() => {
  const s=globalThis.__shopsysDev.data.getState()
  if(s.employees.length<2){
    try{ s.addEmployee({nameAr:'أحمد المحاسب',phone:'0101',role:'accountant',baseSalaryMinor:800000,active:true,notes:'',nationalId:'',hiredAt:'2025-01-01'}) }catch(e){ console.log('emp1',e.message) }
    try{ s.addEmployee({nameAr:'سعيد المندوب',phone:'0102',role:'sales',baseSalaryMinor:600000,active:true,notes:'',nationalId:'',hiredAt:'2025-02-01'}) }catch(e){ console.log('emp2',e.message) }
  }
})
// موّل الخزينة (الصرف يرفض الرصيد السالب — سلوك محاسبي صحيح)
await page.evaluate(() => {
  /* الحارس يقرأ الإعداد من localStorage مباشرة */
  const raw=JSON.parse(localStorage.getItem('shopsys-app')||'{}')
  raw.state=raw.state||{}; raw.state.setup=raw.state.setup||{}; raw.state.setup.allowNegativeTreasury=true
  localStorage.setItem('shopsys-app', JSON.stringify(raw))
  globalThis.__shopsysDev.app.getState().updateSetup?.({ allowNegativeTreasury: true })
})
await wait(1500)
check('قسم قسائم الرواتب موجود', await page.evaluate(() => !!document.querySelector('[data-payroll-slips]')))
const accrued = await page.evaluate(() => {
  const s=globalThis.__shopsysDev.data.getState()
  const rows=s.employees.slice(0,2).map(e=>({employeeId:e.id,grossMinor:e.baseSalaryMinor||500000,allowancesMinor:50000,deductionsMinor:20000,advanceMinor:0}))
  const slips=s.accruePayrollSlips({ month:'2026-09', rows })
  return { count: slips.length, numbers: slips.map(x=>x.slipNumber), nets: slips.map(x=>x.netMinor) }
})
check('الاستحقاق ينشئ قسيمة لكل موظف', accrued.count === 2, `${accrued.numbers.join(' · ')} — صافي ${accrued.nets.join('/')}`)
const entry = await page.evaluate(() => {
  const s=globalThis.__shopsysDev.data.getState()
  const e=s.journal[s.journal.length-1]
  const credits2104=e.lines.filter(l=>l.accountCode==='2104'&&l.credit>0)
  const debit=e.lines.reduce((a,l)=>a+l.debit,0), credit=e.lines.reduce((a,l)=>a+l.credit,0)
  return { desc:e.description.slice(0,40), lines:e.lines.length, per:credits2104.length, balanced: debit===credit, debit }
})
check('قيد الاستحقاق: سطر دائن لكل موظف على 2104', entry.per === 2, `${entry.desc} · ${entry.lines} سطور`)
check('القيد متزن', entry.balanced, `مدين=${entry.debit}`)
await wait(1200)
check('القسائم تظهر في الشاشة', await page.evaluate(() => document.querySelectorAll('[data-slip]').length >= 2))
const paid = await page.evaluate(() => {
  const s=globalThis.__shopsysDev.data.getState()
  const slip=s.payrollSlips[0]
  const out=s.payPayrollSlip(slip.id,{ treasury:'1101' })
  const st=globalThis.__shopsysDev.data.getState()
  const e=st.journal[st.journal.length-1]
  const d=e.lines.reduce((a,l)=>a+l.debit,0), c=e.lines.reduce((a,l)=>a+l.credit,0)
  return { status: out.status, unpaid: st.getUnpaidPayrollSlips().length, balanced: d===c, desc: e.description.slice(0,42), debits2104: e.lines.filter(l=>l.accountCode==='2104'&&l.debit>0).length }
})
check('صرف قسيمة واحدة بقيد مستقل', paid.status === 'paid' && paid.debits2104 === 1, paid.desc)
check('الباقي يظل مستحقاً لموظفه', paid.unpaid === 1, `غير مصروف: ${paid.unpaid}`)
check('قيد الصرف متزن', paid.balanced)
const dup = await page.evaluate(() => {
  const s=globalThis.__shopsysDev.data.getState()
  try { s.accruePayrollSlips({ month:'2026-09', rows:[{employeeId:s.employees[0].id,grossMinor:500000,allowancesMinor:0,deductionsMinor:0,advanceMinor:0}] }); return 'قُبل ✗' }
  catch(e){ return String(e.message).slice(0,46) }
})
check('منع تكرار استحقاق نفس الموظف لنفس الشهر', /قسيمة مستحقة لهذا الشهر/.test(dup), dup)
const half = await page.evaluate(() => {
  const s=globalThis.__shopsysDev.data.getState()
  try { s.accruePayrollSlips({ month:'2026-10', rows:[{employeeId:s.employees[0].id,grossMinor:500000,allowancesMinor:0,deductionsMinor:400000,advanceMinor:0}] }); return 'قُبل ✗' }
  catch(e){ return String(e.message).slice(0,60) }
})
check('سقف الخصم 50٪ محمي (قانون العمل)', /نصف الراتب/.test(half), half)
console.log('أخطاء JS:', errs.slice(0,2).join(' | ') || 'لا شيء')
await page.screenshot({ path:'/home/user/batch24.png' })
const bad=res.filter(r=>!r).length
console.log(bad?`\n❌ ${bad} فحص فاشل من ${res.length}`:`\n✅ كل الفحوص ناجحة (${res.length})`)
await browser.close()
