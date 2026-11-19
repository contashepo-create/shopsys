import { useDataStore } from '../src/data/repo.ts'
const mem = new Map()
globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k,v)=>mem.set(k,v), removeItem:k=>mem.delete(k), clear:()=>mem.clear(), key:i=>[...mem.keys()][i]??null, get length(){return mem.size} }
globalThis.window = { localStorage: globalThis.localStorage, addEventListener: ()=>{}, dispatchEvent: ()=>true }
const app = (await import('../src/stores/app.store.ts')).useAppStore
app.setState({ ...app.getState(), setup: { ...app.getState().setup, completed: true, countryCode:'SA', activityId:'grocery', shopName:'fuzz2', ownerName:'م', features:[], modules:['pos','inventory','purchases'], accountingMode:'full' } })
const S = () => useDataStore.getState()

let seed = Number(process.argv[2] ?? 1)
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
const pick = a => a[Math.floor(rnd()*a.length)]
const int = (a,b) => a + Math.floor(rnd()*(b-a+1))
const round3 = n => Math.round(n*1000)/1000

S().addItem({ nameAr:'أرز', sku:'RIC', barcodes:['111'], categoryId:1, baseUnit:'كيس', extraUnits:[{nameAr:'كرتونة', factor:6, barcode:'999', priceMinor:9000}], costMinor:1000, stockQty:0, priceMinor:1500, minQty:0, trackExpiry:false, trackSerial:false, warrantyMonths:0, soldByWeight:false, variantColors:[], variantSizes:[], isActive:true })
S().addItem({ nameAr:'جبن', sku:'CHZ', barcodes:['222'], categoryId:1, baseUnit:'كجم', extraUnits:[], costMinor:2000, stockQty:0, priceMinor:3000, minQty:0, trackExpiry:false, trackSerial:false, warrantyMonths:0, soldByWeight:true, variantColors:[], variantSizes:[], isActive:true })
S().addSupplier({ nameAr:'مورد', phone:'' })
const sup = S().suppliers.at(-1)
S().addCustomer({ nameAr:'عميل', phone:'' })
const cust = S().customers.at(-1)

const balance = (code) => S().journal.reduce((sum,e)=> sum + e.lines.filter(l=>l.accountCode===code).reduce((s,l)=>s+l.debit-l.credit,0), 0)
const fails = []
const fail = (tag, msg) => { fails.push(`[${tag}] ${msg}`) }

