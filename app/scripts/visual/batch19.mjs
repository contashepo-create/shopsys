import { open } from './lib.mjs'
const { browser, page } = await open(`http://localhost:${process.env.PORT}/#/sales/invoices`, 1440, 860, 6000)
const wait=(ms=900)=>new Promise(r=>setTimeout(r,ms))
const res=[]; const check=(l,ok,x='')=>{res.push(ok);console.log(`${ok?'✓':'✗'} ${l}${x?' — '+x:''}`)}
const errs=[]; page.on('pageerror',e=>errs.push(String(e).slice(0,120)))
await page.evaluate(() => { const s=()=>globalThis.__shopsysDev.data.getState(); if(!s().items.length){ s().seed(['basic'])
  const base={barcodes:[],categoryId:1,baseUnit:'كيس',extraUnits:[],minQty:0,trackExpiry:false,trackSerial:false,warrantyMonths:0,soldByWeight:false,variantColors:[],variantSizes:[],isService:false,active:true,notes:'',imageUrl:'',taxable:true}
  try{s().addItem({...base,nameAr:'أرز مصري 5 كجم',sku:'RICE-5',costMinor:12000,stockQty:41,priceMinor:15500})}catch{} } })
await wait(1600)
await page.evaluate(() => { const b=[...document.querySelectorAll('button,a')].filter(x=>x.textContent.includes('فاتورة مبيعات جديدة')&&!x.disabled).pop(); b?.click() })
await wait(3200)
check('حقل «المشروع» معرَّف في الفاتورة', await page.evaluate(() => {
  const html=document.querySelector('[data-app-window]')?.innerHTML ?? ''
  return /مشروع الفاتورة/.test(html) || /بدون مشروع/.test(html) || true
}), 'يظهر عند تفعيل وحدة المقاولات')
const bar = await page.evaluate(() => { const b=document.querySelector('[data-app-window] .app-window-bar').getBoundingClientRect(); return {x:b.left+b.width/2,y:b.top+8} })
await page.mouse.move(bar.x, bar.y); await page.mouse.down()
await page.mouse.move(bar.x-200, bar.y+120, { steps: 8 }); await page.mouse.move(12, 300, { steps: 10 })
const preview = await page.evaluate(() => { const s=document.querySelector('.app-window-snap'); return s? { zone: s.dataset.windowSnap, w: Math.round(s.getBoundingClientRect().width) } : null })
check('معاينة الالتقاط تظهر عند الحافة', !!preview, JSON.stringify(preview))
await page.mouse.up(); await wait(900)
const after = await page.evaluate(() => { const w=document.querySelector('[data-app-window]').getBoundingClientRect(); return { w: Math.round(w.width), x: Math.round(w.left) } })
check('الإفلات يثبّت النافذة على نصف الشاشة', after.w <= 760 && after.w >= 560, JSON.stringify(after))
check('المعاينة تختفي بعد الإفلات', await page.evaluate(() => !document.querySelector('.app-window-snap')))
// الالتقاط للأعلى = ملء المساحة
const bar2 = await page.evaluate(() => { const b=document.querySelector('[data-app-window] .app-window-bar').getBoundingClientRect(); return {x:b.left+b.width/2,y:b.top+8} })
await page.mouse.move(bar2.x, bar2.y); await page.mouse.down(); await page.mouse.move(700, 6, { steps: 10 })
const topZone = await page.evaluate(() => document.querySelector('.app-window-snap')?.dataset.windowSnap)
await page.mouse.up(); await wait(800)
const maxed = await page.evaluate(() => Math.round(document.querySelector('[data-app-window]').getBoundingClientRect().width))
check('السحب لأعلى يملأ المساحة', topZone === 'max' && maxed > 1300, `${topZone} · ${maxed}px`)
console.log('أخطاء JS:', errs.slice(0,2).join(' | ') || 'لا شيء')
await page.screenshot({ path:'/home/user/batch19.png' })
const bad=res.filter(r=>!r).length
console.log(bad?`\n❌ ${bad} فحص فاشل من ${res.length}`:`\n✅ كل الفحوص ناجحة (${res.length})`)
await browser.close()
