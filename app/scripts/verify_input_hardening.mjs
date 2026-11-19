/**
 * verify_input_hardening.mjs — الطبقة ④ من منهجية الفحص: **تحصين المدخلات**
 * ──────────────────────────────────────────────────────────────────────────
 * كل ثغرة مالية في هذا المشروع كانت **مدخلاً** لا حساباً: قيمة ناقصة، نصّ في مكان
 * رقم، قيمة نكرة في مكان enum، أو مبلغ يُقبل ثم يُهمل. هذه البوابة تأخذ كل سطح مالي
 * وتُفسد حقوله حقلاً حقلاً (NaN، سالب، نص، قيمة enum مجهولة) وتُلزم النظام بأحد أمرين:
 *
 *   (أ) الرفض برسالة عربية **بلا أثر جزئي** في الحالة (المعيار الذهبي)، أو
 *   (ب) القبول مع بقاء الثوابت العشرة سليمة **والمبلغ المُدخل ظاهراً في المستند والدفتر**.
 *
 * وما عدا ذلك = **مدخل يُقبل ولا يُنفَّذ** — وهي الثغرة نفسها التي أضاعت مصروفاً كاملاً.
 *
 * التشغيل: node --experimental-strip-types scripts/verify_input_hardening.mjs
 */
import { freshCase, addSimpleItem, snapshot, assertInvariants, reporter } from './auditKit.mjs'

const r = reporter('تحصين المدخلات')
const valueSum = (st) => st().items.reduce((sum, it) => sum + (Number.isFinite(it.stockValueMinor) ? it.stockValueMinor : Math.round(it.stockQty * it.costMinor)), 0)
const accountBalance = (st, code) => st().journal.reduce((sum, entry) => sum + entry.lines.filter((line) => line.accountCode === code).reduce((x, line) => x + line.debit - line.credit, 0), 0)
const Arabic = /[\u0600-\u06FF]/

/** ضبط مسار داخل كائن: 'expenses[0].amountMinor' */
const setPath = (target, path, value) => {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)
  let cursor = target
  for (let i = 0; i < parts.length - 1; i++) cursor = cursor[parts[i]]
  cursor[parts.at(-1)] = value
}

/**
 * يُشغّل حالة واحدة: يبني الحالة النظيفة، يطبّق التحريف، ويحكم على النتيجة.
 * @returns {'reject'|'accept'}
 */
async function probe({ action, path, value, build, invoke, moneyPath }) {
  const c = await freshCase({ activityId: 'grocery', vatPercent: 15, taxInclusive: true })
  const st = c.st
  const ctx = seedScenario(c)
  const payload = build(ctx)
  setPath(payload, path, value)
  const before = snapshot(c)
  const journalBefore = st().journal.length
  let error = null
  let created = null
  try { created = invoke(st, payload, ctx) } catch (err) { error = err }
  if (error) {
    const message = String(error.message ?? error)
    if (!Arabic.test(message)) throw new Error(`${action}/${path}=${String(value)}: الرفض ليس برسالة عربية — «${message}»`)
    if (snapshot(c) !== before) throw new Error(`${action}/${path}=${String(value)}: الرفض ترك أثراً جزئياً في الحالة`)
    return 'reject'
  }
  // قُبل: يجب أن تبقى الثوابت وأن يظهر المبلغ
  assertInvariants(`${action}/${path}=${String(value)}`, c)
  if (accountBalance(st, '1103') !== valueSum(st)) throw new Error(`${action}/${path}=${String(value)}: قُبل وأخلّ بثابت 1103`)
  for (const it of st().items) {
    if (it.stockQty < -1e-9) throw new Error(`${action}/${path}=${String(value)}: قُبل وأنتج مخزوناً سالباً (${it.nameAr}=${it.stockQty})`)
    if ((it.stockValueMinor ?? 0) < 0) throw new Error(`${action}/${path}=${String(value)}: قُبل وأنتج قيمة مخزون سالبة`)
  }
  if (created == null && st().journal.length === journalBefore) {
    throw new Error(`${action}/${path}=${String(value)}: قُبل بلا مستند ولا قيد — مدخل يُقبل ولا يُنفَّذ`)
  }
  if (moneyPath && created) {
    const declared = moneyPath(created)
    if (!(declared > 0) && !(value === 0)) {
      throw new Error(`${action}/${path}=${String(value)}: المبلغ المُدخل لم يظهر في المستند (${declared})`)
    }
  }
  return 'accept'
}

