import { useDataStore } from '../src/data/repo.ts'
const mem = new Map()
globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k,v)=>mem.set(k,v), removeItem:k=>mem.delete(k), clear:()=>mem.clear(), key:i=>[...mem.keys()][i]??null, get length(){return mem.size} }
globalThis.window = { localStorage: globalThis.localStorage, addEventListener: ()=>{}, dispatchEvent: ()=>true }
const S = () => useDataStore.getState()

// seed rng
let seed = Number(process.argv[2] ?? 1)
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
const pick = arr => arr[Math.floor(rnd()*arr.length)]
const int = (a,b) => a + Math.floor(rnd()*(b-a+1))

// setup
try {
  const app = (await import('../src/stores/app.store.ts')).useAppStore
  app.setState({ ...app.getState(), setup: { ...app.getState().setup, completed: true, countryCode:'SA', activityId:'grocery', shopName:'fuzz', ownerName:'م', features:[], modules:['pos','inventory','purchases'], accountingMode:'full' } })
} catch(e) { console.log('setup fail', e.message) }

S().addItem({ nameAr:'أرز', sku:'RIC', barcodes:['111'], categoryId:1, baseUnit:'كيس', extraUnits:[], costMinor:1000, stockQty:0, priceMinor:1500, minQty:0, trackExpiry:false, trackSerial:false, warrantyMonths:0, soldByWeight:false, variantColors:[], variantSizes:[], isActive:true })
S().addItem({ nameAr:'جبن', sku:'CHZ', barcodes:['222'], categoryId:1, baseUnit:'كجم', extraUnits:[], costMinor:2000, stockQty:0, priceMinor:3000, minQty:0, trackExpiry:false, trackSerial:false, warrantyMonths:0, soldByWeight:true, variantColors:[], variantSizes:[], isActive:true })
console.log('items after setup:', S().items.length, S().items.map(i=>i.nameAr))
const [rice, cheese] = S().items
S().addSupplier({ nameAr:'مورد', phone:'' })
const sup = S().suppliers.at(-1)
try { S().addCustomer({ nameAr:'عميل', phone:'' }) } catch(e) { DEBUG && 0 }
const cust = S().customers.at(-1)

const acct = code => S().journal.reduce((sum,e)=> sum + e.lines.filter(l=>l.accountCode===code).reduce((s,l)=>s+l.debit-l.credit,0), 0)
const check = (tag) => {
  const errs = []
  for (const e of S().journal) {
    const d = e.lines.reduce((s,l)=>s+l.debit,0), c = e.lines.reduce((s,l)=>s+l.credit,0)
    if (d !== c) errs.push(`قيد ${e.id} غير متوازن ${d}/${c}`)
  }
  const gd = S().journal.reduce((s,e)=>s+e.lines.reduce((x,l)=>x+l.debit,0),0)
  const gc = S().journal.reduce((s,e)=>s+e.lines.reduce((x,l)=>x+l.credit,0),0)
  if (gd !== gc) errs.push(`دفتر غير متوازن ${gd}/${gc}`)
  const book = S().items.reduce((s,it)=> s + Math.round(it.stockQty * it.costMinor), 0)
  const val = S().items.reduce((s,it)=> s + (it.stockValueMinor ?? Math.round(it.stockQty*it.costMinor)), 0)
  if (acct('1103') !== val) errs.push(`1103=${acct('1103')} != Σقيمة الأصناف=${val} (كتابي خشن ${book})`)
  if (S().items.some(it=>it.stockQty < -1e-9)) errs.push('مخزون سالب: ' + S().items.filter(it=>it.stockQty<-1e-9).map(it=>`${it.nameAr}:${it.stockQty}`).join(','))
  if (errs.length) { console.log(`\n❌ [${tag}] seed=${process.argv[2]}`); errs.slice(0,6).forEach(e=>console.log('  - '+e)); throw new Error('FAIL '+tag) }
}

