import { useDataStore } from '../src/data/repo.ts'
const mem = new Map()
globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k,v)=>mem.set(k,v), removeItem:k=>mem.delete(k), clear:()=>mem.clear(), key:i=>[...mem.keys()][i]??null, get length(){return mem.size} }
globalThis.window = { localStorage: globalThis.localStorage, addEventListener: ()=>{}, dispatchEvent: ()=>true }
const app = (await import('../src/stores/app.store.ts')).useAppStore
app.setState({ ...app.getState(), setup: { ...app.getState().setup, completed: true, countryCode:'SA', activityId:'grocery', shopName:'fuzz6', ownerName:'م', features:[], modules:['pos','inventory','purchases'], accountingMode:'full' } })
const S = () => useDataStore.getState()
let seed = Number(process.argv[2] ?? 1)
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
const int = (a,b) => a + Math.floor(rnd()*(b-a+1))
const pick = a => a[Math.floor(rnd()*a.length)]
const round3 = n => Math.round(n*1000)/1000
const fails = []
const fail = m => fails.push(m)
const bal = code => S().journal.reduce((s,e)=> s + e.lines.filter(l=>l.accountCode===code).reduce((x,l)=>x+l.debit-l.credit,0),0)

S().addItem({ nameAr:'أرز', sku:'R1', barcodes:['111'], categoryId:1, baseUnit:'كيس', extraUnits:[], costMinor:1000, stockQty:0, priceMinor:1500, minQty:0, trackExpiry:false, trackSerial:false, warrantyMonths:0, soldByWeight:false, variantColors:[], variantSizes:[], isActive:true, warehouseId: null })
S().addItem({ nameAr:'جبن', sku:'C1', barcodes:['222'], categoryId:1, baseUnit:'كجم', extraUnits:[], costMinor:2000, stockQty:0, priceMinor:3000, minQty:0, trackExpiry:false, trackSerial:false, warrantyMonths:0, soldByWeight:true, variantColors:[], variantSizes:[], isActive:true })
S().addSupplier({ nameAr:'مورد', phone:'' })
S().addWarehouse('المخزن الرئيسي')
const mainWh = S().warehouses.at(-1)
S().addWarehouse('فرع ثانٍ')
const secondWh = S().warehouses.at(-1)
const sup = S().suppliers.at(-1)
S().addCustomer({ nameAr:'عميل', phone:'' })
const cust = S().customers.at(-1)

const check = tag => {
  const value = S().items.reduce((s,it)=> s + (it.stockValueMinor ?? Math.round(it.stockQty*it.costMinor)), 0)
  if (bal('1103') !== value) fail(`[${tag}] 1103=${bal('1103')} ≠ Σقيمة=${value}`)
  if (S().items.some(it=>it.stockQty < -1e-9)) fail(`[${tag}] مخزون سالب ${S().items.map(i=>i.stockQty)}`)
  if (typeof S().getSupplierBalance === 'function') {
    const st = S().suppliers.reduce((x,s)=> x + S().getSupplierBalance(s.id), 0)
    if (st !== -bal('2101')) fail(`[${tag}] 2101=${bal('2101')} ≠ Σكشوف الموردين=${-st}`)
  }
  for (const pr of S().purchaseReturns ?? []) {
    const entry = S().journal.find(e => e.sourceType === 'purchase_return' && e.sourceId === pr.id)
    if (!entry) { fail(`[${tag}] مرتجع شراء ${pr.id} بلا قيد`); continue }
    if (process.env.DUMP) console.log('PRETRY', JSON.stringify(entry.lines.map(l=>`${l.accountCode} ${l.debit}/${l.credit} ${l.note??''}`)))
    const d = entry.lines.reduce((x,l)=>x+l.debit,0), c = entry.lines.reduce((x,l)=>x+l.credit,0)
    if (d !== c) fail(`[${tag}] قيد مرتجع شراء غير متوازن ${d}/${c}`)
    const invOut = entry.lines.filter(l=>l.accountCode==='1103').reduce((x,l)=>x-l.debit+l.credit,0)
    const supplierBack = entry.lines.filter(l=>l.accountCode==='2101').reduce((x,l)=>x+l.debit-l.credit,0)
    const cashBack = entry.lines.filter(l=>l.accountCode==='1101').reduce((x,l)=>x+l.debit-l.credit,0)
    const vatBack = entry.lines.filter(l=>l.accountCode==='2102').reduce((x,l)=>x-l.debit+l.credit,0)
    if (invOut <= 0) fail(`[${tag}] مرتجع شراء ${pr.id} بلا إخراج مخزون (${invOut})`)
    // الردّ = سعر الفاتورة + ضريبتها (لا التكلفة المحملة)؛ فرق المصاريف المحملة
    // غير المستردة يُقيَّد مصروفاً (5111) ولا يُخفى في التكلفة.
    // مطابقة المستند بالقيد (لا تقديرات)
    if (supplierBack + cashBack !== (pr.supplierValueMinor ?? pr.totalMinor) + (pr.inputVatShareMinor ?? 0)) fail(`[${tag}] مرتجع شراء ${pr.id}: المردود ${supplierBack + cashBack} ≠ المستند ${(pr.supplierValueMinor ?? pr.totalMinor) + (pr.inputVatShareMinor ?? 0)}`)
    if (vatBack !== (pr.inputVatShareMinor ?? 0)) fail(`[${tag}] مرتجع شراء ${pr.id}: ضريبة القيد ${vatBack} ≠ المستند ${pr.inputVatShareMinor}`)
    if (invOut !== (pr.inventoryOutMinor ?? invOut)) fail(`[${tag}] مرتجع شراء ${pr.id}: مخزون القيد ${invOut} ≠ المستند ${pr.inventoryOutMinor}`)
  }
  // مرتجعات الشراء لا تتجاوز المشتريات
  for (const p of S().purchases) {
    const rets = (S().purchaseReturns ?? []).filter(r => r.purchaseId === p.id)
    for (const line of p.lines) {
      const returned = rets.flatMap(r => r.lines).filter(l => l.itemId === line.itemId).reduce((x,l)=>x+l.qty,0)
      if (returned > line.qty + 1e-9) fail(`[${tag}] مرتجع شراء ${p.invoiceNumber}: ${returned} > ${line.qty}`)
    }
  }
  if (fails.length) { console.log(`\n❌ seed=${process.argv[2]} عند ${tag}`); [...new Set(fails)].slice(0,8).forEach(f=>console.log('  - '+f)); process.exit(1) }
}