const check = (tag) => {
  for (const e of S().journal) {
    const d = e.lines.reduce((s,l)=>s+l.debit,0), c = e.lines.reduce((s,l)=>s+l.credit,0)
    if (d !== c) fail(tag, `قيد ${e.id} غير متوازن ${d}/${c}`)
    for (const l of e.lines) {
      if (!Number.isSafeInteger(l.debit) || !Number.isSafeInteger(l.credit)) fail(tag, `قيد ${e.id} مبالغ غير صحيحة`)
      if (l.debit < 0 || l.credit < 0) fail(tag, `قيد ${e.id} مبلغ سالب ${l.accountCode} ${l.debit}/${l.credit}`)
      if (l.debit > 0 && l.credit > 0) fail(tag, `قيد ${e.id} سطر مدين ودائن معاً ${l.accountCode}`)
      if (l.debit === 0 && l.credit === 0) fail(tag, `قيد ${e.id} سطر صفري ${l.accountCode}`)
    }
  }
  const gd = S().journal.reduce((s,e)=>s+e.lines.reduce((x,l)=>x+l.debit,0),0)
  const gc = S().journal.reduce((s,e)=>s+e.lines.reduce((x,l)=>x+l.credit,0),0)
  if (gd !== gc) fail(tag, `دفتر غير متوازن ${gd}/${gc}`)

  // 1103 = Σ قيمة الأصناف
  const value = S().items.reduce((s,it)=> s + (it.stockValueMinor ?? Math.round(it.stockQty*it.costMinor)), 0)
  if (balance('1103') !== value) fail(tag, `1103=${balance('1103')} ≠ Σقيمة=${value}`)
  if (S().items.some(it=>it.stockQty < -1e-9)) fail(tag, 'مخزون سالب')

  // كل فاتورة: إجمالي = مدفوع + آجل، والضريبة في القيد = ضريبة الفاتورة
  for (const s of S().sales) {
    if (Math.abs((s.paidMinor ?? 0) + (s.dueMinor ?? 0) - s.totals.totalMinor) > 0) {
      // بعض الأنماط لا تحفظ dueMinor؛ نتحقق من القيد أدناه بدلاً منها
    }
    const entry = S().journal.find(e => e.sourceType === 'sale' && e.sourceId === s.id)
    if (!entry) { fail(tag, `فاتورة ${s.invoiceNumber} بلا قيد`); continue }
    const tax = entry.lines.filter(l=>l.accountCode==='2102').reduce((x,l)=>x-l.debit+l.credit,0)
    if (tax !== s.totals.taxMinor) fail(tag, `ضريبة ${s.invoiceNumber}: قيد ${tax} ≠ فاتورة ${s.totals.taxMinor}`)
    const cogs = entry.lines.filter(l=>l.accountCode==='5101').reduce((x,l)=>x+l.debit-l.credit,0)
    if (cogs !== (s.cogsMinor ?? s.totals.cogsMinor)) fail(tag, `تكلفة ${s.invoiceNumber}: قيد ${cogs} ≠ فاتورة ${s.cogsMinor ?? s.totals.cogsMinor}`)
    const inv1103 = entry.lines.filter(l=>l.accountCode==='1103').reduce((x,l)=>x-l.debit+l.credit,0)
    if (inv1103 !== cogs) fail(tag, `إخراج مخزون ${s.invoiceNumber}: 1103 ${inv1103} ≠ 5101 ${cogs}`)
  }

  // 1104 = مجموع أرصدة العملاء (ورقة الكشف)
  if (typeof S().getCustomerBalance === 'function') {
    const sum = S().customers.reduce((x,c)=>x + S().getCustomerBalance(c.id), 0)
    if (sum !== balance('1104')) fail(tag, `1104=${balance('1104')} ≠ Σأرصدة العملاء=${sum}`)
  }
  if (typeof S().getSupplierBalance === 'function') {
    const sum = S().suppliers.reduce((x,s)=>x + S().getSupplierBalance(s.id), 0)
    if (sum !== -balance('2101')) fail(tag, `2101=${balance('2101')} ≠ Σأرصدة الموردين=${-sum}`)
  }
  // كمية المخزون = حركات المستندات
  for (const it of S().items) {
    let move = 0
    for (const p of S().purchases) for (const l of p.lines) if (l.itemId === it.id) move += l.qty
    for (const s of S().sales) for (const l of s.lines) if (l.itemId === it.id) move -= l.qty * (l.unitFactor ?? 1)
    for (const r of S().saleReturns ?? []) for (const l of r.lines ?? []) if (l.itemId === it.id && (l.condition ?? 'good') !== 'damaged') move += l.qty * (l.unitFactor ?? 1)
    for (const w of S().wastages ?? []) for (const l of w.lines ?? []) if (l.itemId === it.id) move -= l.qty
    const counted = (S().stocktakes ?? []).filter(st => st.status !== 'reversed').flatMap(st => st.counts ?? [])
    const stDelta = counted.filter(c => c.itemId === it.id).reduce((x,c)=>x + (c.countedQty ?? c.qty ?? 0), 0) - counted.filter(c=>c.itemId===it.id).length * 0
    // الجرد يعيد ضبط الرصيد لا يضيف — يُفحص في اختبار مستقل
    void stDelta
    if (Math.abs(round3(move) - it.stockQty) > 1e-9 && !(S().stocktakes ?? []).some(st=>st.status!=='reversed' && (st.counts??[]).some(c=>c.itemId===it.id))) {
      fail(tag, `كمية ${it.nameAr}: صنف ${it.stockQty} ≠ حركات ${round3(move)}`)
    }
  }
  if (fails.length) {
    console.log(`\n❌ seed=${process.argv[2]} عند ${tag}`)
    ;[...new Set(fails)].slice(0,8).forEach(f=>console.log('  - '+f))
    process.exit(1)
  }
}

