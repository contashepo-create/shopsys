/* المسميات الوظيفية تتبع مجال النشاط (طلب المالك) */
import { open } from './lib.mjs'
const { browser, page } = await open(`http://localhost:${process.env.PORT}/#/parties/employees`, 1366, 860, 6000)
await page.waitForFunction(() => !!globalThis.__shopsysDev?.data, { timeout: 30000 })
const wait=(ms=900)=>new Promise(r=>setTimeout(r,ms))
await wait(2000)
await page.evaluate(() => { const b=[...document.querySelectorAll('button')].find(x=>/موظف جديد/.test(x.textContent)); b?.click() })
await wait(1600)
const out = await page.evaluate(() => {
  const list=document.querySelector('#job-titles-by-activity')
  const input=document.querySelector('[data-job-title]')
  const label=[...document.querySelectorAll('label')].find(l=>/المسمى الوظيفي|الوظيفة في|التخصص/.test(l.textContent))
  return { options: list? [...list.options].map(o=>o.value):[], placeholder: input?.getAttribute('placeholder'), label: label?.textContent.trim().slice(0,24) }
})
const ok = out.options.length >= 5
console.log(`${ok?'✓':'✗'} المسميات الوظيفية حسب النشاط — ${out.label} · ${out.options.slice(0,6).join(' · ')}`)
console.log(`${out.placeholder?'✓':'✗'} الاقتراحات تظهر في الحقل — ${out.placeholder}`)
console.log(ok ? '\n✅ ناجح' : '\n❌ فاشل')
await browser.close()
