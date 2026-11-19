/**
 * verify_document_contracts.mjs — الطبقة ② من منهجية الفحص: **عقد المستند الذاتي**
 * ─────────────────────────────────────────────────────────────────────────────────
 * لكل مستند مالي عقد داخلي: كل إجمالي يجب أن يساوي مجموع أجزائه المعلنة، وكل بند
 * يُدخله المستخدم يجب أن يظهر داخل الإجمالي. هذا ما كان ينكسر بصمت في D9: بند مصروف
 * بمبلغ 1 قرش معلن في المستند وإجمالي المصاريف صفر — فمرّ القيد متوازناً وكذب المستند.
 *
 * لا نفحص هنا الدفتر إطلاقاً (ذلك الطبقة ③)؛ نفحص **الحساب الداخلي للمستند**، لأن
 * المستند هو ما يُطبع ويُسلَّم للطرف ويُبنى عليه الإقرار.
 *
 * التشغيل: node --experimental-strip-types scripts/verify_document_contracts.mjs
 */
import { freshCase, addSimpleItem, reporter } from './auditKit.mjs'
import { computeTotals } from '../src/core/pos.ts'

const r = reporter('عقود المستندات')
const eq = (label, actual, expected) => {
  if (actual !== expected) throw new Error(`${label}: المستند يقول ${actual} والعقد يقول ${expected} (فرق ${actual - expected})`)
  r.ok(`${label} = ${expected}`)
}
const sum = (rows, pick) => rows.reduce((total, row) => total + (pick(row) ?? 0), 0)
const round3 = (value) => Math.round(value * 1000) / 1000

const c = await freshCase({ activityId: 'grocery', vatPercent: 15, taxInclusive: true })
const st = c.st
const wh = st().warehouses[0]?.id ?? 1
st().addWarehouse('مخزن العقد')
const wh2 = st().warehouses.at(-1).id
st().addSupplier({ nameAr: 'مورد العقد', phone: '', notes: '' })
st().addCustomer({ nameAr: 'عميل العقد', phone: '', notes: '' })
const supplier = st().suppliers.at(-1)
const customer = st().customers.at(-1)
const a = addSimpleItem(c, { nameAr: 'صنف العقد أ', priceMinor: 1150 })
const b = addSimpleItem(c, { nameAr: 'صنف العقد ب', priceMinor: 2300 })

r.section('🧾 شراء: الإجمالي = بضاعة + مصاريف، وكل بند مصروف داخل الإجمالي')
const purchase = st().postPurchase({
  supplierId: supplier.id, date: '2026-11-17',
  lines: [
    { itemId: a.id, qty: 9, unitPriceMinor: 777, vatPercent: 15, warehouseId: wh },
    { itemId: b.id, qty: 3.333, unitPriceMinor: 1234, vatPercent: 15, warehouseId: wh },
  ],
  expenses: [
    { nameAr: 'نقل', amountMinor: 1, method: 'qty', paidBy: 'supplier', costTreatment: 'inventory', taxTreatment: 'exempt' },
    { nameAr: 'تأمين', amountMinor: 555, method: 'value', paidBy: 'treasury', payAccount: '1101', costTreatment: 'inventory', taxTreatment: 'exempt' },
    { nameAr: 'تفريغ', amountMinor: 90, method: 'qty', paidBy: 'payable', beneficiaryName: 'جهة تفريغ', payableAccountCode: '2117', costTreatment: 'inventory', taxTreatment: 'exempt' },
  ],
  paidMinor: 1500, treasury: '1101', notes: '',
})
eq('مجموع البضاعة = مجموع (كمية × سعر) لكل سطر', purchase.goodsTotalMinor, sum(purchase.lines, (line) => Math.round(line.qty * line.unitPriceMinor)))
eq('إجمالي المصاريف = مجموع البنود المعلنة (بند واحد قرش لا يضيع)', purchase.expensesTotalMinor, sum(purchase.expenses, (expense) => expense.amountMinor))
eq('الإجمالي = البضاعة + المصاريف المحمَّلة', purchase.grandTotalMinor, purchase.goodsTotalMinor + purchase.expensesTotalMinor)
eq('ضريبة المدخلات = مجموع ضريبة السطور', purchase.inputVatMinor, sum(purchase.lines, (line) => Math.round((line.qty * line.unitPriceMinor * (line.vatPercent ?? 0)) / 100)))
eq('المستحق للمورد = البضاعة + ضريبتها + المصاريف المحمَّلة على حسابه',
  purchase.supplierDueMinor,
  purchase.goodsTotalMinor + purchase.inputVatMinor + sum(purchase.expenses.filter((expense) => expense.paidBy === 'supplier'), (expense) => expense.amountMinor))