check('init')
for (let t=0;t<45;t++) {
  const lines = S().items.map(it => ({ itemId: it.id, qty: it.soldByWeight ? round3(2+rnd()*5) : int(2,10), unitPriceMinor: Math.round(it.costMinor*(0.85+rnd()*0.4)) || 500, vatPercent: 15 }))
  let purchase
  try {
    purchase = S().postPurchase({ supplierId: sup.id, date:'2026-11-17', lines, expenses: rnd()<0.4?[{ nameAr:'نقل', amountMinor: int(1,400), method:'qty', paidBy:'supplier', costTreatment:'inventory' }]:[], paidMinor: 0, treasury:'1101', discountPercent: pick([0,0,4]) })
  } catch(e) { if (process.env.DEBUG) console.log('⚠️ purchase', e.message); continue }
  check('purchase')
  // مرتجع شراء جزئي على سطر عشوائي
  const idx = int(0, purchase.lines.length-1)
  const line = purchase.lines[idx]
  const qty = line.qty * pick([0.3, 0.5, 1])
  if (qty > 0) {
    try {
      S().postPurchaseReturn({ purchaseId: purchase.id, warehouseId: mainWh.id, lineSpecs:[{ lineIndex: idx, qty: round3(qty) }], refund: pick(['cash','debt']), reason:'مرتجع', treasury:'1101' })
    } catch(e) { if (process.env.DEBUG) console.log('⚠️ pret', e.message, e.stack?.split('\n').slice(1,4).join(' | ')) }
    check('purchase-return')
  }
  // تحويل مخزني: القيمة تُنقل بين المخازن ولا تُنشئ ربحاً/خسارة
  const moveIt = S().items[int(0, S().items.length-1)]
  if (moveIt.stockQty > 1 && rnd() < 0.5) {
    try {
      S().postTransfer({ fromWarehouseId: mainWh.id, toWarehouseId: secondWh.id, lines:[{ itemId: moveIt.id, qty: moveIt.soldByWeight ? round3(Math.min(1, moveIt.stockQty)) : 1 }], notes:'تحويل اختبار' })
    } catch(e) { if (process.env.DEBUG) console.log('⚠️ transfer', e.message) }
    check('transfer')
  }
  // بيع
  const it = S().items[int(0, S().items.length-1)]
  if (it.stockQty > 0.5) {
    try {
      S().postSale({ lines:[{ itemId: it.id, nameAr: it.nameAr, qty: it.soldByWeight ? round3(Math.min(1, it.stockQty)) : Math.min(2, Math.floor(it.stockQty)), unitPriceMinor: Math.max(1,it.priceMinor), unitCostMinor: it.costMinor, discountPercent:0, soldByWeight: it.soldByWeight }], customerId: cust.id, payment: pick(['cash','credit']), invoiceDiscountPercent: 0, taxPercent: 15, taxInclusive: true, treasury:'1101', paidMinor: 0, priceFloorOverrideBy:'مدير' })
    } catch(e) { if (process.env.DEBUG) console.log('⚠️ sale', e.message) }
    check('sale')
  }
}
console.log(`✅ seed ${process.argv[2]}: ${S().purchases.length} مشتريات · ${S().purchaseReturns?.length ?? 0} مرتجع شراء · ${S().sales.length} بيع`)
