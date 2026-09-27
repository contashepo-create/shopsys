/**
 * 🔀 الفحص الختامي 3/3 — دورة حياة متشابكة بمولد حتمي:
 * منهجية مختلفة عن كل ما سبق: بدل سيناريو خطي، 60+ عملية متشابكة
 * (بيع/شراء/مرتجع/سند/شيك/عهدة/سلفة/تحويل) بترتيب يحدده مولد
 * شبه عشوائي حتمي (بذرة ثابتة = قابل للتكرار)، وبعد **كل** عملية
 * تُفحص 6 ثوابت دفترية فوراً:
 *   I1 كل قيد متوازن  I2 لا سوالب/كسور  I3 ميزان كلي صفري
 *   I4 مخزون كل صنف = صافي حركته الفعلية (شراء−بيع+مرتجع)
 *   I5 1103 دفترياً ≈ Σ(كمية×متوسط) (سماحية تقريب لكل صنف)
 *   I6 ذمم العملاء الدفترية = Σأرصدة كشوفهم الموحدة
 *
 * تشغيل: node --experimental-strip-types scripts/verify_final_interleaved_lifecycle.mjs
 */
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => mem.set(k, v),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
  key: (i) => [...mem.keys()][i] ?? null,
  get length() { return mem.size },
}
globalThis.window = { localStorage: globalThis.localStorage, addEventListener: () => {}, dispatchEvent: () => true }
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false, done: true, countryCode: 'EG', activityId: 'grocery', vatPercent: 14, taxInclusive: true, allowNegativeTreasury: true }, license: { plan: 'pro' } }, version: 0 }))

const { useDataStore } = await import(join(root, 'src/data/repo.ts'))
const st = () => useDataStore.getState()
const EXT = { taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' }

// مولد حتمي (mulberry32) — بذرة ثابتة: التشغيل قابل للتكرار حرفياً
let seed = 20260920
const rnd = () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const pick = (arr) => arr[Math.floor(rnd() * arr.length)]
const ri = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1))

// ───── تجهيز ─────
st().postVoucher({ kind: 'receipt', treasury: '1101', counterAccountCode: '3101', amountMinor: 5000000, description: 'رأس مال' })
for (const n of ['سكر', 'شاي', 'صابون']) {
  st().addItem({ nameAr: n, categoryId: null, unit: 'قطعة', priceMinor: 0, barcode: n, sku: '', isActive: true, trackExpiry: false, trackSerial: false, soldByWeight: false, isService: false, minSalePriceMinor: 0, costMinor: 0, stockQty: 0 })
}
st().addSupplier({ nameAr: 'مورد الجملة', phone: '', notes: '', ...EXT })
st().addCustomer({ nameAr: 'عميل أ', phone: '', creditLimitMinor: 100000000, notes: '', ...EXT })
st().addCustomer({ nameAr: 'عميل ب', phone: '', creditLimitMinor: 100000000, notes: '', ...EXT })
st().addEmployee({ nameAr: 'موظف التشغيل', phone: '', jobTitle: 'عامل', hireDate: '2025-06-01', baseSalaryMinor: 250000, allowancesMinor: 0, active: true, notes: '', ...EXT })
const items = st().items
const supplier = st().suppliers[0]
const customers = st().customers
const emp = st().employees[0]
st().addTreasury('بنك التشغيل', 'bank')
const bank = st().treasuries.find((t) => t.kind === 'bank')

// تتبع مستقل خارج النظام (دفتر ظل) للمخزون
const shadowQty = new Map(items.map((i) => [i.id, 0]))