const stockOf = it => it.stockQty
const buy = () => {
  const lines = []
  for (const it of [rice, cheese]) {
    const qty = it.soldByWeight ? int(2,6) : int(2,10)
    if (rnd() < 0.5) lines.push({ itemId: it.id, qty, unitPriceMinor: Math.round(it.costMinor * (0.9 + rnd()*0.3)), vatPercent: 15 })
  }
  if (!lines.length) return
  const discountPercent = pick([0,0,0,5,10,12.5])
  const paid = pick([0,0])
  S().postPurchase({ supplierId: sup.id, date:'2026-11-17', lines, expenses: [], paidMinor: paid, treasury:'1101', discountPercent })
}
const sell = () => {
  const it = pick([rice, cheese])
  const avail = stockOf(S().items.find(x=>x.id===it.id))
  if (avail <= 0.001) return
  const qty = it.soldByWeight ? Math.min(Math.round((0.25 + rnd()*1.5)*1000)/1000, avail) : Math.min(int(1,3), Math.floor(avail))
  if (qty <= 0) return
  const cur = S().items.find(x=>x.id===it.id)
  const price = Math.max(1, Math.round(cur.priceMinor || 1500))
  const line = { itemId: it.id, nameAr: it.nameAr, qty, unitPriceMinor: price, unitCostMinor: cur.costMinor, discountPercent: pick([0,0,0,5,10]), soldByWeight: it.soldByWeight }
  const args = { lines:[line], customerId: pick([null, cust.id]), payment:'cash', invoiceDiscountPercent: pick([0,0,5]), taxPercent: 15, taxInclusive: true, treasury:'1101', priceFloorOverrideBy: 'مدير' }
  try { S().postSale(args) } catch(e) { /* guards ok */ }
}
const ret = () => {
  const sales = S().sales
  if (!sales.length) return
  const sale = pick(sales)
  const total = sale.lines.reduce((s,l)=>s+l.qty,0)
  if (total <= 0) return
  const qty = Math.min(sale.lines[0].qty, Math.round((0.2 + rnd()*0.5)*1000)/1000 || 1)
  if (qty <= 0) return
  try {
    S().postSaleReturn({ saleId: sale.id, lineSpecs: [{ lineIndex: 0, qty, condition: pick(['good','good','damaged']) }], refund: pick(['cash','credit']), reason:'تجربة', approvedBy:'مدير' })
  } catch(e) { }
}
const waste = () => {
  const it = pick([rice, cheese]); const cur = S().items.find(x=>x.id===it.id)
  if (cur.stockQty <= 0.05) return
  const qty = Math.min(cur.stockQty, it.soldByWeight ? 0.2 : 1)
  try { S().postWastage({ itemId: it.id, qty, reason:'تالف', date:'2026-11-17' }) } catch(e) {}
}
const count = () => {
  const counts = new Map()
  for (const it of S().items) { if (rnd() < 0.6) counts.set(it.id, Math.max(0, Math.round((it.stockQty + (rnd()<0.5?-1:1)*rnd()*2)*1000)/1000)) }
  if (!counts.size) return
  try { S().postStocktake(counts, 'جرد تجريبي') } catch(e) {}
}

check('initial')
const ops = [buy, buy, sell, sell, sell, ret, waste, count]
for (let i=0;i<120;i++) {
  const op = pick(ops)
  const before = { items: S().items.map(it=>({id:it.id, nameAr:it.nameAr, qty:it.stockQty, cost:it.costMinor, val:it.stockValueMinor})), journal: S().journal.length, sales: S().sales.length, returns: S().salesReturns?.length ?? 0 }
  try { op() } catch(e) { if (process.env.DEBUG) console.log('  ⚠️', op.name, e?.message ?? e) }
  if (process.env.DEBUG_FAIL) {
    const a1103 = acct('1103'), val = S().items.reduce((s,it)=> s + (it.stockValueMinor ?? Math.round(it.stockQty*it.costMinor)), 0)
    if (a1103 !== val) {
      console.log('BEFORE', JSON.stringify(before))
      console.log('AFTER', JSON.stringify(S().items.map(it=>({id:it.id, nameAr:it.nameAr, qty:it.stockQty, cost:it.costMinor, val:it.stockValueMinor}))))
      console.log('journal added', S().journal.slice(before.journal).map(e=>({id:e.id, src:e.sourceType, lines:e.lines.filter(l=>['1103','5101','4101','4102','2102'].includes(l.accountCode)).map(l=>`${l.accountCode}:${l.debit}/${l.credit}`)})))
      console.log('last sale', JSON.stringify(S().sales.at(-1)?.lines?.map(l=>({itemId:l.itemId, qty:l.qty, cost:l.unitCostMinor, price:l.unitPriceMinor}))))
      console.log('per-item delta', JSON.stringify(before.items.map(b => {
        const a = S().items.find(i=>i.id===b.id)
        return { id: b.id, dq: Math.round((a.stockQty-b.qty)*1000)/1000, dVal: a.stockValueMinor-b.val, cost: b.cost, ratio: b.val/b.qty }
      })))
      process.exit(1)
    }
  }
  check(`${op.name}#${i}`)
}
console.log(`✅ seed ${process.argv[2]}: 120 عملية — كل الثوابت سليمة (قيود ${S().journal.length}, أصناف ${S().items.length}, مبيعات ${S().sales.length})`)
