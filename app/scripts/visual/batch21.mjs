import { open } from './lib.mjs'
const { browser, page } = await open(`http://localhost:${process.env.PORT}/#/sales/invoices`, 1440, 860, 6000)
await page.waitForFunction(() => !!globalThis.__shopsysDev?.data, { timeout: 30000 })
const wait=(ms=900)=>new Promise(r=>setTimeout(r,ms))
const res=[]; const check=(l,ok,x='')=>{res.push(ok);console.log(`${ok?'✓':'✗'} ${l}${x?' — '+x:''}`)}
const errs=[]; page.on('pageerror',e=>errs.push(String(e).slice(0,130)))
await page.evaluate(() => {
  const s=()=>globalThis.__shopsysDev.data.getState()
  if(!s().items.length){ s().seed(['basic'])
    const base={barcodes:[],categoryId:1,baseUnit:'كيس',extraUnits:[],minQty:0,trackExpiry:false,trackSerial:false,warrantyMonths:0,soldByWeight:false,variantColors:[],variantSizes:[],isService:false,active:true,notes:'',imageUrl:'',taxable:true}
    try{s().addItem({...base,nameAr:'أرز مصري 5 كجم',sku:'RICE-5',costMinor:12000,stockQty:41,priceMinor:15500})}catch{} }
  globalThis.__shopsysDev.app.getState().updateLoyalty({ enabled:true, pointsPerUnit:1, redeemValueMinor:5, minRedeemPoints:100 })
  const st=s(); const cust=st.customers[0]
  if(!cust){ try{ st.addCustomer({ nameAr:'عميل الولاء', phone:'0100', notes:'', creditLimitMinor:500000, priceListId:null, active:true,
    taxNumber:'', commercialReg:'', email:'', address:'', city:'', postalCode:'', buildingNo:'', nationalId:'' }) }catch(e){ console.log('addCustomer', e.message) } }
  const target=s().customers[0]
  if(target) s().updateCustomer(target.id, { loyaltyPoints: 1240 })
})
await wait(1600)
await page.evaluate(() => { const b=[...document.querySelectorAll('button,a')].filter(x=>x.textContent.includes('فاتورة مبيعات جديدة')&&!x.disabled).pop(); b?.click() })
await wait(3200)
// اختر العميل صاحب النقاط من منتقي العميل
await page.evaluate(() => { const i=document.querySelector('input[aria-label^="بحث العميل"]'); i?.focus(); i?.select?.() })
await page.keyboard.type('الولاء', { delay: 80 })
await wait(900)
await page.keyboard.press('Enter')
await wait(1100)
const sw = await page.evaluate(() => [...document.querySelectorAll('[data-print-switch]')].map(b=>({ key:b.dataset.printSwitch, on:b.getAttribute('aria-pressed'), label:b.textContent.trim().slice(0,14) })))
check('المفاتيح الثلاثة ظاهرة', sw.length === 3, sw.map(x=>`${x.label}:${x.on}`).join(' · '))
check('كلها مطفأة افتراضياً', sw.length===3 && sw.every(x=>x.on==='false'))
await page.evaluate(() => document.querySelector('[data-print-switch="cashierPrint"]')?.click()); await wait(700)
const after = await page.evaluate(() => { const b=document.querySelector('[data-print-switch="cashierPrint"]'); const cs=getComputedStyle(b)
  return { pressed: b.getAttribute('aria-pressed'), transform: cs.transform, saved: globalThis.__shopsysDev.app.getState().receipt.cashierPrint } })
check('الضغط يفعّل المفتاح ويُحفظ في الإعدادات', after.pressed === 'true' && after.saved === true)
check('المفتاح يبدو مضغوطاً للداخل', after.transform !== 'none', after.transform)
const loyal = await page.evaluate(() => { const l=document.querySelector('[data-invoice-loyalty]'); return l? l.textContent.replace(/\s+/g,' ').slice(0,72):null })
check('شريحة نقاط الولاء في لوحة التحصيل', !!loyal, loyal)
await page.evaluate(() => { const b=document.querySelector('[data-invoice-loyalty] button'); if(b&&!b.disabled) b.click() })
await wait(1300)
const points = await page.evaluate(() => ({ pts: globalThis.__shopsysDev.data.getState().customers[0]?.loyaltyPoints, red: globalThis.__shopsysDev.data.getState().loyaltyRedemptions.length }))
check('الاستبدال يخصم النقاط ويسجّل العملية', points.pts === 0 && points.red >= 1, `نقاط=${points.pts} · عمليات=${points.red}`)
console.log('أخطاء JS:', errs.slice(0,2).join(' | ') || 'لا شيء')
await page.screenshot({ path:'/home/user/batch21.png' })
const bad=res.filter(r=>!r).length
console.log(bad?`\n❌ ${bad} فحص فاشل من ${res.length}`:`\n✅ كل الفحوص ناجحة (${res.length})`)
await browser.close()