const seedScenario = (c) => {
  const st = c.st
  const wh = st().warehouses[0]?.id ?? 1
  st().addSupplier({ nameAr: 'مورد التحصين', phone: '', notes: '' })
  st().addCustomer({ nameAr: 'عميل التحصين', phone: '', notes: '' })
  const supplier = st().suppliers.at(-1)
  const customer = st().customers.at(-1)
  const item = addSimpleItem(c, { nameAr: 'صنف التحصين', priceMinor: 1150 })
  const item2 = addSimpleItem(c, { nameAr: 'صنف ثانٍ', priceMinor: 2300 })
  st().postPurchase({ supplierId: supplier.id, date: '2026-11-17', lines: [{ itemId: item.id, qty: 20, unitPriceMinor: 1000, vatPercent: 15, warehouseId: wh }], expenses: [], paidMinor: 0, treasury: '1101', notes: '' })
  return { st, wh, supplier, customer, item, item2, c }
}

const basePurchase = (ctx) => ({
  supplierId: ctx.supplier.id, date: '2026-11-17',
  lines: [{ itemId: ctx.item.id, qty: 5, unitPriceMinor: 1000, vatPercent: 15, warehouseId: ctx.wh }],
  expenses: [{ nameAr: 'نقل', amountMinor: 100, method: 'qty', paidBy: 'supplier', costTreatment: 'inventory' }],
  paidMinor: 0, treasury: '1101', notes: '',
})
const baseSale = (ctx) => ({
  lines: [{ itemId: ctx.item.id, nameAr: ctx.item.nameAr, qty: 1, unitPriceMinor: 1150, unitCostMinor: ctx.st().items.find((row) => row.id === ctx.item.id).costMinor, discountPercent: 0, soldByWeight: false, warehouseId: ctx.wh }],
  customerId: null, payment: 'cash', treasury: '1101', paidMinor: 1150, invoiceDiscountPercent: 0, taxPercent: 15, taxInclusive: true,
})

const numVariants = [Number.NaN, -1, '__BAD__']
const cases = []
const addCase = (action, path, variants, build, invoke, moneyPath) => {
  for (const value of variants) cases.push({ action, path, value, build, invoke, moneyPath })
}

// ── الشراء: كل حقل مالي في السطر والمصروف والفاتورة ─────────────────────────
addCase('postPurchase', 'lines[0].qty', numVariants, basePurchase, (S, p) => S().postPurchase(p), (doc) => doc.goodsTotalMinor)
addCase('postPurchase', 'lines[0].unitPriceMinor', numVariants, basePurchase, (S, p) => S().postPurchase(p), (doc) => doc.goodsTotalMinor)
addCase('postPurchase', 'lines[0].vatPercent', numVariants, basePurchase, (S, p) => S().postPurchase(p), (doc) => doc.inputVatMinor)
addCase('postPurchase', 'expenses[0].amountMinor', numVariants, basePurchase, (S, p) => S().postPurchase(p), (doc) => doc.expensesTotalMinor)
addCase('postPurchase', 'expenses[0].costTreatment', ['__BAD__', 'value'], basePurchase, (S, p) => S().postPurchase(p), (doc) => doc.expensesTotalMinor)
addCase('postPurchase', 'expenses[0].paidBy', ['__BAD__', 'us'], basePurchase, (S, p) => S().postPurchase(p), (doc) => doc.expensesTotalMinor)
addCase('postPurchase', 'expenses[0].method', ['__BAD__', 'cash'], basePurchase, (S, p) => S().postPurchase(p), (doc) => doc.expensesTotalMinor)
addCase('postPurchase', 'paidMinor', numVariants, basePurchase, (S, p) => S().postPurchase(p))
addCase('postPurchase', 'discountPercent', numVariants, basePurchase, (S, p) => S().postPurchase(p))

// ── البيع: الكمية والسعر والخصومات والضريبة والدفع ──────────────────────────
addCase('postSale', 'lines[0].qty', numVariants, baseSale, (S, p) => S().postSale(p), (doc) => doc.totals.totalMinor)
addCase('postSale', 'lines[0].unitPriceMinor', numVariants, baseSale, (S, p) => S().postSale(p), (doc) => doc.totals.totalMinor)
addCase('postSale', 'lines[0].discountPercent', [...numVariants, 120], baseSale, (S, p) => S().postSale(p), (doc) => doc.totals.totalMinor)
addCase('postSale', 'invoiceDiscountPercent', [...numVariants, 120], baseSale, (S, p) => S().postSale(p), (doc) => doc.totals.totalMinor)
addCase('postSale', 'taxPercent', numVariants, baseSale, (S, p) => S().postSale(p), (doc) => doc.totals.totalMinor)
addCase('postSale', 'paidMinor', numVariants, baseSale, (S, p) => S().postSale(p))
addCase('postSale', 'payment', ['__BAD__'], baseSale, (S, p) => S().postSale(p))

