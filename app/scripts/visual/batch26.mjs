import { open } from './lib.mjs'
const { browser, page } = await open(`http://localhost:${process.env.PORT}/#/sales/invoices`, 1440, 900, 6500)
await page.waitForFunction(() => !!globalThis.__shopsysDev?.data, { timeout: 30000 })
const wait=(ms=900)=>new Promise(r=>setTimeout(r,ms))
const res=[]; const check=(l,ok,x='')=>{res.push(ok);console.log(`${ok?'✓':'✗'} ${l}${x?' — '+x:''}`)}
const errs=[]; page.on('pageerror',e=>errs.push(String(e).slice(0,140)))
await page.evaluate(() => { const s=()=>globalThis.__shopsysDev.data.getState(); if(!s().items.length){ s().seed(['basic'])
  const base={barcodes:[],categoryId:1,baseUnit:'كيس',extraUnits:[],minQty:0,trackExpiry:false,trackSerial:false,warrantyMonths:0,soldByWeight:false,variantColors:[],variantSizes:[],isService:false,active:true,notes:'',imageUrl:'',taxable:true}
  try{s().addItem({...base,nameAr:'أرز مصري 5 كجم',sku:'RICE-5',costMinor:12000,stockQty:41,priceMinor:15500})}catch{} } })
await wait(1500)
await page.evaluate(() => { const b=[...document.querySelectorAll('button,a')].filter(x=>x.textContent.includes('فاتورة مبيعات جديدة')&&!x.disabled).pop(); b?.click() })
await wait(3200)
await page.evaluate(() => document.querySelector('.invoice-line-entry-cell input')?.focus())
await page.keyboard.type('أرز*2', { delay: 60 }); await wait(900); await page.keyboard.press('Enter'); await wait(900)
const quick = await page.evaluate(() => {
  const btn=document.querySelector('[data-quick-print]')
  const drafts=[...document.querySelectorAll('button')].find(b=>/المسودات/.test(b.textContent))
  if(!btn||!drafts) return null
  return { sameRow: Math.abs(btn.getBoundingClientRect().top - drafts.getBoundingClientRect().top) < 20, label: btn.textContent.trim() }
})
check('زر الطباعة بجوار «المسودات» في شريط الفاتورة', !!quick?.sameRow, JSON.stringify(quick))
await page.evaluate(() => document.querySelector('[data-quick-print] button')?.click())
await wait(1800)
const prev = await page.evaluate(() => {
  const p=document.querySelector('[data-thermal-preview]'); if(!p) return null
  const r=p.getBoundingClientRect()
  const paper=p.querySelector('.thermal-preview-paper'); const frame=p.querySelector('iframe')
  return { centered: Math.abs((r.left + r.width/2) - innerWidth/2) < 60, w: Math.round(r.width),
    hScroll: paper ? paper.scrollWidth - paper.clientWidth : -1,
    frameW: frame? Math.round(frame.getBoundingClientRect().width):0, paperW: paper? Math.round(paper.clientWidth):0 }
})
check('المعاينة تفتح في منتصف الشاشة', !!prev?.centered, JSON.stringify(prev))
check('بلا تمرير أفقي — الورقة كاملة', prev?.hScroll === 0, `فرق=${prev?.hScroll}px · ورقة ${prev?.frameW}/${prev?.paperW}`)
let moved = { before: 0, after: 0 }
if (prev) {
  const head = await page.evaluate(() => { const h=document.querySelector('[data-thermal-drag]').getBoundingClientRect(); const p=document.querySelector('[data-thermal-preview]').getBoundingClientRect(); return { x:h.left+60, y:h.top+10, left:Math.round(p.left) } })
  await page.mouse.move(head.x, head.y); await page.mouse.down()
  await page.mouse.move(head.x - 150, head.y + 80, { steps: 8 }); await page.mouse.up()
  await wait(500)
  moved = { before: head.left, after: await page.evaluate(() => Math.round(document.querySelector('[data-thermal-preview]').getBoundingClientRect().left)) }
}
check('المعاينة تُسحب بحرية', moved.after !== moved.before, `${moved.before} ⇐ ${moved.after}`)
await page.evaluate(() => document.querySelector('[data-thermal-cancel]')?.click()); await wait(600)
await page.evaluate(() => { document.querySelectorAll('[data-window-close]').forEach(b=>b.click()); location.hash='#/parties/payroll' })
await wait(2600)
await page.evaluate(() => {
  const s=globalThis.__shopsysDev.data.getState()
  if(s.employees.length<2){
    try{ s.addEmployee({nameAr:'أحمد المحاسب',phone:'01',jobTitle:'محاسب',hireDate:'2025-01-01',baseSalaryMinor:800000,active:true}) }catch(e){console.log('e1',e.message)}
    try{ s.addEmployee({nameAr:'سعيد المندوب',phone:'02',jobTitle:'مندوب',hireDate:'2025-01-01',baseSalaryMinor:600000,active:true}) }catch(e){console.log('e2',e.message)}
  }
})
await wait(1200)
await page.evaluate(() => { const b=[...document.querySelectorAll('button')].find(x=>/استحقاق قسائم/.test(x.textContent)); b?.click() })
await wait(1400)
const modal = await page.evaluate(() => {
  const d=document.querySelector('[data-slip-draft]')
  return d ? { inModal: !!d.closest('[role="dialog"], .doc-window'), rows: d.querySelectorAll('[data-slip-row]').length, search: !!d.querySelector('[data-slip-search]') } : null
})
check('مسير الرواتب صار نافذة منبثقة', !!modal?.inModal, JSON.stringify(modal))
check('بها حقل بحث الموظف', !!modal?.search)
if (modal?.search) {
  await page.evaluate(() => { const i=document.querySelector('[data-slip-search]'); const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set
    setter.call(i,'أحمد'); i.dispatchEvent(new Event('input',{bubbles:true})) })
  await wait(800)
  const filtered = await page.evaluate(() => document.querySelectorAll('[data-slip-row]').length)
  check('البحث يعرض الموظف المطلوب وحده', filtered === 1, `صفوف=${filtered}`)
}
console.log('أخطاء JS:', errs.slice(0,2).join(' | ') || 'لا شيء')
await page.screenshot({ path:'/home/user/batch26.png' })
const bad=res.filter(r=>!r).length
console.log(bad?`\n❌ ${bad} فحص فاشل من ${res.length}`:`\n✅ كل الفحوص ناجحة (${res.length})`)
await browser.close()
