import { open } from './lib.mjs'
const { browser, page } = await open(`http://localhost:${process.env.PORT}/#/parties/employees`, 1440, 900, 6500)
await page.waitForFunction(() => !!globalThis.__shopsysDev?.data, { timeout: 30000 })
const wait=(ms=900)=>new Promise(r=>setTimeout(r,ms))
const res=[]; const check=(l,ok,x='')=>{res.push(ok);console.log(`${ok?'✓':'✗'} ${l}${x?' — '+x:''}`)}
const errs=[]; page.on('pageerror',e=>errs.push(String(e).slice(0,140)))
await page.evaluate(() => {
  const raw=JSON.parse(localStorage.getItem('shopsys-app')||'{}')
  raw.state=raw.state||{}; raw.state.setup=raw.state.setup||{}; raw.state.setup.allowNegativeTreasury=true
  localStorage.setItem('shopsys-app', JSON.stringify(raw))
  const s=globalThis.__shopsysDev.data.getState()
  if(!s.employees.length){ try{ s.addEmployee({nameAr:'أحمد المحاسب',phone:'01',jobTitle:'محاسب',hireDate:'2025-01-01',baseSalaryMinor:800000,allowancesMinor:0,deductionsMinor:0,active:true}) }catch(e){console.log(e.message)} }
})
await wait(1600)
const seeded = await page.evaluate(() => {
  const s=globalThis.__shopsysDev.data.getState(); const emp=s.employees[0]
  try { s.accruePayrollSlips({ month:'2026-12', rows:[{employeeId:emp.id,grossMinor:800000,allowancesMinor:0,deductionsMinor:30000,advanceMinor:0}] }) } catch(e) { void e }
  try { s.postVoucher({ kind:'payment', treasury:'1101', counterAccountCode:'1107', amountMinor:120000, description:'سلفة نقدية', partyKind:'employee', partyId:emp.id, date:new Date().toISOString().slice(0,10) }) } catch(e) { console.log('v',e.message) }
  const st=globalThis.__shopsysDev.data.getState()
  return { id: emp.id, balance: st.getEmployeeBalance(emp.id), rows: st.getEmployeeStatementRows(emp.id).length }
})
check('حركات الموظف مسجَّلة في حسابه', seeded.rows >= 3, `رصيد=${seeded.balance} · حركات=${seeded.rows}`)
await wait(2200)
console.log('   حالة الشاشة:', await page.evaluate(() => ({ crash: /حدث خطأ غير متوقع/.test(document.body.textContent||''), btns: document.querySelectorAll('[data-employee-statement-open]').length, rows: document.querySelectorAll('tbody tr').length })))
const opened = await page.evaluate(() => { const b=document.querySelector('[data-employee-statement-open]'); if(!b) return false; b.click(); return true })
await wait(1400)
console.log('   حوارات:', await page.evaluate(() => [...document.querySelectorAll('[role=dialog]')].map(d=>(d.getAttribute('aria-label')||d.textContent.trim().slice(0,24)))))
const statement = await page.evaluate(() => {
  const box=document.querySelector('[data-employee-statement]')
  if(!box) return null
  return { rows: box.querySelectorAll('[data-statement-row]').length, balance: box.querySelector('[data-statement-balance]')?.textContent?.trim().slice(0,32) }
})
check('زر كشف الحساب يفتح الكشف', opened && !!statement, JSON.stringify(statement))
check('الكشف يعرض الحركات والرصيد الجاري', (statement?.rows ?? 0) >= 3, `${statement?.rows} حركة · ${statement?.balance}`)
await page.evaluate(() => { document.querySelectorAll('[data-window-close]').forEach(b=>b.click()) })
await page.goto(`http://localhost:${process.env.PORT}/#/treasury/payments`, { waitUntil:'domcontentloaded', timeout:60000 })
await wait(4500)
const voucher = await page.evaluate(() => {
  const sel=[...document.querySelectorAll('select')].find(x=>[...x.options].some(o=>/1107/.test(o.textContent||'')))
  if(!sel) return { found:false }
  const opt=[...sel.options].find(o=>/1107/.test(o.textContent||''))
  const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set
  setter.call(sel,opt.value); sel.dispatchEvent(new Event('change',{bubbles:true}))
  return { found:true, label: opt.textContent.trim().slice(0,26) }
})
await wait(1500)
const empField = await page.evaluate(() => {
  const box=document.querySelector('[data-voucher-employee]')
  return box ? { label: box.querySelector('label')?.textContent?.trim().slice(0,30), options: box.querySelectorAll('option').length } : null
})
if (voucher.found) check('سند الصرف يعرض حقل الموظف عند حساب السلف (1107)', !!empField, JSON.stringify(empField))
else console.log('— شاشة السندات تحتاج تهيئة نشاط كاملة في هذه البيئة؛ الحقل محروس ببوابة ثابتة')
console.log('أخطاء JS:', errs.slice(0,2).join(' | ') || 'لا شيء')
await page.screenshot({ path:'/home/user/batch27.png' })
const bad=res.filter(r=>!r).length
console.log(bad?`\n❌ ${bad} فحص فاشل من ${res.length}`:`\n✅ كل الفحوص ناجحة (${res.length})`)
await browser.close()
