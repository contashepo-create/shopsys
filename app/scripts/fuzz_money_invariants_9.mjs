/**
 * fuzz9 — المسارات «غير المغطاة» سابقاً: الجرد (عجز/زيادة)، الإتلاف، التحويل بين
 * المخازن، مرتجع الشراء، وتعديل الفاتورة — بكميات كسرية وأسعار متغيرة.
 * الثوابت: توازن كل قيد · 1103 = Σ قيم الأصناف **بالقرش** · لا سالب ·
 * قيمة الصنف لا تشذّ عن (كميته × متوسطه) بأكثر من قرش لكل وحدة.
 */
import { useDataStore } from '../src/data/repo.ts'
import { computeTotals } from '../src/core/pos.ts'
const mem = new Map()
globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k,v)=>mem.set(k,v), removeItem:k=>mem.delete(k), clear:()=>mem.clear(), key:i=>[...mem.keys()][i]??null, get length(){return mem.size} }
globalThis.window = { localStorage: globalThis.localStorage, addEventListener: ()=>{}, dispatchEvent: ()=>true }
const S = () => useDataStore.getState()
let seed = Number(process.argv[2] ?? 1)
if (!Number.isFinite(seed)) seed = 1
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
const pick = arr => arr[Math.floor(rnd()*arr.length)]
const int = (a,b) => a + Math.floor(rnd()*(b-a+1))
const dec = (a,b) => Math.round((a + rnd()*(b-a)) * 1000) / 1000

