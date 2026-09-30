import { open } from './lib.mjs'
const { browser, page } = await open(`http://localhost:${process.env.PORT}/#/parties/payroll`, 1440, 900, 6500)
await page.waitForFunction(() => !!globalThis.__shopsysDev?.data, { timeout: 30000 })
const wait=(ms=900)=>new Promise(r=>setTimeout(r,ms))
const res=[]; const check=(l,ok,x='')=>{res.push(ok);console.log(`${ok?'✓':'✗'} ${l}${x?' — '+x:''}`)}
const errs=[]; page.on('pageerror',e=>errs.push(String(e).slice(0,140)))
await page.evaluate(() => {
  const raw=JSON.parse(localStorage.getItem('shopsys-app')||'{}')
  raw.state=raw.state||{}; raw.state.setup=raw.state.setup||{}; raw.state.setup.allowNegativeTreasury=true
  localStorage.setItem('shopsys-app', JSON.stringify(raw))
  const s=globalThis.__shopsysDev.data.getState()
  if(!s.employees.length){ try{ s.addEmployee({nameAr:'أحمد المحاسب',phone:'0101',role:'accountant',baseSalaryMinor:800000,active:true,notes:'',nationalId:'',hiredAt:'2025-01-01'}) }catch(e){ console.log(e.message) } }
})
await wait(1500)
const afterAccrue = await page.evaluate(() => {
  const s=globalThis.__shopsysDev.data.getState()
  const emp=s.employees[0]
  s.accruePayrollSlips({ month:'2026-11', rows:[{employeeId:emp.id,grossMinor:800000,allowancesMinor:0,deductionsMinor:50000,advanceMinor:0}] })
  const st=globalThis.__shopsysDev.data.getState()
  return { id: emp.id, balance: st.getEmployeeBalance(emp.id), rows: st.getEmployeeStatementRows(emp.id).length }
})
check('الاستحقاق ينزل في حساب الموظف كدائن', afterAccrue.balance > 0, `رصيد=${afterAccrue.balance} · صفوف=${afterAccrue.rows}`)
const rows = await page.evaluate((id) => globalThis.__shopsysDev.data.getState().getEmployeeStatementRows(id).map(r=>r.description), afterAccrue.id)
check('الخصومات تظهر في كشف الموظف', rows.some(r=>/خصومات/.test(r)), rows.join(' · ').slice(0,80))
const afterPay = await page.evaluate((id) => {
  const s=globalThis.__shopsysDev.data.getState()
  const slip=s.payrollSlips.find(x=>x.employeeId===id&&x.status==='accrued')
  s.payPayrollSlip(slip.id,{ treasury:'1101' })
  return globalThis.__shopsysDev.data.getState().getEmployeeBalance(id)
}, afterAccrue.id)
check('الصرف يصفّي رصيد الموظف', afterPay === 0, `الرصيد=${afterPay}`)
const afterAdvance = await page.evaluate((id) => {
  const s=globalThis.__shopsysDev.data.getState()
  s.postVoucher({ kind:'payment', treasury:'1101', counterAccountCode:'1107', amountMinor:100000,
    description:'سلفة نقدية', partyKind:'employee', partyId:id, date:new Date().toISOString().slice(0,10) })
  const st=globalThis.__shopsysDev.data.getState()
  return { balance: st.getEmployeeBalance(id), rows: st.getEmployeeStatementRows(id).filter(r=>/سلفة/.test(r.description)).length }
}, afterAccrue.id)
check('سند صرف سلفة يجعل الموظف مديناً في حسابه', afterAdvance.balance < 0 && afterAdvance.rows >= 1, `رصيد=${afterAdvance.balance}`)
const afterReceipt = await page.evaluate((id) => {
  const s=globalThis.__shopsysDev.data.getState()
  s.postVoucher({ kind:'receipt', treasury:'1101', counterAccountCode:'1107', amountMinor:40000,
    description:'استرداد جزء من السلفة', partyKind:'employee', partyId:id, date:new Date().toISOString().slice(0,10) })
  return globalThis.__shopsysDev.data.getState().getEmployeeBalance(id)
}, afterAccrue.id)
check('سند قبض منه يُحدِّث رصيده', afterReceipt > afterAdvance.balance, `${afterAdvance.balance} ⇐ ${afterReceipt}`)
await page.evaluate(() => { location.hash='#/sales/invoices' }); await wait(2400)
await page.evaluate(() => { const b=[...document.querySelectorAll('button,a')].filter(x=>x.textContent.includes('فاتورة مبيعات جديدة')&&!x.disabled).pop(); b?.click() })
await wait(3200)
const review = await page.evaluate(() => {
  const btn=document.querySelector('[data-prepost-open]')
  if(!btn) return null
  const pdf=[...document.querySelectorAll('button')].find(b=>/تصدير PDF/.test(b.textContent))
  const near = pdf && Math.abs(pdf.getBoundingClientRect().top - btn.getBoundingClientRect().top) < 40
  return { nearPdf: !!near, y: Math.round(btn.getBoundingClientRect().top), pdfY: pdf? Math.round(pdf.getBoundingClientRect().top):null }
})
check('زر المراجعة أسفل بجوار «تصدير PDF»', !!review?.nearPdf, JSON.stringify(review))
console.log('أخطاء JS:', errs.slice(0,2).join(' | ') || 'لا شيء')
await page.screenshot({ path:'/home/user/batch25.png' })
const bad=res.filter(r=>!r).length
console.log(bad?`\n❌ ${bad} فحص فاشل من ${res.length}`:`\n✅ كل الفحوص ناجحة (${res.length})`)
await browser.close()
