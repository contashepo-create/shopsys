/* دفعة ⑰: توسيط الإجمالي · فحوص الائتمان/التحصيل · قوالب الفواتير */
import { open } from './lib.mjs'
const { browser, page } = await open(`http://localhost:${process.env.PORT}/#/sales/invoices`, 1440, 860, 5500)
const wait=(ms=800)=>new Promise(r=>setTimeout(r,ms))
const res=[]; const check=(l,ok,x='')=>{res.push(ok);console.log(`${ok?'✓':'✗'} ${l}${x?' — '+x:''}`)}
await page.evaluate(() => { const s=()=>globalThis.__shopsysDev.data.getState(); if(!s().items.length){ s().seed(['basic'])
  const base={barcodes:[],categoryId:1,baseUnit:'كيس',extraUnits:[],minQty:0,trackExpiry:false,trackSerial:false,warrantyMonths:0,soldByWeight:false,variantColors:[],variantSizes:[],isService:false,active:true,notes:'',imageUrl:'',taxable:true}
  try{s().addItem({...base,nameAr:'أرز مصري 5 كجم',sku:'RICE-5',costMinor:12000,stockQty:41,priceMinor:15500})}catch{}
  try{s().addCustomer({nameAr:'شركة الأمل',phone:'0100',notes:'',taxNumber:'',commercialReg:'',email:'',address:'',city:'',postalCode:'',building:'',district:'',openingBalanceMinor:0,creditLimitMinor:20000,priceListId:null,categoryId:null,active:true})}catch{} } })
await wait(1500)
await page.evaluate(() => { const b=[...document.querySelectorAll('button,a')].filter(x=>x.textContent.includes('فاتورة مبيعات جديدة')&&!x.disabled).pop(); b?.click() })
await wait(3000)
// بند
await page.evaluate(() => document.querySelector('.invoice-line-entry-cell input')?.focus())
await page.keyboard.type('أرز*4', { delay: 60 }); await wait(900); await page.keyboard.press('Enter'); await wait(900)
// ① توسيط الإجمالي
const align = await page.evaluate(() => {
  const cell=document.querySelector('.invoice-lines-table tbody .invoice-table-total')
  return cell ? getComputedStyle(cell).textAlign : null
})
check('خانة الإجمالي موسَّطة', align === 'center', String(align))
// ② فحص التحصيل في لوحة المراجعة
await page.evaluate(() => document.querySelector('[data-prepost-open]')?.click()); await wait(800)
const issues = await page.evaluate(() => {
  const p=document.querySelector('[data-prepost-panel]')
  return p ? p.textContent.replace(/\s+/g,' ').slice(0,150) : null
})
check('اللوحة تعرض فحص التحصيل/الائتمان', /التحصيل أقل|حد الائتمان|جاهزة للترحيل/.test(issues ?? ''), issues)
await page.keyboard.press('Escape'); await wait(500)
// ③ حفظ كقالب
page.on('dialog', async (d) => { await d.accept('قالب اختبار') })
await page.evaluate(() => { const b=[...document.querySelectorAll('button')].find(x=>/حفظ كقالب/.test(x.textContent)); b?.click() })
await wait(1200)
const saved = await page.evaluate(() => globalThis.__shopsysDev.data.getState().advancedInvoiceDrafts.filter(d=>d.isTemplate).map(d=>d.name))
check('حفظ القالب يعمل', saved.length >= 1, saved.join(' · '))
// ④ ابدأ من قالب
await page.evaluate(() => { const b=[...document.querySelectorAll('button')].find(x=>/ابدأ من قالب/.test(x.textContent)); b?.click() })
await wait(1200)
const modal = await page.evaluate(() => {
  const title=[...document.querySelectorAll('h2,h3,[role="dialog"] b')].map(n=>n.textContent.trim()).find(t=>/قوالب/.test(t))
  const rows=document.querySelectorAll('[role="dialog"] button, [role="dialog"] tr').length
  return { title, rows }
})
check('نافذة القوالب تفتح وتعرض القالب', /قوالب/.test(modal.title ?? ''), `${modal.title} · عناصر=${modal.rows}`)
await page.screenshot({ path:'/home/user/batch17.png' })
const bad=res.filter(r=>!r).length
console.log(bad?`\n❌ ${bad} فحص فاشل من ${res.length}`:`\n✅ كل الفحوص ناجحة (${res.length})`)
await browser.close()
