import { useDataStore } from '../src/data/repo.ts'
const mem = new Map()
globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k,v)=>mem.set(k,v), removeItem:k=>mem.delete(k), clear:()=>mem.clear(), key:i=>[...mem.keys()][i]??null, get length(){return mem.size} }
globalThis.window = { localStorage: globalThis.localStorage, addEventListener: ()=>{}, dispatchEvent: ()=>true }
const app = (await import('../src/stores/app.store.ts')).useAppStore
app.setState({ ...app.getState(), setup: { ...app.getState().setup, completed: true, countryCode:'SA', activityId:'grocery', shopName:'fuzz7', ownerName:'م', features:[], modules:['pos','inventory','purchases'], accountingMode:'full' } })
const S = () => useDataStore.getState()
let seed = Number(process.argv[2] ?? 1)
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
const int = (a,b) => a + Math.floor(rnd()*(b-a+1))
const pick = a => a[Math.floor(rnd()*a.length)]
const round3 = n => Math.round(n*1000)/1000
const fails = []
const fail = m => fails.push(m)
const bal = code => S().journal.reduce((s,e)=> s + e.lines.filter(l=>l.accountCode===code).reduce((x,l)=>x+l.debit-l.credit,0),0)

S().addWarehouse('رئيسي')
const wh = S().warehouses.at(-1)
S().addItem({ nameAr:'أرز', sku:'R1', barcodes:['111'], categoryId:1, baseUnit:'كيس', extraUnits:[{nameAr:'كرتونة', factor:6, barcode:'999', priceMinor:8000}], costMinor:0, stockQty:0, priceMinor:1500, minQty:0, trackExpiry:false, trackSerial:false, warrantyMonths:0, soldByWeight:false, variantColors:[], variantSizes:[], isActive:true })
S().addItem({ nameAr:'جبن', sku:'C1', barcodes:['222'], categoryId:1, baseUnit:'كجم', extraUnits:[], costMinor:0, stockQty:0, priceMinor:3000, minQty:0, trackExpiry:false, trackSerial:false, warrantyMonths:0, soldByWeight:true, variantColors:[], variantSizes:[], isActive:true })
S().addSupplier({ nameAr:'مورد', phone:'' })
const sup = S().suppliers.at(-1)
S().addCustomer({ nameAr:'عميل', phone:'' })
const cust = S().customers.at(-1)
S().postPurchase({ supplierId: sup.id, date:'2026-11-17', lines:[{ itemId:1, warehouseId: wh.id, qty:60, unitPriceMinor:1000, vatPercent:0 }, { itemId:2, warehouseId: wh.id, qty:30, unitPriceMinor:2000, vatPercent:0 }], expenses:[], paidMinor:0, treasury:'1101' })

const check = tag => {
  const value = S().items.reduce((s,it)=> s + (it.stockValueMinor ?? Math.round(it.stockQty*it.costMinor)), 0)
  if (bal('1103') !== value) fail(`[${tag}] 1103=${bal('1103')} ≠ Σقيمة=${value}`)
  if (S().items.some(it=>it.stockQty < -1e-9)) fail(`[${tag}] مخزون سالب ${S().items.map(i=>i.nameAr+':'+i.stockQty)}`)
  if (typeof S().getCustomerBalance === 'function') {
    const c = S().customers.reduce((x,r)=>x+S().getCustomerBalance(r.id),0)
    if (c !== bal('1104')) fail(`[${tag}] 1104=${bal('1104')} ≠ Σعملاء=${c}`)
  }
  if (typeof S().getSupplierBalance === 'function') {
    const s2 = S().suppliers.reduce((x,r)=>x+S().getSupplierBalance(r.id),0)
    if (s2 !== -bal('2101')) fail(`[${tag}] 2101=${bal('2101')} ≠ Σموردين=${-s2}`)
  }
  for (const s of S().sales) {
    if (s.status === 'void' || s.voidedAt) continue
    const entry = S().journal.find(e=>e.sourceType==='sale' && e.sourceId===s.id)
    if (!entry) { fail(`[${tag}] فاتورة ${s.invoiceNumber} بلا قيد`); continue }
    const d = entry.lines.reduce((x,l)=>x+l.debit,0), c = entry.lines.reduce((x,l)=>x+l.credit,0)
    if (d !== c) fail(`[${tag}] قيد ${s.invoiceNumber} غير متوازن`)
  }
  if (fails.length) { console.log(`\n❌ seed=${process.argv[2]} عند ${tag}`); [...new Set(fails)].slice(0,8).forEach(f=>console.log('  - '+f)); process.exit(1) }
}

