import { useDataStore } from '../src/data/repo.ts'
const mem = new Map()
globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k,v)=>mem.set(k,v), removeItem:k=>mem.delete(k), clear:()=>mem.clear(), key:i=>[...mem.keys()][i]??null, get length(){return mem.size} }
globalThis.window = { localStorage: globalThis.localStorage, addEventListener: ()=>{}, dispatchEvent: ()=>true }
const app = (await import('../src/stores/app.store.ts')).useAppStore
app.setState({ ...app.getState(), setup: { ...app.getState().setup, completed: true, countryCode:'SA', activityId:'grocery', shopName:'fuzz5', ownerName:'م', features:[], modules:['pos','inventory','purchases'], accountingMode:'full' } })
const S = () => useDataStore.getState()
let seed = Number(process.argv[2] ?? 1)
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
const int = (a,b) => a + Math.floor(rnd()*(b-a+1))
const pick = a => a[Math.floor(rnd()*a.length)]
const round3 = n => Math.round(n*1000)/1000
const fails = []
const fail = (m) => fails.push(m)
const bal = code => S().journal.reduce((s,e)=> s + e.lines.filter(l=>l.accountCode===code).reduce((x,l)=>x+l.debit-l.credit,0),0)

S().addItem({ nameAr:'أرز', sku:'R1', barcodes:['111'], categoryId:1, baseUnit:'كيس', extraUnits:[], costMinor:1000, stockQty:0, priceMinor:1500, minQty:0, trackExpiry:false, trackSerial:false, warrantyMonths:0, soldByWeight:false, variantColors:[], variantSizes:[], isActive:true })
S().addItem({ nameAr:'جبن', sku:'C1', barcodes:['222'], categoryId:1, baseUnit:'كجم', extraUnits:[], costMinor:2000, stockQty:0, priceMinor:3000, minQty:0, trackExpiry:false, trackSerial:false, warrantyMonths:0, soldByWeight:true, variantColors:[], variantSizes:[], isActive:true })
S().addSupplier({ nameAr:'مورد', phone:'' })
const sup = S().suppliers.at(-1)
S().addCustomer({ nameAr:'عميل', phone:'' })
const cust = S().customers.at(-1)
S().postPurchase({ supplierId: sup.id, date:'2026-11-17', lines:[{ itemId:1, qty:100, unitPriceMinor:1000, vatPercent:0 }, { itemId:2, qty:50, unitPriceMinor:2000, vatPercent:0 }], expenses:[], paidMinor:0, treasury:'1101' })

const check = (tag) => {
  const value = S().items.reduce((s,it)=> s + (it.stockValueMinor ?? Math.round(it.stockQty*it.costMinor)), 0)
  if (bal('1103') !== value) fail(`[${tag}] 1103=${bal('1103')} ≠ Σقيمة=${value}`)
  if (S().items.some(it=>it.stockQty < -1e-9)) fail(`[${tag}] مخزون سالب`)
  for (const s of S().sales) {
    const entry = S().journal.find(e=>e.sourceType==='sale' && e.sourceId===s.id)
    if (!entry) continue
    const cogs = entry.lines.filter(l=>l.accountCode==='5101').reduce((x,l)=>x+l.debit,0)
    const inv = entry.lines.filter(l=>l.accountCode==='1103').reduce((x,l)=>x-l.debit+l.credit,0)
    if (cogs !== inv) fail(`[${tag}] فاتورة ${s.invoiceNumber}: 5101 ${cogs} ≠ 1103 ${inv}`)
  }
  // المرتجعات: قيمة العودة إلى المخزون = استرجاع التكلفة (5101/−1103) بالضبط
  for (const r of S().saleReturns ?? []) {
    const entry = S().journal.find(e=>e.sourceType==='sale_return' && e.sourceId===r.id)
    if (!entry) { fail(`[${tag}] مرتجع ${r.returnNumber ?? r.id} بلا قيد`); continue }
    const d = entry.lines.reduce((x,l)=>x+l.debit,0), c = entry.lines.reduce((x,l)=>x+l.credit,0)
    if (d !== c) fail(`[${tag}] قيد مرتجع غير متوازن ${d}/${c}`)
    const invIn = entry.lines.filter(l=>l.accountCode==='1103').reduce((x,l)=>x+l.debit-l.credit,0)
    const cogsOut = entry.lines.filter(l=>l.accountCode==='5101').reduce((x,l)=>x-l.debit+l.credit,0)
    const damageIn = entry.lines.filter(l=>l.accountCode==='5111').reduce((x,l)=>x+l.debit-l.credit,0)
    // السليم: تعود البضاعة للمخزون وتُنعكس تكلفتها. التالف: لا يعود للمخزون،
    // وتكلفته تنتقل من 5101 إلى 5111 (هالك) — لا تُخفى ولا تُترك في التكلفة.
    if (invIn !== cogsOut - damageIn) fail(`[${tag}] مرتجع ${r.id}: مخزون ${invIn} ≠ عكس تكلفة ${cogsOut} − هالك ${damageIn}`)
    if (damageIn > 0 && invIn !== 0) fail(`[${tag}] مرتجع ${r.id}: تالف أعاد مخزوناً ${invIn}`)
    const revenueBack = entry.lines.filter(l=>l.accountCode==='4102').reduce((x,l)=>x+l.debit,0)
    const total = r.totals?.totalMinor ?? 0
    const taxBack = entry.lines.filter(l=>l.accountCode==='2102').reduce((x,l)=>x+l.debit,0)
    if (revenueBack + taxBack !== total) fail(`[${tag}] مرتجع ${r.id}: إيراد ${revenueBack}+ض ${taxBack} ≠ ${total}`)
  }
  // مجموع المرتجعات لا يتجاوز الفاتورة
  for (const s of S().sales) {
    const returns = (S().saleReturns ?? []).filter(r=>r.saleId===s.id)
    const sum = returns.reduce((x,r)=>x+(r.totals?.totalMinor??0),0)
    if (sum > s.totals.totalMinor) fail(`[${tag}] مرتجعات ${s.invoiceNumber} ${sum} > إجماليها ${s.totals.totalMinor}`)
  }
  if (fails.length) { console.log(`\n❌ seed=${process.argv[2]} عند ${tag}`); [...new Set(fails)].slice(0,8).forEach(f=>console.log('  - '+f)); process.exit(1) }
}