// ── الإتلاف: الكمية والسبب ──────────────────────────────────────────────────
addCase('postWastage', 'lines[0].qty', numVariants, (ctx) => ({ reason: 'تلف', lines: [{ itemId: ctx.item.id, qty: 1 }], notes: '' }), (S, p) => S().postWastage(p), (doc) => doc.totalCostMinor)
addCase('postWastage', 'reason', ['', '__BAD__'], (ctx) => ({ reason: 'تلف', lines: [{ itemId: ctx.item.id, qty: 1 }], notes: '' }), (S, p) => S().postWastage(p))

// ── الجرد: المعدود والدفتري والتكلفة ────────────────────────────────────────
addCase('postStocktake', '[0].countedQty', numVariants, (ctx) => [{ itemId: ctx.item.id, nameAr: ctx.item.nameAr, expectedQty: ctx.st().items.find((row) => row.id === ctx.item.id).stockQty, countedQty: 3, unitCostMinor: ctx.st().items.find((row) => row.id === ctx.item.id).costMinor }], (S, p) => S().postStocktake(p, 'تحصين'))
addCase('postStocktake', '[0].unitCostMinor', numVariants, (ctx) => [{ itemId: ctx.item.id, nameAr: ctx.item.nameAr, expectedQty: ctx.st().items.find((row) => row.id === ctx.item.id).stockQty, countedQty: 3, unitCostMinor: ctx.st().items.find((row) => row.id === ctx.item.id).costMinor }], (S, p) => S().postStocktake(p, 'تحصين'))

// ── التحويل: الكمية والمخزنان ───────────────────────────────────────────────
addCase('postTransfer', 'lines[0].qty', numVariants, (ctx) => ({ fromWarehouseId: ctx.wh, toWarehouseId: ctx.wh, lines: [{ itemId: ctx.item.id, qty: 1 }], notes: '' }), (S, p) => S().postTransfer(p))

// ── سند: المبلغ والنوع ──────────────────────────────────────────────────────
addCase('postVoucher', 'amountMinor', numVariants, (ctx) => ({ kind: 'receipt', partyKind: 'customer', partyId: ctx.customer.id, treasury: '1101', counterAccountCode: '1104', amountMinor: 500, description: 'تحصين', date: '2026-11-17' }), (S, p) => S().postVoucher(p), (doc) => doc.amountMinor)
addCase('postVoucher', 'kind', ['__BAD__'], (ctx) => ({ kind: 'receipt', partyKind: 'customer', partyId: ctx.customer.id, treasury: '1101', counterAccountCode: '1104', amountMinor: 500, description: 'تحصين', date: '2026-11-17' }), (S, p) => S().postVoucher(p))

// ── التنفيذ ─────────────────────────────────────────────────────────────────
const summary = new Map()
let rejected = 0
let accepted = 0
const acceptedList = []
for (const item of cases) {
  const verdict = await probe(item)
  const key = `${item.action} · ${item.path}`
  summary.set(key, (summary.get(key) ?? '') + (verdict === 'reject' ? 'ر' : 'ق'))
  if (verdict === 'reject') rejected++
  else { accepted++; acceptedList.push(`${key} = ${String(item.value)}`) }
  process.stdout.write(verdict === 'reject' ? '.' : '!')
}
console.log(`\n\nاختبارات المدخلات: ${cases.length} حالة · رُفضت ${rejected} · قُبلت ${accepted}`)
if (acceptedList.length) {
  r.section('⚠️ مدخلات قُبلت (مسموح فقط إن بقيت الثوابت والمبلغ ظاهراً):')
  for (const line of acceptedList) console.log(`   • ${line}`)
}
r.section('📋 المصفوفة (ر = رفض ذري · ق = قبول سليم):')
for (const [key, marks] of [...summary.entries()].sort()) console.log(`   ${key.padEnd(52)} ${marks}`)
r.ok(`${cases.length} حالة إدخال فاسد: لا قبول صامت، ولا أثر جزئي عند الرفض`)
r.done()