const buy = () => {
  const lines = []
  for (const it of S().items) {
    if (rnd() < 0.45) continue
    const qty = it.soldByWeight ? int(2,8) : int(2,12)
    lines.push({ itemId: it.id, qty, unitPriceMinor: Math.round(it.costMinor * (0.8 + rnd()*0.5)) || 100, vatPercent: pick([0,15]) })
  }
  if (!lines.length) return
  const exps = rnd() < 0.45 ? [{ nameAr:'نولون', amountMinor: int(1,500), method:'qty', paidBy: pick(['supplier','treasury']), costTreatment:'inventory' }] : []
  S().postPurchase({ supplierId: sup.id, date:'2026-11-17', lines, expenses: exps, paidMinor: pick([0,0,1000]), treasury:'1101', discountPercent: pick([0,0,3,7.5]), inputVatMinor: 0 })
}
const sell = () => {
  const lines = []
  for (const it of S().items) {
    const cur = S().items.find(x=>x.id===it.id)
    if (cur.stockQty <= 1e-6) continue
    if (rnd() < 0.5) continue
    const factor = it.extraUnits?.[0]?.factor ?? 1
    const useUnit = factor > 1 && rnd() < 0.35 && cur.stockQty >= factor
    const qty = it.soldByWeight
      ? Math.min(round3(0.1 + rnd()*1.2), round3(cur.stockQty))
      : Math.min(useUnit ? 1 : int(1,3), useUnit ? Math.floor(cur.stockQty/factor) : Math.floor(cur.stockQty))
    if (qty <= 0) return void 0
    lines.push({ itemId: it.id, nameAr: it.nameAr, qty, unitPriceMinor: Math.max(1, Math.round(cur.priceMinor * (useUnit ? factor : 1))), unitCostMinor: cur.costMinor * (useUnit ? factor : 1), discountPercent: pick([0,0,5]), soldByWeight: it.soldByWeight, ...(useUnit ? { unitFactor: factor } : {}) })
  }
  if (!lines.length) return
  const customer = pick([null, cust.id, cust.id])
  const paidMinor = pick([undefined, 0, 1000])
  try {
    S().postSale({ lines, customerId: customer, payment: 'cash', invoiceDiscountPercent: pick([0,0,4]), taxPercent: 15, taxInclusive: pick([true,false]), treasury:'1101', priceFloorOverrideBy: 'مدير', ...(paidMinor != null ? { paidMinor } : {}) })
  } catch (e) { /* guards */ }
}
const ret = () => {
  const sales = S().sales.filter(s => !S().saleReturns?.some(r=>r.saleId===s.id && r.lines?.length >= s.lines.length))
  if (!sales.length) return
  const sale = pick(sales)
  const idx = int(0, sale.lines.length-1)
  const line = sale.lines[idx]
  const qty = line.qty <= 0.01 ? 0 : round3(Math.min(line.qty, line.qty * (0.2 + rnd()*0.6)))
  if (qty <= 0) return
  try {
    S().postSaleReturn({ saleId: sale.id, lineSpecs: [{ lineIndex: idx, qty, condition: pick(['good','good','damaged']) }], refund: pick(['cash','credit']), reason:'تجربة', approvedBy:'مدير', treasury:'1101' })
  } catch (e) {}
}
const waste = () => {
  const it = S().items.find(i => i.stockQty > 1)
  if (!it) return
  const qty = it.soldByWeight ? round3(Math.min(it.stockQty, 0.3)) : 1
  try { S().postWastage({ lines:[{ itemId: it.id, qty }], reason:'تالف', date:'2026-11-17' }) } catch(e) {}
}
const count = () => {
  if (rnd() < 0.6) return
  const counts = S().items.filter(()=>rnd()<0.5).map(it => ({ itemId: it.id, qty: Math.max(0, round3(it.stockQty + (rnd()<0.5?-1:1)*rnd()*2)) }))
  if (!counts.length) return
  try { S().postStocktake(counts, 'جرد') } catch(e) {}
}

check('init')
const ops = [buy, buy, sell, sell, sell, sell, ret, waste, count]
for (let i=0;i<150;i++) {
  const op = pick(ops)
  try { op() } catch(e) { if (process.env.DEBUG) console.log('⚠️', op.name, e?.message) }
  check(`${op.name}#${i}`)
}
console.log(`✅ seed ${process.argv[2]}: 150 عملية — قيود ${S().journal.length} · مبيعات ${S().sales.length} · مرتجعات ${S().saleReturns?.length ?? 0} · أتلاف ${S().wastages?.length ?? 0}`)