check('init')
for (let t=0;t<60;t++) {
  // فاتورة عشوائية بخصومات مختلفة
  const lines = [
    { itemId:1, nameAr:'أرز', qty:int(1,4), unitPriceMinor:int(1200,1800), unitCostMinor:1000, discountPercent:pick([0,5,10]), soldByWeight:false },
    { itemId:2, nameAr:'جبن', qty:round3(0.3+rnd()*2), unitPriceMinor:int(2500,3500), unitCostMinor:2000, discountPercent:pick([0,0,7]), soldByWeight:true },
  ]
  let sale
  try {
    sale = S().postSale({ lines, customerId: cust.id, payment:'cash', invoiceDiscountPercent: pick([0,0,5,12.5]), taxPercent: 15, taxInclusive: pick([true,false]), treasury:'1101', paidMinor: 0, priceFloorOverrideBy:'مدير' })
  } catch(e) { if (process.env.DEBUG) console.log('⚠️ sale', e.message); continue }
  check('sale')
  // مرتجعات متتالية على نفس الفاتورة (سليم/تالف، نقد/رصيد)
  const plan = [
    { idx: 0, qty: sale.lines[0].qty * pick([0.5,1]), condition:'good' },
    { idx: 1, qty: round3(sale.lines[1].qty * pick([0.3,0.5,1])), condition:pick(['good','damaged']) },
  ]
  for (const step of plan) {
    if (step.qty <= 0) continue
    try {
      S().postSaleReturn({ saleId: sale.id, lineSpecs:[{ lineIndex: step.idx, qty: round3(Math.min(step.qty, sale.lines[step.idx].qty)), condition: step.condition }], refund: pick(['cash','credit']), reason:'اختبار', approvedBy:'مدير', treasury:'1101' })
    } catch(e) { if (process.env.DEBUG) console.log('⚠️ return', e.message) }
    check('return')
  }
  // محاولة إرجاع كل الكمية مرة أخرى: يجب أن تُرفض (منع الإرجاع الزائد)
  const before = (S().saleReturns ?? []).length
  try {
    S().postSaleReturn({ saleId: sale.id, lineSpecs:[{ lineIndex: 0, qty: sale.lines[0].qty, condition:'good' }], refund:'cash', reason:'إفراط', approvedBy:'مدير', treasury:'1101' })
    if ((S().saleReturns ?? []).length > before) {
      const returned = (S().saleReturns ?? []).filter(r=>r.saleId===sale.id).reduce((x,r)=>x+ (r.lines?.[0]?.qty ?? 0), 0)
      if (returned > sale.lines[0].qty + 1e-9) fail(`[over-return] أُعيد ${returned} من ${sale.lines[0].qty}`)
    }
  } catch(e) { /* متوقع */ }
  check('over-return')
}
console.log(`✅ seed ${process.argv[2]}: 60 فاتورة ومرتجعاتها — القيود والقيم والحدود سليمة`)
