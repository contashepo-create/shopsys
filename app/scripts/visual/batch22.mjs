/* دفعة ㉒: قوائم طرق التحصيل + معاينة الإيصال الحراري */
import { open, selectQuick } from './lib.mjs'
const { browser, page } = await open(`http://localhost:${process.env.PORT}/#/sales/invoices`, 1440, 880, 6000)
await page.waitForFunction(() => !!globalThis.__shopsysDev?.data, { timeout: 30000 })
const wait=(ms=900)=>new Promise(r=>setTimeout(r,ms))
const res=[]; const check=(l,ok,x='')=>{res.push(ok);console.log(`${ok?'✓':'✗'} ${l}${x?' — '+x:''}`)}
const errs=[]; page.on('pageerror',e=>errs.push(String(e).slice(0,130)))
await page.evaluate(() => { const s=()=>globalThis.__shopsysDev.data.getState(); if(!s().items.length){ s().seed(['basic'])
  const base={barcodes:[],categoryId:1,baseUnit:'كيس',extraUnits:[],minQty:0,trackExpiry:false,trackSerial:false,warrantyMonths:0,soldByWeight:false,variantColors:[],variantSizes:[],isService:false,active:true,notes:'',imageUrl:'',taxable:true}
  try{s().addItem({...base,nameAr:'أرز مصري 5 كجم',sku:'RICE-5',costMinor:12000,stockQty:41,priceMinor:15500})}catch{} } })
await wait(1600)
await page.evaluate(() => { const b=[...document.querySelectorAll('button,a')].filter(x=>x.textContent.includes('فاتورة مبيعات جديدة')&&!x.disabled).pop(); b?.click() })
await wait(3200)
// بند لتفعيل الطباعة
await page.evaluate(() => document.querySelector('.invoice-line-entry-cell input')?.focus())
await page.keyboard.type('أرز*2', { delay: 60 }); await wait(900); await page.keyboard.press('Enter'); await wait(900)
// ① تحصيل متعدد ⇒ قوائم منسدلة
await page.evaluate(() => { const box=document.querySelector('.invoice-doc-checkline input[type=checkbox]'); box?.click() })
await wait(1000)
const pay = await page.evaluate(() => {
  const lines=[...document.querySelectorAll('[data-pay-line]')]
  const rects=lines.map(l=>{ const s=l.querySelector('select'); const i=l.querySelector('input'); return { method:l.dataset.payLine, sel:!!s, amountW: i? Math.round(i.getBoundingClientRect().width):0 } })
  return { count: lines.length, rects, oldButtons: document.querySelectorAll('.invoice-doc-payrow').length }
})
check('طرق التحصيل صارت قوائم منسدلة', pay.count >= 1 && pay.rects.every(r=>r.sel), JSON.stringify(pay.rects))
check('لم تبقَ الأزرار المتجاورة القديمة', pay.oldButtons === 0)
check('حقل المبلغ ثابت العرض', pay.rects.every(r=>r.amountW >= 80 && r.amountW <= 130), pay.rects.map(r=>r.amountW+'px').join('/'))
// إضافة طريقة أخرى
await page.evaluate(() => { const b=[...document.querySelectorAll('.invoice-doc-payline-add button')].find(x=>/طريقة أخرى/.test(x.textContent)); b?.click() })
await wait(800)
const after = await page.evaluate(() => document.querySelectorAll('[data-pay-line]').length)
check('«طريقة أخرى» تضيف سطراً', after === pay.count + 1, `${pay.count} ⇐ ${after}`)
// ② معاينة الإيصال الحراري
await page.evaluate(() => { const b=[...document.querySelectorAll('button')].find(x=>/معاينة/.test(x.textContent)); b?.click() })
await wait(1200)
// اختر قالب «حراري» من القائمة ثم اطبع
await page.evaluate(() => {
  const sel=[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>/حراري/.test(o.textContent||'')))
  if(sel){ const opt=[...sel.options].find(o=>/حراري/.test(o.textContent||'')); const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set
    setter.call(sel,opt.value); sel.dispatchEvent(new Event('change',{bubbles:true})) }
})
await wait(700)
await page.evaluate(() => { const b=[...document.querySelectorAll('button')].find(x=>/طباعة الآن/.test(x.textContent)); b?.click() })
await wait(1800)
const prev = await page.evaluate(() => { const p=document.querySelector('[data-thermal-preview]'); if(!p) return null
  return { w: Math.round(p.getBoundingClientRect().width), print: !!p.querySelector('[data-thermal-print]'), cancel: !!p.querySelector('[data-thermal-cancel]'), settings: !!p.querySelector('[data-thermal-settings]'), iframe: !!p.querySelector('iframe') } })
check('معاينة الإيصال الحراري تظهر', !!prev, JSON.stringify(prev))
check('بها أزرار طباعة وإلغاء وإعدادات', !!prev?.print && !!prev?.cancel && !!prev?.settings)
if (prev) { await page.evaluate(() => document.querySelector('[data-thermal-cancel]')?.click()); await wait(600)
  check('الإلغاء يغلق المعاينة', await page.evaluate(() => !document.querySelector('[data-thermal-preview]'))) }
console.log('أخطاء JS:', errs.slice(0,2).join(' | ') || 'لا شيء')
await page.screenshot({ path:'/home/user/batch22.png' })
const bad=res.filter(r=>!r).length
console.log(bad?`\n❌ ${bad} فحص فاشل من ${res.length}`:`\n✅ كل الفحوص ناجحة (${res.length})`)
await browser.close()