eq('حصة المصاريف في السطر = نصيبه من إجمالي المصاريف', sum(purchase.lines, (line) => line.expenseShareMinor), purchase.expensesTotalMinor)
/* تكلفة الوحدة المحمَّلة عدد صحيح بالقرش، فمجموع (كمية × تكلفة) قد يختلف عن إجمالي
   الفاتورة بفارق تقريب محدود بعدد السطور؛ القيمة الدفترية تبقى الإجمالي بالقرش
   (تتحقق منها الطبقة ③). أي فارق يتجاوز عدد السطور = خطأ توزيع لا تقريب. */
const landedDrift = Math.abs(sum(purchase.lines, (line) => Math.round(line.qty * line.landedUnitCostMinor)) - purchase.grandTotalMinor)
if (landedDrift > purchase.lines.length) throw new Error(`توزيع التكلفة المحمَّلة منحرف ${landedDrift} قرشاً على ${purchase.lines.length} سطراً — أكثر من تقريب الوحدة`)
r.ok(`توزيع التكلفة المحمَّلة مطابق للإجمالي داخل تقريب الوحدة (انحراف ${landedDrift} قرش)`)
r.ok('كل بنود المصروف ظاهرة داخل إجماليها (لا بند يُقبل ويُهمل)')

r.section('🧾 بيع: الإجمالي = ناتج حساب السطور نفسه، والتكلفة = مجموع تكاليفها')
const saleLines = [
  { itemId: a.id, nameAr: a.nameAr, qty: 2.5, unitPriceMinor: 1150, unitCostMinor: st().items.find((row) => row.id === a.id).costMinor, discountPercent: 7.5, soldByWeight: true, warehouseId: wh },
  { itemId: b.id, nameAr: b.nameAr, qty: 1.25, unitPriceMinor: 2300, unitCostMinor: st().items.find((row) => row.id === b.id).costMinor, discountPercent: 0, soldByWeight: true, warehouseId: wh },
]
const expectedSale = computeTotals(saleLines, 3, 15, true, 2)
const sale = st().postSale({ lines: saleLines, customerId: customer.id, payment: 'credit', treasury: '1101', paidMinor: 0, invoiceDiscountPercent: 3, taxPercent: 15, taxInclusive: true })
for (const key of ['grossMinor', 'discountMinor', 'netMinor', 'taxBaseMinor', 'taxMinor', 'totalMinor', 'cogsMinor']) {
  eq(`إجمالي البيع — ${key}`, sale.totals[key], expectedSale[key])
}
eq('تكلفة المبيعات = مجموع تكاليف السطور', sale.totals.cogsMinor, sum(sale.lines, (line) => line.costTotalMinor))
eq('الأساس الضريبي + الضريبة = الإجمالي', sale.totals.taxBaseMinor + sale.totals.taxMinor, sale.totals.totalMinor)
eq('الصافي + الخصم = الإجمالي قبل الخصم', sale.totals.netMinor + sale.totals.discountMinor, sale.totals.grossMinor)
r.ok('خصم الفاتورة محسوب على السطور لا على رقم مُمرَّر من الخارج')

r.section('🧾 مرتجع بيع: الإجمالي = نقد + ذمم + تنازل، والتكلفة = تكلفة السطور المرتجعة')
const saleReturn = st().postSaleReturn({ saleId: sale.id, lineSpecs: [{ lineIndex: 0, qty: 0.5, condition: 'good' }, { lineIndex: 1, qty: 0.25, condition: 'damaged' }], refund: 'credit' })
eq('إجمالي المرتجع = الأساس + الضريبة', saleReturn.totals.totalMinor, saleReturn.totals.taxBaseMinor + saleReturn.totals.taxMinor)
eq('مكوّنات الرد = الإجمالي', (saleReturn.cashRefundMinor ?? 0) + (saleReturn.creditRefundMinor ?? 0) + (saleReturn.waivedRefundMinor ?? 0), saleReturn.totals.totalMinor)
eq('تكلفة المرتجع = مجموع تكاليف السطور', saleReturn.totals.cogsMinor, sum(saleReturn.lines, (line) => line.costTotalMinor))
eq('الصافي + الخصم = الإجمالي قبل الخصم', saleReturn.totals.netMinor + saleReturn.totals.discountMinor, saleReturn.totals.grossMinor)
if (saleReturn.totals.cogsMinor <= 0) throw new Error('مرتجع بمخزون بلا تكلفة — عقد التكلفة مكسور')

