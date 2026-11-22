/**
 * fuzz10 — مطاعم: أطباق «تُجهَّز عند الطلب» بوصفات وخامات موزونة، بيع ومرتجع،
 * وخدمات بلا مخزون. الثوابت: 1103 = Σ قيم الأصناف بالقرش · قيد الطبق = سحب خاماته
 * الدقيق · مرتجع الطبق لا يحرّك المخزون ولا تكلفة المبيعات · كل قيد متوازن.
 */
import { useDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { computeTotals } from '../src/core/pos.ts'
const mem = new Map()
globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k,v)=>mem.set(k,v), removeItem:k=>mem.delete(k), clear:()=>mem.clear(), key:i=>[...mem.keys()][i]??null, get length(){return mem.size} }
globalThis.window = { localStorage: globalThis.localStorage, addEventListener: ()=>{}, dispatchEvent: ()=>true }
const S = () => useDataStore.getState()
let seed = Number(process.argv[2] ?? 1)
if (!Number.isFinite(seed)) seed = 1
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
const pick = a => a[Math.floor(rnd()*a.length)]
const int = (a,b) => a + Math.floor(rnd()*(b-a+1))
const dec = (a,b) => Math.round((a + rnd()*(b-a)) * 1000) / 1000

const app = useAppStore.getState()
useAppStore.setState({ ...app, setup: { ...app.setup, completed:true, countryCode:'SA', activityId:'restaurant', vatPercent:0, taxRegistrationStatus:'exempt', allowNegativeTreasury:true, requireOpenShiftForSales:false } })
S().addWarehouse('مطبخ')
const wh = S().warehouses[0].id
S().addSupplier({ nameAr:'مورد', phone:'' })
const sup = S().suppliers.at(-1)
const mk = (nameAr, sku, opts) => { S().addItem({ nameAr, sku, barcodes:[], categoryId:1, baseUnit:'كجم', extraUnits:[], costMinor:0, stockQty:0, priceMinor:1000, minQty:0, trackExpiry:false, trackSerial:false, warrantyMonths:0, soldByWeight:true, variantColors:[], variantSizes:[], isActive:true, ...opts }); return S().items.at(-1) }
const bread = mk('خبز','BRD',{ baseUnit:'حبة', soldByWeight:false, priceMinor:100 })
const meat = mk('لحم','MEAT',{ priceMinor:200 })
const sauce = mk('صوص','SAUCE',{ baseUnit:'لتر', priceMinor:300 })
const dish = mk('برجر','DISH',{ baseUnit:'طبق', soldByWeight:false, priceMinor:5000 })
const svc = mk('خدمة تغليف','SVC',{ baseUnit:'خدمة', soldByWeight:false, priceMinor:500, isService:true })
S().addRecipe({ productItemId: dish.id, nameAr:'برجر', mode:'made_to_order', isActive:true, yieldQty:1, ingredients:[{ itemId: bread.id, qty:1 }, { itemId: meat.id, qty:0.35 }, { itemId: sauce.id, qty:0.05 }] })

const acct = c => S().journal.reduce((s,e)=>s+e.lines.filter(l=>l.accountCode===c).reduce((x,l)=>x+l.debit-l.credit,0),0)
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
    if (it.stockValueMinor != null && it.stockValueMinor < 0) errs.push(`قيمة سالبة ${it.nameAr}`)
  }
  if (errs.length) { console.log(`\n❌ [${tag}] seed=${process.argv[2]} بعد ${ops} عملية`); errs.slice(0,6).forEach(e=>console.log('  - '+e)); process.exit(1) }
}
const buy = () => {
  const it = pick([bread, meat, sauce])
  S().postPurchase({ supplierId: sup.id, date:'2026-11-17', lines:[{ itemId: it.id, qty: dec(1, 8), unitPriceMinor: int(90, 900), vatPercent:0, warehouseId: wh }], expenses:[], paidMinor:0, treasury:'1101', notes:'' })
  ops++
}
const sellDish = () => {
  const qty = int(1, 3)
  const unitCost = S().getRecipeUnitCost(S().recipes[0].id)
  const lines = [{ itemId: dish.id, nameAr:'برجر', qty, unitPriceMinor: 5000, unitCostMinor: unitCost, discountPercent: pick([0,0,10]), soldByWeight:false, warehouseId: wh }]
  if (rnd() < 0.3) lines.push({ itemId: svc.id, nameAr:'خدمة تغليف', qty, unitPriceMinor: 500, unitCostMinor: 0, discountPercent: 0, soldByWeight:false, warehouseId: wh })
  const totals = computeTotals(lines, 0, 0, false, 2)
  const sale = S().postSale({ lines, customerId:null, payment:'cash', treasury:'1101', paidMinor: totals.totalMinor, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false })
  ops++
  // تحقق: قيد 5101 = سحب الخامات الفعلي
  const entry = S().journal.find(e=>e.sourceType==='sale'&&e.sourceId===sale.id)
  const cogs = entry.lines.filter(l=>l.accountCode==='5101').reduce((x,l)=>x+l.debit,0)
  if (cogs !== sale.lines.reduce((a,l)=>a+(l.costTotalMinor ?? 0),0)) { console.log(`❌ قيد الطبق ${cogs} ≠ Σتكلفة السطور`); process.exit(1) }
  return sale
}
const returnDish = () => {
  const s = S().sales.at(-1)
  if (!s) return
  const before = { idx: acct('1103'), cogs: acct('5101') }
  try { S().postSaleReturn({ saleId: s.id, lineSpecs:[{ lineIndex: 0, qty: 1, condition: pick(['good','damaged']) }], refund:'cash' }); ops++ } catch { return }
  if (acct('5101') !== before.cogs) { console.log(`❌ مرتجع طبق حرّك تكلفة المبيعات: ${before.cogs} → ${acct('5101')}`); process.exit(1) }
}
const sellRaw = () => {
  const it = pick([bread, meat, sauce])
  const q = Math.min(dec(0.2, 1), S().items.find(i=>i.id===it.id).stockQty)
  if (q < 0.01) return
  const lines = [{ itemId: it.id, nameAr: it.nameAr, qty: q, unitPriceMinor: 1500, unitCostMinor: S().items.find(i=>i.id===it.id).costMinor, discountPercent: 0, soldByWeight:true, warehouseId: wh }]
  const t = computeTotals(lines, 0, 0, false, 2)
  S().postSale({ lines, customerId:null, payment:'cash', treasury:'1101', paidMinor: t.totalMinor, invoiceDiscountPercent:0, taxPercent:0, taxInclusive:false })
  ops++
}
check('بداية')
for (let r = 0; r < 10; r++) {
  buy(); check('شراء')
  for (let k = 0; k < 3; k++) {
    const op = pick([sellDish, sellDish, sellRaw, returnDish])
    try { op() } catch (e) { if (!/مخزون|متاح|المتبقي|تتجاوز/.test(String(e.message))) throw e }
    check(op.name)
  }
  returnDish(); check('مرتجع طبق')
}
console.log(`✅ seed ${process.argv[2]}: ${ops} عملية — 1103 = Σ قيم ${valueSum()} · تكلفة المبيعات ${acct('5101')}`)