// ───── الثوابت الستة ─────
const PRICE = { [items[0].id]: 4000, [items[1].id]: 6000, [items[2].id]: 2500 }
let checksRun = 0
const invariants = (opLabel) => {
  checksRun++
  const bal = {}
  for (const e of st().journal) {
    let d = 0, c = 0
    for (const l of e.lines) {
      assert.ok(Number.isInteger(l.debit) && Number.isInteger(l.credit) && l.debit >= 0 && l.credit >= 0, `I2 كسور/سوالب بعد: ${opLabel}`)
      d += l.debit; c += l.credit
      bal[l.accountCode] = (bal[l.accountCode] ?? 0) + l.debit - l.credit
    }
    assert.equal(d, c, `I1 قيد مختل بعد: ${opLabel}`)
  }
  const total = Object.values(bal).reduce((s, v) => s + v, 0)
  assert.equal(total, 0, `I3 الميزان الكلي ${total} بعد: ${opLabel}`)
  // I4: مخزون النظام = دفتر الظل
  for (const it of st().items) {
    assert.equal(it.stockQty, shadowQty.get(it.id), `I4 مخزون «${it.nameAr}» ${it.stockQty} ≠ الظل ${shadowQty.get(it.id)} بعد: ${opLabel}`)
  }
  // I5: 1103 ≈ Σ(كمية×متوسط) — سماحية قرش لكل صنف لكل حركة
  const inv = st().items.reduce((s, it) => s + Math.round((it.stockQty ?? 0) * it.costMinor), 0)
  assert.ok(Math.abs((bal['1103'] ?? 0) - inv) <= 300, `I5 1103=${bal['1103']} ≠ أصناف ${inv} بعد: ${opLabel}`)
  // I6: 1104 الدفتري = Σكشوف العملاء
  const stmt = customers.reduce((s, c) => s + st().getCustomerBalance(c.id), 0)
  assert.equal(bal['1104'] ?? 0, stmt, `I6 ذمم ${bal['1104']} ≠ كشوف ${stmt} بعد: ${opLabel}`)
}

// ───── 60 عملية متشابكة ─────
console.log('\n🔀 60 عملية متشابكة بمولد حتمي (بذرة 20260920) + 6 ثوابت بعد كل عملية\n')
const counts = {}
let opsDone = 0
const cheques = []
let custodyFile = null

