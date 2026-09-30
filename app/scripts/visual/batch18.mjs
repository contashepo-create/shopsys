import { open } from './lib.mjs'
const { browser, page } = await open(`http://localhost:${process.env.PORT}/#/purchases/orders`, 1440, 860, 6000)
const wait=(ms=900)=>new Promise(r=>setTimeout(r,ms))
const res=[]; const check=(l,ok,x='')=>{res.push(ok);console.log(`${ok?'✓':'✗'} ${l}${x?' — '+x:''}`)}
const errs=[]; page.on('pageerror',e=>errs.push(String(e).slice(0,120)))
await page.evaluate(() => { const s=()=>globalThis.__shopsysDev.data.getState(); if(!s().items.length){ s().seed(['basic'])
  const base={barcodes:[],categoryId:1,baseUnit:'كيس',extraUnits:[],minQty:0,trackExpiry:false,trackSerial:false,warrantyMonths:0,soldByWeight:false,variantColors:[],variantSizes:[],isService:false,active:true,notes:'',imageUrl:'',taxable:true}
  try{s().addItem({...base,nameAr:'أرز مصري 5 كجم',sku:'RICE-5',costMinor:12000,stockQty:41,priceMinor:15500})}catch{} } })
await wait(1600)
check('صفحة أوامر الشراء موجودة', await page.evaluate(() => !!document.querySelector('[data-po-list]')))
const po = await page.evaluate(() => {
  const s=globalThis.__shopsysDev.data.getState()
  const item=s.items[0], supplier=s.suppliers[0]
  const order=s.addPurchaseOrder({supplierId:supplier?.id??null,supplierName:supplier?.nameAr??'مورد تجريبي',date:new Date().toISOString().slice(0,10),expectedDate:new Date().toISOString().slice(0,10),warehouseId:null,notes:'',
    lines:[{itemId:item.id,nameAr:item.nameAr,qty:7,receivedQty:0,unitAr:'كيس',unitPriceMinor:12000,vatPercent:14,notes:''}]})
  return { number: order.orderNumber, status: order.status }
})
check('إنشاء أمر شراء يعمل', /^PO-\d{4}$/.test(po.number), `${po.number} · ${po.status}`)
await wait(1200)
check('الأمر يظهر في القائمة', await page.evaluate((n) => !!document.querySelector(`[data-po-row="${n}"]`), po.number), po.number)
await page.evaluate(() => { location.hash='#/purchases/invoices' }); await wait(2400)
await page.evaluate(() => { const b=[...document.querySelectorAll('button,a')].filter(x=>x.textContent.includes('فاتورة شراء')&&!x.disabled).pop(); b?.click() })
await wait(3200)
check('زر «تعبئة من» ظاهر فوق حقل المورد', await page.evaluate(() => !!document.querySelector('[data-fill-from-open]')))
await page.evaluate(() => document.querySelector('[data-fill-from-open]')?.click()); await wait(800)
const panel = await page.evaluate(() => { const p=document.querySelector('[data-fill-from-panel]'); return p? p.textContent.replace(/\s+/g,' ').slice(0,90):null })
check('اللوحة تعرض أمر الشراء', /PO-/.test(panel ?? ''), panel)
await page.evaluate(() => document.querySelector('[data-fill-source]')?.click()); await wait(1300)
const filled = await page.evaluate(() => ({ rows: document.querySelectorAll('[data-line-key]').length, vals: [...document.querySelectorAll('[data-line-key] input')].map(i=>i.value).slice(0,4) }))
check('التعبئة ملأت بنود الفاتورة', filled.rows >= 1, `سطور=${filled.rows} · ${filled.vals.join('/')}`)
await page.evaluate(() => { document.querySelectorAll('[data-window-close]').forEach(b=>b.click()); location.hash='#/sales/invoices' }); await wait(2400)
await page.evaluate(() => { const b=[...document.querySelectorAll('button,a')].filter(x=>x.textContent.includes('فاتورة مبيعات جديدة')&&!x.disabled).pop(); b?.click() })
await wait(3000)
check('زر «تعبئة من» في فاتورة المبيعات', await page.evaluate(() => !!document.querySelector('[data-fill-from-open]')))
console.log('أخطاء JS:', errs.slice(0,2).join(' | ') || 'لا شيء')
await page.screenshot({ path:'/home/user/batch18.png' })
const bad=res.filter(r=>!r).length
console.log(bad?`\n❌ ${bad} فحص فاشل من ${res.length}`:`\n✅ كل الفحوص ناجحة (${res.length})`)
await browser.close()
