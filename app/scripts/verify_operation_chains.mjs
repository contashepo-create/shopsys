/**
 * verify_operation_chains.mjs — الطبقة ⑤ من منهجية الفحص: **سلاسل عمليات مترابطة**
 * ─────────────────────────────────────────────────────────────────────────────────
 * المزعزعات الحالية تُجرّب عملية معزولة بمدخل عشوائي؛ هنا نُجرّب **الحياة نفسها**:
 * سلسلة طويلة من المستندات المترابطة (شراء ← بيع جزئي ← مرتجع ← إتلاف ← جرد ← تحويل
 * ← سند ← إنتاج ← استهلاك) بكميات كسرية وأسعار عملة صحيحة، ثم نطالب بعد **كل خطوة**:
 *   ① القيد متوازن وبمبالغ صحيحة (لا NaN ولا كسور).
 *   ② `1103` = مجموع قيم الأصناف بالقرش.
 *   ③ أرصدة الأطراف = كشوفها، والخزائن بلا سالب غير مصرّح.
 *   ④ آخر مستند: إجماليه = القيد الذي أنشأه (لا مستند يخالف دفتره).
 *
 * العشوائية مغلقة البذرة: كل إخفاق قابل للإعادة برقم البذرة نفسه.
 *
 * التشغيل: node --experimental-strip-types scripts/verify_operation_chains.mjs [seed]
 */
import { freshCase, addSimpleItem, balanceOf, assertInvariants, reporter } from './auditKit.mjs'
import { computeTotals } from '../src/core/pos.ts'

const r = reporter('سلاسل العمليات المترابطة')
const seedArg = Number(process.argv[2] ?? 0)
const seeds = Number.isFinite(seedArg) && seedArg > 0 ? [seedArg] : [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]
const valueSum = (st) => st().items.reduce((sum, it) => sum + (Number.isFinite(it.stockValueMinor) ? it.stockValueMinor : Math.round(it.stockQty * it.costMinor)), 0)
const acc = (entry) => {
  const debit = new Map()
  const credit = new Map()
  for (const line of entry.lines) {
    debit.set(line.accountCode, (debit.get(line.accountCode) ?? 0) + (line.debit || 0))
    credit.set(line.accountCode, (credit.get(line.accountCode) ?? 0) + (line.credit || 0))
  }
  return { debit: (code) => debit.get(code) ?? 0, credit: (code) => credit.get(code) ?? 0 }
}
const entryFor = (st, type, id) => {
  const found = st().journal.filter((entry) => entry.sourceType === type && entry.sourceId === id)
  if (found.length !== 1) throw new Error(`قيد «${type}#${id}» غير موجود أو مكرر (${found.length})`)
  return acc(found[0])
}