const OPS = {
  purchase() {
    const it = pick(items); const qty = ri(5, 30); const price = ri(1500, 5000)
    st().postPurchase({ supplierId: supplier.id, date: '2026-09-15', treasury: '1101', notes: '', paidMinor: 0, expenses: [], lines: [{ itemId: it.id, qty, unitPriceMinor: price }] })
    shadowQty.set(it.id, shadowQty.get(it.id) + qty)
    return `شراء ${qty}×${it.nameAr}`
  },
  sale() {
    const it = pick(items); const have = shadowQty.get(it.id)
    if (have < 2) return null
    const qty = ri(1, Math.min(5, have))
    const cust = rnd() < 0.5 ? pick(customers) : null
    const payment = cust && rnd() < 0.5 ? 'credit' : 'cash'
    st().postSale({ lines: [{ itemId: it.id, nameAr: it.nameAr, qty, unitPriceMinor: PRICE[it.id], unitCostMinor: st().items.find((x) => x.id === it.id).costMinor, discountPercent: 0, soldByWeight: false }], payment, treasury: '1101', customerId: cust?.id ?? null, invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: true, allowNegativeStock: false, priceFloorOverrideBy: 'اختبار دورة الحياة' })
    shadowQty.set(it.id, have - qty)
    return `بيع ${qty}×${it.nameAr} (${payment})`
  },
  saleReturn() {
    const sale = [...st().sales].reverse().find((s) => (s.returnedMinor ?? 0) === 0 && s.lines.some((l) => l.qty >= 1))
    if (!sale) return null
    const li = sale.lines.findIndex((l) => l.qty >= 1)
    st().postSaleReturn({ saleId: sale.id, lineSpecs: [{ lineIndex: li, qty: 1, condition: 'good' }], refund: sale.payment === 'credit' ? 'credit' : 'cash', reason: 'مرتجع دوري', treasury: '1101' })
    const itemId = sale.lines[li].itemId
    shadowQty.set(itemId, shadowQty.get(itemId) + 1)
    return `مرتجع 1 من فاتورة ${sale.id}`
  },
  voucher() {
    const kind = pick(['receipt', 'payment'])
    const amount = ri(1, 40) * 100
    if (kind === 'receipt') st().postVoucher({ kind, treasury: '1101', counterAccountCode: '4110', amountMinor: amount, description: 'إيراد نثري' })
    else st().postVoucher({ kind, treasury: '1101', counterAccountCode: '5103', amountMinor: amount, description: 'مصروف نثري' })
    return `سند ${kind} ${amount}`
  },
  transfer() {
    const amount = ri(5, 50) * 1000
    st().postVoucher({ kind: 'transfer', treasury: '1101', counterAccountCode: bank.code, amountMinor: amount, description: 'ترحيل للبنك' })
    return `تحويل ${amount} للبنك`
  },
  cheque() {
    const cust = pick(customers)
    const ch = st().receiveCheque({ chequeNumber: `CH${opsDone}`, partyId: cust.id, bankName: 'CIB', amountMinor: ri(10, 80) * 100, dueDate: '2026-11-01', notes: '' })
    cheques.push(ch.id)
    return `شيك وارد ${ch.chequeNumber}`
  },
  chequeSettle() {
    if (!cheques.length) return null
    const id = cheques.shift()
    if (rnd() < 0.7) { st().setChequeStatus(id, 'deposited'); st().setChequeStatus(id, 'collected', bank.code); return `تحصيل شيك ${id}` }
    st().setChequeStatus(id, 'bounced')
    return `ارتداد شيك ${id}`
  },
  custody() {
    if (!custodyFile) {
      custodyFile = st().openCustodyFile({ employeeId: emp.id, projectId: null, reason: 'تشغيل', notes: '' })
      st().fundCustodyFile({ fileId: custodyFile.id, amountMinor: 50000, treasury: '1101', description: 'تعزيز' })
      return 'فتح عهدة وتمويلها'
    }
    const remaining = st().getCustodySummary(custodyFile.id).remainingMinor
    if (remaining < 1000) {
      st().settleCustodyFile({ fileId: custodyFile.id, returnedMinor: remaining, treasury: '1101' })
      custodyFile = null
      return 'تسوية العهدة'
    }
    st().postCustodyExpense({ fileId: custodyFile.id, amountMinor: ri(5, Math.floor(remaining / 100)) * 100, description: 'مصروف تشغيل' })
    return 'مصروف من العهدة'
  },
}
const WEIGHTED = ['purchase', 'purchase', 'sale', 'sale', 'sale', 'saleReturn', 'voucher', 'transfer', 'cheque', 'chequeSettle', 'custody']

while (opsDone < 60) {
  const opName = pick(WEIGHTED)
  const label = OPS[opName]()
  if (label === null) continue
  opsDone++
  counts[opName] = (counts[opName] ?? 0) + 1
  invariants(`#${opsDone} ${label}`)
}

console.log('  ✓ توزيع العمليات:', Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(' '))
console.log(`  ✓ ${opsDone} عملية متشابكة، ${checksRun} جولة ثوابت (${checksRun * 6} فحصاً)، ${st().journal.length} قيداً`)

// ───── خاتمة: تقارير متسقة فوق الحالة المتشابكة ─────
const { trialBalance, incomeStatement, balanceSheet } = await import(join(root, 'src/core/financialReports.ts'))
const P = { from: '2020-01-01', to: '2030-12-31' }
const tb = trialBalance(st().journal, P)
assert.equal(tb.totalDebitMinor, tb.totalCreditMinor, 'ميزان ختامي')
const inc = incomeStatement(st().journal, P)
const bs = balanceSheet(st().journal, '2030-12-31')
assert.equal(bs.totalAssetsMinor, bs.totalLiabilitiesEquityMinor, 'معادلة المحاسبة على حالة متشابكة')
assert.equal(bs.retainedEarningsMinor, inc.netProfitMinor, 'أرباح الميزانية = صافي قائمة الدخل')
console.log(`  ✓ التقارير فوق الفوضى المنظمة: ميزان ${tb.totalDebitMinor} متزن، أصول=خصوم+حقوق، صافي ${inc.netProfitMinor}`)

console.log('\n✅ الفحص الختامي 3/3 (الدورة المتشابكة): كله أخضر\n')