check('init')
for (let t=0;t<50;t++) {
  const r = rnd()
  if (r < 0.5) {
    // فاتورة بسطور مكررة للصنف نفسه وبوحدتين مختلفتين (قطعة + كرتونة)
    const lines = []
    const rice = S().items.find(i=>i.sku==='R1'), cheese = S().items.find(i=>i.sku==='C1')
    if (rice.stockQty >= 6 && rnd() < 0.5) lines.push({ itemId: rice.id, nameAr: rice.nameAr, qty: 1, unitPriceMinor: 9000, unitCostMinor: rice.costMinor*6, discountPercent: 0, soldByWeight:false, unitFactor: 6 })
    if (rice.stockQty >= 2) lines.push({ itemId: rice.id, nameAr: rice.nameAr, qty: int(1,3), unitPriceMinor: 1500, unitCostMinor: rice.costMinor, discountPercent: pick([0,10]), soldByWeight:false })
    if (cheese.stockQty > 0.3) lines.push({ itemId: cheese.id, nameAr: cheese.nameAr, qty: round3(Math.min(cheese.stockQty, 0.2+rnd())), unitPriceMinor: 3000, unitCostMinor: cheese.costMinor, discountPercent: 0, soldByWeight:true })
    if (!lines.length) continue
    try {
      S().postSale({ lines, customerId: cust.id, payment: pick(['cash','credit']), invoiceDiscountPercent: pick([0,5]), taxPercent: 15, taxInclusive: pick([true,false]), treasury:'1101', paidMinor: 0, priceFloorOverrideBy:'مدير' })
    } catch(e) { if (process.env.DEBUG) console.log('⚠️ sale', e.message) }
    check('sale')
  } else if (r < 0.8) {
    // تعديل فاتورة قائمة (عكس + إعادة ترحيل)
    const sale = S().sales.at(-1)
    if (!sale) continue
    const items = S().items
    const newLines = [
      { itemId: items[0].id, nameAr: items[0].nameAr, qty: int(1,2), unitPriceMinor: 1600, unitCostMinor: items[0].costMinor, discountPercent: 0, soldByWeight:false },
    ]
    // الفاتورة تُعاد بأسعار جديدة — التكلفة تُحسب لحظة الترحيل
    try {
      S().editSale({ saleId: sale.id, lines: newLines, customerId: cust.id, payment: 'cash', paidMinor: 0, treasury:'1101', invoiceDiscountPercent: 0, reason:'تعديل اختباري', einvoiceActive: false, priceFloorOverrideBy:'مدير' })
    } catch(e) { if (process.env.DEBUG) console.log('⚠️ edit', e.message) }
    check('edit')
  } else {
    // تحصيل دفعة من عميل (سند قبض) يخفض 1104
    const due = S().customers.reduce((x,c)=>x+Math.max(0, S().getCustomerBalance(c.id)),0)
    if (due <= 0) continue
    try {
      const amount = Math.min(due, int(100, 3000))
      S().postVoucher({ kind:'receipt', partyKind:'customer', partyId: cust.id, treasury:'1101', counterAccountCode:'1104', amountMinor: amount, description:'تحصيل من عميل', date:'2026-11-17' })
    } catch(e) { if (process.env.DEBUG) console.log('⚠️ receipt', e.message) }
    check('receipt')
  }
}
console.log(`✅ seed ${process.argv[2]}: ${S().sales.length} فاتورة · ${S().vouchers?.length ?? 0} سند`)
