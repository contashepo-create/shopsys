import { useDataStore } from '../src/data/repo.ts'
const mem = new Map()
globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k,v)=>mem.set(k,v), removeItem:k=>mem.delete(k), clear:()=>mem.clear(), key:i=>[...mem.keys()][i]??null, get length(){return mem.size} }
globalThis.window = { localStorage: globalThis.localStorage, addEventListener: ()=>{}, dispatchEvent: ()=>true }
const app = (await import('../src/stores/app.store.ts')).useAppStore
app.setState({ ...app.getState(), setup: { ...app.getState().setup, completed: true, countryCode:'SA', activityId:'grocery', shopName:'fuzz3', ownerName:'م', features:[], modules:['pos','inventory','purchases'], accountingMode:'full' } })
const S = () => useDataStore.getState()
let seed = Number(process.argv[2] ?? 1)
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
const pick = a => a[Math.floor(rnd()*a.length)]
const int = (a,b) => a + Math.floor(rnd()*(b-a+1))
const round3 = n => Math.round(n*1000)/1000
const fails = []
const fail = (t,m) => fails.push(`[${t}] ${m}`)
const bal = code => S().journal.reduce((s,e)=> s + e.lines.filter(l=>l.accountCode===code).reduce((x,l)=>x+l.debit-l.credit,0),0)

S().addItem({ nameAr:'أرز', sku:'RIC', barcodes:['111'], categoryId:1, baseUnit:'كيس', extraUnits:[], costMinor:1000, stockQty:0, priceMinor:1500, minQty:0, trackExpiry:false, trackSerial:false, warrantyMonths:0, soldByWeight:false, variantColors:[], variantSizes:[], isActive:true })
S().addItem({ nameAr:'جبن', sku:'CHZ', barcodes:['222'], categoryId:1, baseUnit:'كجم', extraUnits:[], costMinor:2000, stockQty:0, priceMinor:3000, minQty:0, trackExpiry:false, trackSerial:false, warrantyMonths:0, soldByWeight:true, variantColors:[], variantSizes:[], isActive:true })
S().addSupplier({ nameAr:'مورد', phone:'' })
const sup = S().suppliers.at(-1)
S().addCustomer({ nameAr:'عميل', phone:'' })
const cust = S().customers.at(-1)

// مخزون افتتاحي عبر شراء آجل (بلا نقدية)
S().postPurchase({ supplierId: sup.id, date:'2026-11-17', lines:[{ itemId: 1, qty: 40, unitPriceMinor: 1000, vatPercent: 0 }, { itemId: 2, qty: 20, unitPriceMinor: 2000, vatPercent: 0 }], expenses: [], paidMinor: 0, treasury: '1101' })

const expectedCash = () => {
  let cash = 0
  for (const s of S().sales) {
    // المحصل فعلاً وقت الفاتورة: نقدي كامل، وجزئي = المدفوع، وآجل = صفر
    if (s.payment === 'cash') cash += (s.paidMinor ?? s.totals.totalMinor)
    else if (s.payment === 'split') cash += (s.paidMinor ?? 0)
  }
  for (const r of S().saleReturns ?? []) if ((r.refundMode ?? r.refund) === 'cash') cash -= (r.totalMinor ?? 0)
  for (const p of S().purchases) cash -= (p.paidMinor ?? 0)
  for (const w of S().wastages ?? []) void w
  return cash
}

const check = (tag) => {
  if (S().journal.length) {
    const gd = S().journal.reduce((s,e)=>s+e.lines.reduce((x,l)=>x+l.debit,0),0)
    const gc = S().journal.reduce((s,e)=>s+e.lines.reduce((x,l)=>x+l.credit,0),0)
    if (gd !== gc) fail(tag, `دفتر غير متوازن ${gd}/${gc}`)
  }
  const value = S().items.reduce((s,it)=> s + (it.stockValueMinor ?? Math.round(it.stockQty*it.costMinor)), 0)
  if (bal('1103') !== value) fail(tag, `1103=${bal('1103')} ≠ Σقيمة=${value}`)
  const cashLedger = bal('1101')
  const cashDocs = expectedCash()
  if (cashLedger !== cashDocs) fail(tag, `الخزينة ${cashLedger} ≠ حركات المستندات النقدية ${cashDocs}`)
  if (cashLedger < 0) fail(tag, `خزينة سالبة ${cashLedger}`)
  if (fails.length) { console.log(`\n❌ seed=${process.argv[2]} عند ${tag}`); [...new Set(fails)].slice(0,6).forEach(f=>console.log('  - '+f)); process.exit(1) }
}

const sell = () => {
  const cur = S().items.filter(i=>i.stockQty > 0.01)
  if (!cur.length) return
  const it = pick(cur)
  const qty = it.soldByWeight ? Math.min(round3(0.2+rnd()*1), round3(it.stockQty)) : Math.min(int(1,3), Math.floor(it.stockQty))
  if (qty <= 0) return
  const mode = pick(['cash','cash','split','credit'])
  const price = Math.max(1, it.priceMinor)
  const total = Math.round(qty*price*1.15)
  try {
    S().postSale({
      lines:[{ itemId: it.id, nameAr: it.nameAr, qty, unitPriceMinor: price, unitCostMinor: it.costMinor, discountPercent: 0, soldByWeight: it.soldByWeight }],
      customerId: mode === 'credit' || mode === 'split' ? cust.id : null,
      payment: mode === 'credit' ? 'credit' : mode === 'split' ? 'split' : 'cash',
      invoiceDiscountPercent: pick([0,0,5]), taxPercent: 15, taxInclusive: true, treasury:'1101',
      ...(mode === 'split' ? { paidMinor: Math.round(total*0.4) } : {}),
      priceFloorOverrideBy: 'مدير',
    })
  } catch(e) { if (process.env.DEBUG) console.log('⚠️ sale', e.message) }
}

const shiftCycle = () => {
  if (!S().shifts.some(s=>s.status==='open')) {
    try { S().openShift('كاشير', int(0,50000)) } catch(e) {}
    return
  }
  const open = S().shifts.find(s=>s.status==='open')
  const sum = S().getShiftSummary(open.id)
  const counted = Math.max(0, sum.expectedCashMinor + pick([0,0,0,-500,700]))
  try { S().closeShift(counted, 'مدير') } catch(e) { if (process.env.DEBUG) console.log('⚠️ close', e.message); return }
  const closed = S().shifts.at(-1)
  if (closed.varianceMinor && closed.varianceMinor !== 0 && rnd() < 0.6) {
    try { S().settleShiftVariance({ shiftId: closed.id, mode:'expense', employeeId: 0, approvedBy:'مدير' }) } catch(e) { if (process.env.DEBUG) console.log('⚠️ settle', e.message) }
  }
}

check('init')
for (let i=0;i<120;i++) {
  const r = rnd()
  if (r < 0.12) shiftCycle()
  else if (r < 0.85) sell()
  else try { S().openShift('كاشير', int(0,20000)) } catch(e) {}
  check(`op#${i}`)
}
console.log(`✅ seed ${process.argv[2]}: قيود ${S().journal.length} · مبيعات ${S().sales.length} · ورديات ${S().shifts.length}`)
