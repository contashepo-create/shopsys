/* دفعة ⑳: الدرج الجانبي + استعادة جلسة النوافذ */
import { open } from './lib.mjs'
const { browser, page } = await open(`http://localhost:${process.env.PORT}/#/sales/invoices`, 1440, 860, 6000)
const wait=(ms=900)=>new Promise(r=>setTimeout(r,ms))
const res=[]; const check=(l,ok,x='')=>{res.push(ok);console.log(`${ok?'✓':'✗'} ${l}${x?' — '+x:''}`)}
const errs=[]; page.on('pageerror',e=>errs.push(String(e).slice(0,130)))
await page.evaluate(() => { const s=()=>globalThis.__shopsysDev.data.getState(); if(!s().items.length){ s().seed(['basic'])
  const base={barcodes:[],categoryId:1,baseUnit:'كيس',extraUnits:[],minQty:0,trackExpiry:false,trackSerial:false,warrantyMonths:0,soldByWeight:false,variantColors:[],variantSizes:[],isService:false,active:true,notes:'',imageUrl:'',taxable:true}
  try{s().addItem({...base,nameAr:'أرز مصري 5 كجم',sku:'RICE-5',costMinor:12000,stockQty:41,priceMinor:15500})}catch{} } })
await wait(1600)
await page.evaluate(() => { const b=[...document.querySelectorAll('button,a')].filter(x=>x.textContent.includes('فاتورة مبيعات جديدة')&&!x.disabled).pop(); b?.click() })
await wait(3200)
// ① الدرج الجانبي بـCtrl+Shift+N
await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.keyboard.press('KeyN'); await page.keyboard.up('Shift'); await page.keyboard.up('Control')
await wait(900)
const sheet = await page.evaluate(() => { const s=document.querySelector('[data-app-sheet]'); if(!s) return null
  const r=s.getBoundingClientRect(); const inv=document.querySelector('[data-app-window]')
  const dim=[...document.querySelectorAll('body *')].filter(n=>{const c=getComputedStyle(n);if(!c.backgroundColor.startsWith('rgba'))return false;const a=Number(c.backgroundColor.split(',')[3]);const b=n.getBoundingClientRect();return a>0.25&&b.width>innerWidth*0.8&&b.height>innerHeight*0.8}).length
  return { w: Math.round(r.width), invoiceVisible: !!inv && inv.getBoundingClientRect().width>200, dim } })
check('Ctrl+Shift+N يفتح الدرج الجانبي', !!sheet, sheet? `${sheet.w}px`:'لم يفتح')
check('الفاتورة تبقى ظاهرة خلف الدرج', !!sheet?.invoiceVisible)
check('بلا تعتيم للخلفية', sheet?.dim === 0, `${sheet?.dim} طبقة`)
// ② حفظ عميل من الدرج
await page.evaluate(() => { const i=document.querySelector('[data-new-party-sheet] input'); const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set
  setter.call(i,'شركة الدرج الجانبي'); i.dispatchEvent(new Event('input',{bubbles:true})) })
await wait(500)
await page.evaluate(() => { const b=[...document.querySelectorAll('[data-app-sheet] button')].find(x=>/حفظ واختيار/.test(x.textContent)); b?.click() })
await wait(1200)
const saved = await page.evaluate(() => ({ exists: globalThis.__shopsysDev.data.getState().customers.some(c=>c.nameAr==='شركة الدرج الجانبي'), closed: !document.querySelector('[data-app-sheet]'),
  picked: (document.querySelector('input[aria-label^="بحث العميل"]')?.value ?? '') }))
check('الحفظ يضيف العميل ويغلق الدرج', saved.exists && saved.closed, `مختار: ${saved.picked}`)
// ③ Escape يغلق الدرج
await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.keyboard.press('KeyN'); await page.keyboard.up('Shift'); await page.keyboard.up('Control')
await wait(800); await page.keyboard.press('Escape'); await wait(600)
check('Escape يغلق الدرج', await page.evaluate(() => !document.querySelector('[data-app-sheet]')))
// ④ استعادة الجلسة بعد التحديث
const before = await page.evaluate(() => document.querySelectorAll('[data-app-window]').length)
await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }); await wait(4000)
const after = await page.evaluate(() => ({ wins: document.querySelectorAll('[data-app-window]').length, kinds: [...document.querySelectorAll('[data-app-window]')].map(w=>w.dataset.windowKind) }))
check('النوافذ تعود بعد إعادة التحميل', after.wins >= before && after.wins > 0, `${before} ⇐ ${after.wins} (${after.kinds.join('،')})`)
console.log('أخطاء JS:', errs.slice(0,2).join(' | ') || 'لا شيء')
await page.screenshot({ path:'/home/user/batch20.png' })
const bad=res.filter(r=>!r).length
console.log(bad?`\n❌ ${bad} فحص فاشل من ${res.length}`:`\n✅ كل الفحوص ناجحة (${res.length})`)
await browser.close()