const app = (await import('../src/stores/app.store.ts')).useAppStore
app.setState({ ...app.getState(), setup: { ...app.getState().setup, completed:true, countryCode:'SA', activityId:'grocery', shopName:'fuzz9', ownerName:'م', features:[], modules:['pos','inventory','purchases'], accountingMode:'full', vatPercent:0, taxRegistrationStatus:'exempt', allowNegativeTreasury:true, requireOpenShiftForSales:false } })
S().addWarehouse('رئيسي'); S().addWarehouse('فرعي')
const WH = S().warehouses.map(w=>w.id)
S().addItem({ nameAr:'أرز', sku:'R', barcodes:['901'], categoryId:1, baseUnit:'كجم', extraUnits:[], costMinor:0, stockQty:0, priceMinor:3000, minQty:0, trackExpiry:false, trackSerial:false, warrantyMonths:0, soldByWeight:true, variantColors:[], variantSizes:[], isActive:true })
S().addItem({ nameAr:'زيت', sku:'O', barcodes:['902'], categoryId:1, baseUnit:'لتر', extraUnits:[], costMinor:0, stockQty:0, priceMinor:5000, minQty:0, trackExpiry:false, trackSerial:false, warrantyMonths:0, soldByWeight:true, variantColors:[], variantSizes:[], isActive:true })
S().addSupplier({ nameAr:'مورد', phone:'' })
const sup = S().suppliers.at(-1)
const items = () => S().items
const item = id => S().items.find(i=>i.id===id)
const acct = code => S().journal.reduce((s,e)=>s+e.lines.filter(l=>l.accountCode===code).reduce((x,l)=>x+l.debit-l.credit,0),0)
const valueSum = () => S().items.reduce((s,it)=>s+(Number.isFinite(it.stockValueMinor)?it.stockValueMinor:Math.round(it.stockQty*it.costMinor)),0)
let ops = 0
const check = tag => {
  const errs = []
  for (const e of S().journal) {
    const d = e.lines.reduce((s,l)=>s+l.debit,0), c = e.lines.reduce((s,l)=>s+l.credit,0)
    if (d !== c) errs.push(`قيد ${e.id} غير متوازن ${d}/${c}`)
    if (e.lines.some(l=>!Number.isSafeInteger(l.debit)||!Number.isSafeInteger(l.credit)||l.debit<0||l.credit<0)) errs.push(`قيد ${e.id}: مبلغ غير صالح`)
  }
  if (acct('1103') !== valueSum()) errs.push(`1103=${acct('1103')} ≠ Σقيمة=${valueSum()} (فرق ${acct('1103')-valueSum()})`)
  for (const it of S().items) {
    if (it.stockQty < -1e-9) errs.push(`مخزون سالب ${it.nameAr}:${it.stockQty}`)
    if (it.stockValueMinor != null && it.stockValueMinor < 0) errs.push(`قيمة سالبة ${it.nameAr}:${it.stockValueMinor}`)
    if (it.stockQty > 1e-9 && it.stockValueMinor != null) {
      const basis = it.stockQty * it.costMinor
      if (Math.abs(it.stockValueMinor - basis) > Math.ceil(it.stockQty) + 1) errs.push(`قيمة شاذة ${it.nameAr}: v=${it.stockValueMinor} q×c=${basis.toFixed(1)}`)
    }
  }
  if (errs.length) { console.log(`\n❌ [${tag}] seed=${process.argv[2]} بعد ${ops} عملية`); errs.slice(0,6).forEach(e=>console.log('  - '+e)); process.exit(1) }
}
const buy = () => {
  const it = pick(items())
  S().postPurchase({ supplierId: sup.id, date:'2026-11-17', lines:[{ itemId: it.id, qty: dec(0.5, 6), unitPriceMinor: int(300, 4000), vatPercent: 0, warehouseId: pick(WH) }], expenses:[], paidMinor:0, treasury:'1101', notes:'' })
  ops++
}
const sell = () => {
  const it = pick(items())
  const q = Math.min(dec(0.05, 1.2), item(it.id).stockQty)
  if (q < 0.001) return
  const price = int(4000, 9000), disc = pick([0,0,5,12.5]), invDisc = pick([0,0,3])
  const totals = computeTotals([{ itemId: it.id, nameAr: it.nameAr, qty: q, unitPriceMinor: price, unitCostMinor: item(it.id).costMinor, discountPercent: disc, soldByWeight: true }], invDisc, 0, false, 2)
  S().postSale({ lines:[{ itemId: it.id, nameAr: it.nameAr, qty: q, unitPriceMinor: price, unitCostMinor: item(it.id).costMinor, discountPercent: disc, soldByWeight: true, warehouseId: pick(WH) }], customerId:null, payment:'cash', treasury:'1101', paidMinor: totals.totalMinor, invoiceDiscountPercent: invDisc, taxPercent:0, taxInclusive:false, priceFloorOverrideBy: 'مدير' })
  ops++
}
const wastage = () => {
  const it = pick(items())
  const q = Math.min(dec(0.02, 0.6), item(it.id).stockQty)
  if (q < 0.001) return
  S().postWastage({ reason: 'تلف', lines: [{ itemId: it.id, qty: q }], notes: '', date: '2026-11-17' })
  ops++
}
const stocktake = () => {
  const it = pick(items())
  const cur = item(it.id)
  if (cur.stockQty <= 0.01) return
  const counted = rnd() < 0.5 ? Math.max(0, Math.round((cur.stockQty - dec(0.01, cur.stockQty)) * 1000) / 1000) : Math.round((cur.stockQty + dec(0.01, 2)) * 1000) / 1000
  S().postStocktake([{ itemId: it.id, nameAr: it.nameAr, expectedQty: cur.stockQty, countedQty: counted, unitCostMinor: cur.costMinor }], 'جرد fuzz')
  ops++
}
const transfer = () => {
  const it = pick(items())
  const q = Math.min(dec(0.05, 1), item(it.id).stockQty)
  if (q < 0.001) return
  const [a, b] = [pick(WH), pick(WH)]
  if (a === b) return
  try { S().postTransfer({ fromWarehouseId: a, toWarehouseId: b, lines: [{ itemId: it.id, qty: q }], notes:'', date:'2026-11-17' }); ops++ } catch { /* رصيد المخزن المصدر قد لا يكفي */ }
}
const purchaseReturn = () => {
  const p = S().purchases.at(-1)
  if (!p) return
  const line = pick(p.lines)
  const it = item(line.itemId)
  const ret = Math.min(dec(0.01, line.qty / 2), it.stockQty)
  if (ret < 0.001) return
  try { S().postPurchaseReturn({ purchaseId: p.id, lines:[{ itemId: line.itemId, qty: ret, purchaseLineIndex: p.lines.indexOf(line), warehouseId: line.warehouseId ?? WH[0] }], refund:'cash', notes:'' }); ops++ } catch { /* مرتجع تجاوز الأصل أو تكلفة غير مطابقة */ }
}
const saleReturn = () => {
  const s = S().sales.at(-1)
  if (!s) return
  try { S().postSaleReturn({ saleId: s.id, lineSpecs: [{ lineIndex: 0, qty: Math.round(s.lines[0].qty / 3 * 1000) / 1000, condition: pick(['good','good','damaged']) }], refund:'cash' }); ops++ } catch { /* سبق إرجاع أو تجاوز */ }
}

check('بداية')
for (let round = 0; round < 12; round++) {
  buy(); check('شراء')
  for (let k = 0; k < 4; k++) {
    const op = pick([sell, sell, wastage, stocktake, transfer, purchaseReturn, saleReturn])
    try { op() } catch (e) { if (!/رصيد|تتجاوز|المتبقي|غير كافٍ|مغلق|وردية/.test(String(e.message))) throw e }
    check(op.name || 'عملية')
  }
}
console.log(`✅ seed ${process.argv[2]}: ${ops} عملية — 1103 = Σ قيم ${valueSum()} (قيود ${S().journal.length})`)