r.section('🧾 مرتجع شراء: قيمة السطور = Σ (كمية × تكلفة محمَّلة) وΣ (كمية × سعر)')
const purchaseReturn = st().postPurchaseReturn({ purchaseId: purchase.id, lineSpecs: [{ lineIndex: 0, qty: 2, warehouseId: wh }], refund: 'cash', reason: 'عقد' })
eq('قيمة المستند = Σ (كمية × تكلفة محمَّلة)', purchaseReturn.totalMinor, sum(purchaseReturn.lines, (line) => Math.round(line.qty * line.landedUnitCostMinor)))
eq('قيمة البضاعة للمورد = Σ (كمية × سعر الشراء)', purchaseReturn.supplierValueMinor, sum(purchaseReturn.lines, (line) => Math.round(line.qty * line.unitPriceMinor)))
eq('الخارج من المخزون = قيمة المستند + فرق التقييم', purchaseReturn.inventoryOutMinor, purchaseReturn.totalMinor + purchaseReturn.inventoryVarianceMinor)
eq('الكمية المرتجعة = مجموع كميات السطور', round3(sum(purchaseReturn.lines, (line) => line.qty)), 2)

r.section('📦 إتلاف واستهلاك: التكلفة المعلنة = مجموع تكاليف السطور')
const wastage = st().postWastage({ reason: 'تلف', lines: [{ itemId: a.id, qty: 0.4 }, { itemId: b.id, qty: 0.15 }], notes: '' })
eq('تكلفة الإتلاف = مجموع سطوره', wastage.totalCostMinor, sum(wastage.lines, (line) => line.costTotalMinor))
const consumption = st().postConsumption({ purpose: 'تشغيل', expenseAccount: '5101', lines: [{ itemId: a.id, qty: 0.3 }], notes: '' })
eq('تكلفة الاستهلاك = مجموع سطوره', consumption.totalCostMinor, sum(consumption.lines, (line) => line.costTotalMinor))

r.section('📋 جرد: الصافي = مجموع الفروق، والعجز/الزيادة = تجميعها')
const beforeQty = st().items.find((row) => row.id === b.id).stockQty
const counted = round3(beforeQty - 0.5)
const stocktake = st().postStocktake([
  { itemId: b.id, nameAr: b.nameAr, expectedQty: beforeQty, countedQty: counted, unitCostMinor: st().items.find((row) => row.id === b.id).costMinor },
], 'عقد')
eq('صافي المستند = مجموع قيم الفروق', stocktake.result.netValueMinor, sum(stocktake.result.variances, (variance) => variance.valueMinor))
eq('الزيادة − العجز = الصافي', stocktake.result.surplusValueMinor - stocktake.result.shortageValueMinor, stocktake.result.netValueMinor)
eq('الفرق المعلن = المعدود − الدفتري', round3(sum(stocktake.result.variances, (variance) => variance.diffQty)), round3(counted - beforeQty))

r.section('🔁 تحويل: الكمية المعلنة = مجموع السطور')
const transfer = st().postTransfer({ fromWarehouseId: wh, toWarehouseId: wh2, lines: [{ itemId: b.id, qty: 0.25 }], notes: '' })
eq('إجمالي كمية التحويل = مجموع سطوره', transfer.totalQty, round3(sum(transfer.lines, (line) => line.qty)))

r.section('🏭 إنتاج: قيمة المخرجات = قيمة المدخلات')
const product = (() => { addSimpleItem(c, { nameAr: 'منتج العقد', priceMinor: 6000 }); return st().items.at(-1) })()
const production = st().postProduction({ batches: 1, productItemId: product.id, producedQty: 2, ingredients: [{ itemId: a.id, qty: 1.5, warehouseId: wh }], warehouseId: wh, ingredientWarehouseId: wh, notes: '' })
eq('إجمالي تكلفة الأمر = مجموع تكاليف المكوّنات', production.totalCostMinor, sum(production.ingredientItems, (line) => line.totalCostMinor))
eq('تكلفة المكوّنات = الإجمالي نفسه', production.ingredientsCostMinor, production.totalCostMinor)

r.section('🧾 سند: مبلغ واحد صريح')
const voucher = st().postVoucher({ kind: 'receipt', partyKind: 'customer', partyId: customer.id, treasury: '1101', counterAccountCode: '1104', amountMinor: 1234, description: 'عقد', date: '2026-11-17' })
eq('مبلغ السند كما أُدخل', voucher.amountMinor, 1234)
if ((voucher.lines?.length ?? 0) > 1) throw new Error('سند بمبلغ موزّع على سطور — العقد يفترض مبلغاً واحداً صريحاً')
r.ok('السند يحمل مبلغاً واحداً صريحاً')

r.done()