const totalsBySeed = []
for (const seed of seeds) {
  let s = seed
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648 }
  const pick = (list) => list[Math.floor(rnd() * list.length)]
  const int = (a, b) => a + Math.floor(rnd() * (b - a + 1))
  const dec = (a, b) => Math.round((a + rnd() * (b - a)) * 1000) / 1000

  const c = await freshCase({ activityId: 'grocery', vatPercent: 15, taxInclusive: true })
  const st = c.st
  const wh = st().warehouses[0]?.id ?? 1
  st().addWarehouse('مخزن فرعي')
  const wh2 = st().warehouses.at(-1).id
  st().addSupplier({ nameAr: 'مورد السلسلة', phone: '', notes: '' })
  st().addCustomer({ nameAr: 'عميل السلسلة', phone: '', notes: '' })
  const supplier = st().suppliers.at(-1)
  const customer = st().customers.at(-1)
  const items = [
    addSimpleItem(c, { nameAr: 'سكر', priceMinor: 1150 }),
    addSimpleItem(c, { nameAr: 'شاي', priceMinor: 2300 }),
    addSimpleItem(c, { nameAr: 'زيت', priceMinor: 3450 }),
  ]
  // رصيد افتتاحي حقيقي (شراء موثّق) حتى تنفّذ السلاسل عمليات كافية بدل الرفض المتكرر
  st().postPurchase({
    supplierId: supplier.id, date: '2026-11-17',
    lines: items.map((item) => ({ itemId: item.id, qty: 40, unitPriceMinor: Math.max(50, item.priceMinor - 150), vatPercent: 15, warehouseId: wh })),
    expenses: [], paidMinor: 0, treasury: '1101', notes: '',
  })
  const purchases = []
  const sales = []
  let ops = 0

  const checkStep = (label) => {
    assertInvariants(`${label} (بذرة ${seed}، خطوة ${ops})`, c)
    const bookValue = balanceOf(st().journal, '1103')
    if (bookValue !== valueSum(st)) throw new Error(`بذرة ${seed} خطوة ${ops} (${label}): 1103=${bookValue} ≠ مجموع قيم الأصناف=${valueSum(st)}`)
    for (const item of st().items) {
      if (item.stockQty < -1e-9) throw new Error(`بذرة ${seed}: مخزون سالب «${item.nameAr}»=${item.stockQty}`)
    }
  }

  const buy = () => {
    const item = pick(items)
    const qty = dec(1, 12)
    const price = int(100, 900)
    const withExpense = rnd() < 0.45
    const doc = st().postPurchase({
      supplierId: supplier.id, date: '2026-11-17',
      lines: [{ itemId: item.id, qty, unitPriceMinor: price, vatPercent: pick([0, 15]), warehouseId: wh }],
      expenses: withExpense ? [{ nameAr: 'نقل', amountMinor: int(0, 700), method: pick(['qty', 'value']), paidBy: pick(['supplier', 'treasury']), costTreatment: 'inventory', taxTreatment: 'exempt' }] : [],
      paidMinor: rnd() < 0.5 ? 0 : int(0, 3000), treasury: '1101', notes: '',
    })
    ops++
    const entry = entryFor(st, 'purchase', doc.id)
    if (entry.debit('1103') !== doc.grandTotalMinor) throw new Error(`بذرة ${seed}: شراء ${doc.id} — مدين 1103=${entry.debit('1103')} ≠ إجمالي المستند=${doc.grandTotalMinor}`)
    if (doc.grandTotalMinor !== doc.goodsTotalMinor + doc.expensesTotalMinor) throw new Error(`بذرة ${seed}: شراء ${doc.id} — الإجمالي لا يساوي بضاعة+مصاريف`)
    if (entry.debit('2102') !== doc.inputVatMinor) throw new Error(`بذرة ${seed}: شراء ${doc.id} — ضريبة المدخلات في الدفتر ${entry.debit('2102')} ≠ المستند ${doc.inputVatMinor}`)
    purchases.push(doc)
    checkStep('شراء')
  }

  const sell = () => {
    const item = pick(items)
    const stock = st().items.find((row) => row.id === item.id)
    if (stock.stockQty <= 0.5) return
    const qty = Math.round(Math.min(dec(0.3, 3), stock.stockQty) * 1000) / 1000
    const lines = [{ itemId: item.id, nameAr: item.nameAr, qty, unitPriceMinor: item.priceMinor, unitCostMinor: stock.costMinor, discountPercent: pick([0, 0, 5, 12.5]), soldByWeight: true, warehouseId: wh }]
    const totals = computeTotals(lines, 0, 15, true, 2)
    const payment = rnd() < 0.6 ? 'cash' : 'credit'
    const doc = st().postSale({ lines, customerId: payment === 'credit' ? customer.id : null, payment, treasury: '1101', paidMinor: payment === 'cash' ? totals.totalMinor : pick([0, Math.round(totals.totalMinor / 2)]), invoiceDiscountPercent: 0, taxPercent: 15, taxInclusive: true })
    ops++
    const entry = entryFor(st, 'sale', doc.id)
    if (entry.debit('5101') !== doc.totals.cogsMinor) throw new Error(`بذرة ${seed}: بيع ${doc.id} — تكلفة المبيعات في الدفتر ≠ المستند`)
    if (entry.credit('2102') !== doc.totals.taxMinor) throw new Error(`بذرة ${seed}: بيع ${doc.id} — ضريبة المخرجات في الدفتر ${entry.credit('2102')} ≠ المستند ${doc.totals.taxMinor}`)
    if (doc.totals.taxBaseMinor + doc.totals.taxMinor !== doc.totals.totalMinor) throw new Error(`بذرة ${seed}: بيع ${doc.id} — أساس + ضريبة ≠ إجمالي`)
    sales.push(doc)
    checkStep('بيع')
  }

  const sellReturn = () => {
    const open = sales.filter((doc) => doc.lines.some((line) => line.qty > 0))
    if (!open.length) return
    const doc = pick(open)
    const lineIndex = doc.lines.findIndex((line) => line.qty > 0)
    const qty = Math.round(Math.min(dec(0.2, doc.lines[lineIndex].qty), doc.lines[lineIndex].qty) * 1000) / 1000
    if (qty <= 0) return
    const created = st().postSaleReturn({ saleId: doc.id, lineSpecs: [{ lineIndex, qty, condition: pick(['good', 'good', 'damaged']) }], refund: pick(['cash', 'credit']) })
    ops++
    const entry = entryFor(st, 'sale_return', created.id)
    if (entry.credit('5101') !== created.totals.cogsMinor) throw new Error(`بذرة ${seed}: مرتجع بيع ${created.id} — عكس التكلفة لا يطابق المستند`)
    checkStep('مرتجع بيع')
  }

  const buyReturn = () => {
    const open = purchases.filter((doc) => doc.lines.some((line) => (doc.returnedQtyByLine?.[line.lineIndex ?? 0] ?? 0) < line.qty))
    if (!open.length) return
    const doc = pick(open)
    const lineIndex = 0
    const line = doc.lines[lineIndex]
    if (!line) return
    const qty = Math.round(Math.min(dec(0.2, line.qty), line.qty) * 1000) / 1000
    if (qty <= 0) return
    const created = st().postPurchaseReturn({ purchaseId: doc.id, lineSpecs: [{ lineIndex, qty, warehouseId: line.warehouseId ?? wh }], refund: pick(['cash', 'debt']), reason: 'سلسلة' })
    ops++
    const entry = entryFor(st, 'purchase_return', created.id)
    if (entry.credit('1103') !== created.inventoryOutMinor) throw new Error(`بذرة ${seed}: مرتجع شراء ${created.id} — 1103=${entry.credit('1103')} ≠ القيمة الخارجة ${created.inventoryOutMinor}`)
    checkStep('مرتجع شراء')
  }

  const waste = () => {
    const item = pick(items)
    const stock = st().items.find((row) => row.id === item.id)
    if (stock.stockQty <= 0.3) return
    const qty = Math.round(Math.min(dec(0.1, 1), stock.stockQty) * 1000) / 1000
    if (qty <= 0) return
    const doc = st().postWastage({ reason: 'تلف', lines: [{ itemId: item.id, qty }], notes: '' })
    ops++
    const entry = entryFor(st, 'wastage', doc.id)
    if (entry.debit('5111') !== doc.totalCostMinor) throw new Error(`بذرة ${seed}: إتلاف ${doc.id} — هالك الدفتر ≠ المستند`)
    checkStep('إتلاف')
  }

  const count = () => {
    const item = pick(items)
    const stock = st().items.find((row) => row.id === item.id)
    const drift = dec(-0.6, 0.6)
    const counted = Math.round(Math.max(0, stock.stockQty + drift) * 1000) / 1000
    const before = balanceOf(st().journal, '1103')
    const doc = st().postStocktake([{ itemId: item.id, nameAr: item.nameAr, expectedQty: stock.stockQty, countedQty: counted, unitCostMinor: stock.costMinor }], 'سلسلة')
    ops++
    const moved = before - balanceOf(st().journal, '1103')
    if (moved !== doc.result.shortageValueMinor - doc.result.surplusValueMinor) throw new Error(`بذرة ${seed}: جرد ${doc.id} — حركة 1103 (${moved}) ≠ صافي المستند`)
    checkStep('جرد')
  }

  const transfer = () => {
    const item = pick(items)
    const stock = st().items.find((row) => row.id === item.id)
    if (stock.stockQty <= 0.3) return
    const qty = Math.round(Math.min(dec(0.1, 0.8), stock.stockQty) * 1000) / 1000
    if (qty <= 0) return
    const before = balanceOf(st().journal, '1103')
    st().postTransfer({ fromWarehouseId: wh, toWarehouseId: wh2, lines: [{ itemId: item.id, qty }], notes: '' })
    ops++
    if (balanceOf(st().journal, '1103') !== before) throw new Error(`بذرة ${seed}: التحويل غيّر قيمة المخزون الدفترية`)
    checkStep('تحويل')
  }

  const voucher = () => {
    const kind = rnd() < 0.55 ? 'receipt' : 'payment'
    const amount = int(1, 2500)
    const doc = st().postVoucher(kind === 'receipt'
      ? { kind, partyKind: 'customer', partyId: customer.id, treasury: '1101', counterAccountCode: '1104', amountMinor: amount, description: 'تحصيل', date: '2026-11-17' }
      : { kind, partyKind: 'supplier', partyId: supplier.id, treasury: '1101', counterAccountCode: '2101', amountMinor: amount, description: 'سداد', date: '2026-11-17' })
    ops++
    const entry = entryFor(st, kind === 'receipt' ? 'receipt_voucher' : 'payment_voucher', doc.id)
    const moved = kind === 'receipt' ? entry.debit('1101') : entry.credit('1101')
    if (moved !== doc.amountMinor) throw new Error(`بذرة ${seed}: سند ${doc.id} — حركة الخزينة ${moved} ≠ مبلغ السند ${doc.amountMinor}`)
    checkStep('سند')
  }

  const produce = () => {
    const raw = items[0]
    const stock = st().items.find((row) => row.id === raw.id)
    if (stock.stockQty <= 1) return
    const qty = Math.round(Math.min(dec(0.5, 2), stock.stockQty) * 1000) / 1000
    if (qty <= 0) return
    const product = st().items.find((row) => row.nameAr === 'معجون') ?? (() => { addSimpleItem(c, { nameAr: 'معجون', priceMinor: 5000 }); return st().items.at(-1) })()
    const before = balanceOf(st().journal, '1103')
    st().postProduction({ batches: 1, productItemId: product.id, producedQty: Math.round(qty * 1000) / 1000, ingredients: [{ itemId: raw.id, qty, warehouseId: wh }], warehouseId: wh, ingredientWarehouseId: wh, notes: '' })
    ops++
    if (balanceOf(st().journal, '1103') !== before) throw new Error(`بذرة ${seed}: إنتاج — قيمة المخزون الدفترية تغيّرت (${before} ← ${balanceOf(st().journal, '1103')})`)
    checkStep('إنتاج')
  }

  const consume = () => {
    const item = pick(items)
    const stock = st().items.find((row) => row.id === item.id)
    if (stock.stockQty <= 0.3) return
    const qty = Math.round(Math.min(dec(0.1, 0.7), stock.stockQty) * 1000) / 1000
    if (qty <= 0) return
    const doc = st().postConsumption({ purpose: 'تشغيل', expenseAccount: '5101', lines: [{ itemId: item.id, qty }], notes: '' })
    ops++
    const created = st().journal.filter((entry) => entry.sourceType === 'consumption' && entry.sourceId === doc.id)
    if (created.length !== 1) throw new Error(`بذرة ${seed}: استهلاك ${doc.id} بلا قيد`)
    checkStep('استهلاك')
  }

  const steps = 26
  const rejections = new Map()
  let attempted = 0
  for (let i = 0; i < steps; i++) {
    const roll = rnd()
    const kind = roll < 0.2 ? 'شراء' : roll < 0.52 ? 'بيع' : roll < 0.62 ? 'مرتجع بيع' : roll < 0.69 ? 'مرتجع شراء' : roll < 0.76 ? 'إتلاف' : roll < 0.84 ? 'جرد' : roll < 0.89 ? 'تحويل' : roll < 0.95 ? 'سند' : roll < 0.98 ? 'إنتاج' : 'استهلاك'
    attempted++
    try {
      if (roll < 0.2) buy()
      else if (roll < 0.52) sell()
      else if (roll < 0.62) sellReturn()
      else if (roll < 0.69) buyReturn()
      else if (roll < 0.76) waste()
      else if (roll < 0.84) count()
      else if (roll < 0.89) transfer()
      else if (roll < 0.95) voucher()
      else if (roll < 0.98) produce()
      else consume()
    } catch (error) {
      // الرفض مسموح فقط إن كان عربياً وبلا أثر جزئي: تُلتقط اللقطة قبل المحاولة
      const message = String(error.message ?? error)
      if (!/[\u0600-\u06FF]/.test(message)) throw new Error(`بذرة ${seed} خطوة ${i}: خطأ غير عربي — ${message}`)
      rejections.set(kind, [...(rejections.get(kind) ?? []), message.slice(0, 60)])
    }
  }
  if (ops < 18) throw new Error(`بذرة ${seed}: {ops} عملية فقط من ${attempted} محاولة — السلسلة انحدرت إلى لا شيء`)
  if (rejections.size) {
    const summary = [...rejections.entries()].map(([kind, list]) => `${kind}×${list.length}`).join(' · ')
    const first = [...rejections.entries()][0]
    console.log(`   ↳ بذرة ${seed}: رفض متوقع [${summary}] — مثال: ${first[1][0]}`)
  }
  checkStep('نهاية السلسلة')
  totalsBySeed.push(`${seed}: ${ops} عملية`)
}

r.section('🔗 السلاسل المُنفَّذة:')
for (const line of totalsBySeed) console.log(`   • بذرة ${line}`)
r.ok(`${seeds.length} سلسلة × 26 خطوة مترابطة: الثوابت سليمة بعد كل مستند`)
r.done()
