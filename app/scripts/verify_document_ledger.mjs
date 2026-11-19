/**
 * verify_document_ledger.mjs — الطبقة ③ من منهجية الفحص: **مطابقة المستند بالدفتر**
 * ────────────────────────────────────────────────────────────────────────────────
 * الثغرة التي وُلدت منها (D9): مستند يحمل بنداً بمبلغ، والدفتر لا يعرف عنه شيئاً.
 * الثوابت العامة لا تكشفها لأن الحالة تبقى *متوازنة* — المتوازن ليس صحيحاً بالضرورة.
 *
 * هذه البوابة تفحص شيئين لا يفحصهما أي شيء آخر:
 *   ① **صحة المستند الذاتية**: كل إجمالي = مجموع أجزائه، وكل بند مُعلن داخل الإجمالي.
 *   ② **مطابقة المستند للدفتر**: كل رقم في المستند يقابله حركة حساب بالقرش.
 *
 * التشغيل: node --experimental-strip-types scripts/verify_document_ledger.mjs
 */
import { freshCase, addSimpleItem, balanceOf, assertInvariants, reporter } from './auditKit.mjs'
import { computeTotals } from '../src/core/pos.ts'

const r = reporter('مطابقة المستند بالدفتر')
const acc = (entry) => {
  const out = new Map()
  for (const line of entry?.lines ?? []) {
    const row = out.get(line.accountCode) ?? { debit: 0, credit: 0 }
    row.debit += line.debit || 0
    row.credit += line.credit || 0
    out.set(line.accountCode, row)
  }
  return {
    debit: (code) => out.get(code)?.debit ?? 0,
    credit: (code) => out.get(code)?.credit ?? 0,
    net: (code) => (out.get(code)?.debit ?? 0) - (out.get(code)?.credit ?? 0),
    codes: () => [...out.keys()].sort(),
    credits: () => [...out.values()].reduce((sum, row) => sum + row.credit, 0),
    debits: () => [...out.values()].reduce((sum, row) => sum + row.debit, 0),
  }
}
const eq = (label, actual, expected) => {
  if (actual !== expected) throw new Error(`${label}: المستند/الدفتر يقول ${expected} والنظام سجّل ${actual}`)
  r.ok(`${label} = ${expected}`)
}
const entryOf = (st, type, id) => {
  const matches = st().journal.filter((entry) => entry.sourceType === type && entry.sourceId === id)
  if (matches.length !== 1) throw new Error(`قيد «${type}#${id}» يجب أن يكون واحداً — وجد ${matches.length}`)
  return matches[0]
}
const valueSum = (st) => st().items.reduce((sum, it) => sum + (Number.isFinite(it.stockValueMinor) ? it.stockValueMinor : Math.round(it.stockQty * it.costMinor)), 0)

// ════════════════════════════════════════════════════════════════════════════
// السيناريو: بقالة، ضريبة 15% شاملة، مخزنان، مورد وعميل
// ════════════════════════════════════════════════════════════════════════════
const c = await freshCase({ activityId: 'grocery', vatPercent: 15, taxInclusive: true })
const st = c.st
const wh = st().warehouses[0]?.id ?? 1
st().addWarehouse('مخزن ثانٍ')
const wh2 = st().warehouses.at(-1).id
st().addSupplier({ nameAr: 'مورد الفحص', phone: '', notes: '' })
const supplier = st().suppliers.at(-1)
st().addCustomer({ nameAr: 'عميل الفحص', phone: '', notes: '' })
const customer = st().customers.at(-1)
const item = addSimpleItem(c, { nameAr: 'زيت فحص', priceMinor: 1150 })
const item2 = addSimpleItem(c, { nameAr: 'أرز فحص', priceMinor: 2300 })

r.section('🧾 شراء: الإجمالي = بضاعة + مصاريف، وكل بند مصروف داخل الإجمالي')
const purchase = st().postPurchase({
  supplierId: supplier.id, date: '2026-11-17',
  lines: [
    { itemId: item.id, qty: 10, unitPriceMinor: 1000, vatPercent: 15, warehouseId: wh },
    { itemId: item2.id, qty: 4.5, unitPriceMinor: 2000, vatPercent: 15, warehouseId: wh },
  ],
  expenses: [
    { nameAr: 'نقل', amountMinor: 300, method: 'qty', paidBy: 'supplier', costTreatment: 'inventory' },
    { nameAr: 'تأمين', amountMinor: 120, method: 'value', paidBy: 'treasury', payAccount: '1101', costTreatment: 'inventory', taxTreatment: 'exempt' },
    { nameAr: 'أجرة تفريغ', amountMinor: 80, method: 'qty', paidBy: 'payable', beneficiaryName: 'شركة تفريغ', payableAccountCode: '2117', costTreatment: 'inventory', taxTreatment: 'exempt' },
  ],
  paidMinor: 2000, treasury: '1101', notes: '',
})
const purchaseEntry = acc(entryOf(st, 'purchase', purchase.id))
eq('إجمالي الفاتورة = بضاعة + مصاريف', purchase.grandTotalMinor, purchase.goodsTotalMinor + purchase.expensesTotalMinor)
eq('مجموع بند المصاريف المعلن = إجمالي المصاريف المحمَّلة', purchase.expensesTotalMinor, 300 + 120 + 80)
eq('مدين المخزون = البضاعة + المصاريف المحمَّلة', purchaseEntry.debit('1103'), purchase.grandTotalMinor)
eq('مدين ضريبة المدخلات = ضريبة المستند', purchaseEntry.debit('2102'), purchase.inputVatMinor)
eq('دائن المورد = المستحق − المدفوع', purchaseEntry.credit('2101'), purchase.supplierDueMinor - purchase.paidMinor)
const treasuryExpenses = purchase.expenses.filter((expense) => expense.paidBy === 'treasury').reduce((sum, expense) => sum + expense.amountMinor, 0)
eq('دائن الخزينة = المدفوع + المصاريف المدفوعة من الخزينة', purchaseEntry.credit('1101'), purchase.paidMinor + treasuryExpenses)
eq('دائن الاستحقاق لجهة أخرى = بند المصروف', purchaseEntry.credit('2117'), 80)
eq('الدفتر متوازن (مجموع المدين = الدائن)', purchaseEntry.debits(), purchaseEntry.credits())
if (purchase.warehouseId == null) throw new Error('الفاتورة بلا مخزن — لا يمكن نسبة الرصيد')
r.ok('الفاتورة تحمل مخزنها صراحةً')

r.section('🧾 بيع ضريبة شاملة: الإجمالي = الخزينة، والأساس + الضريبة = الإجمالي')
const saleLines = [
  { itemId: item.id, nameAr: item.nameAr, qty: 3, unitPriceMinor: 1150, unitCostMinor: st().items.find((row) => row.id === item.id).costMinor, discountPercent: 0, soldByWeight: false, warehouseId: wh },
  { itemId: item2.id, nameAr: item2.nameAr, qty: 1.5, unitPriceMinor: 2300, unitCostMinor: st().items.find((row) => row.id === item2.id).costMinor, discountPercent: 0, soldByWeight: true, warehouseId: wh },
]
const saleTotals = computeTotals(saleLines, 0, 15, true, 2)
const sale = st().postSale({ lines: saleLines, customerId: null, payment: 'cash', treasury: '1101', paidMinor: saleTotals.totalMinor, invoiceDiscountPercent: 0, taxPercent: 15, taxInclusive: true })
const saleEntry = acc(entryOf(st, 'sale', sale.id))
eq('إجمالي الفاتورة = ما دفعه العميل', saleEntry.debit('1101'), sale.totals.totalMinor)
eq('دائن المبيعات = الأساس الضريبي', saleEntry.credit('4101'), sale.totals.taxBaseMinor)
eq('دائن الضريبة = ضريبة الفاتورة', saleEntry.credit('2102'), sale.totals.taxMinor)
eq('مدين تكلفة المبيعات = تكلفة المستند', saleEntry.debit('5101'), sale.totals.cogsMinor)
eq('دائن المخزون = تكلفة المبيعات نفسها (لا انفصال)', saleEntry.credit('1103'), sale.totals.cogsMinor)
eq('مجموع تكاليف السطور = تكلفة الفاتورة', sale.lines.reduce((sum, line) => sum + (line.costTotalMinor ?? 0), 0), sale.totals.cogsMinor)
eq('الأساس + الضريبة = الإجمالي', sale.totals.taxBaseMinor + sale.totals.taxMinor, sale.totals.totalMinor)

r.section('🧾 مرتجع بيع: الرد = نقد + ذمم + رصيد + تنازل، والتكلفة تنعكس كاملة')
const saleReturn = st().postSaleReturn({ saleId: sale.id, lineSpecs: [{ lineIndex: 0, qty: 1, condition: 'good' }], refund: 'cash' })
const returnEntry = acc(entryOf(st, 'sale_return', saleReturn.id))
eq('إجمالي المرتجع = مجموع مكوّنات الرد', saleReturn.totals.totalMinor, (saleReturn.cashRefundMinor ?? 0) + (saleReturn.creditRefundMinor ?? 0) + (saleReturn.waivedRefundMinor ?? 0))
eq('دائن الخزينة = الرد النقدي', returnEntry.credit('1101'), saleReturn.cashRefundMinor ?? 0)
eq('مدين مرتجعات المبيعات = الأساس', returnEntry.debit('4102'), saleReturn.totals.taxBaseMinor)
eq('مدين الضريبة = ضريبة المرتجع', returnEntry.debit('2102'), saleReturn.totals.taxMinor)
eq('دائن تكلفة المبيعات = تكلفة المرتجع', returnEntry.credit('5101'), saleReturn.totals.cogsMinor)
eq('مدين المخزون + الهالك = تكلفة المرتجع', returnEntry.debit('1103') + returnEntry.debit('5111'), saleReturn.totals.cogsMinor)

r.section('🧾 مرتجع شراء: المستند يعلن ما دفعه المورد وما خرج من المخزون')
const purchaseReturn = st().postPurchaseReturn({ purchaseId: purchase.id, lineSpecs: [{ lineIndex: 0, qty: 1, warehouseId: wh }], refund: 'cash', reason: 'فحص' })
const purchaseReturnRaw = entryOf(st, 'purchase_return', purchaseReturn.id)
const purchaseReturnEntry = acc(purchaseReturnRaw)
eq('قيمة المستند = الكمية × التكلفة المحمَّلة للسطر', purchaseReturn.totalMinor, Math.round(purchaseReturn.lines[0].qty * purchaseReturn.lines[0].landedUnitCostMinor))
eq('دائن المخزون = القيمة الخارجة الفعلية (بالقرش)', purchaseReturnEntry.credit('1103'), purchaseReturn.inventoryOutMinor)
eq('فرق تقييم السطر ينزل في تكلفة المبيعات لا يضيع', purchaseReturnEntry.credit('5101'), purchaseReturn.inventoryVarianceMinor)
eq('المردود للمورد نقداً = قيمة البضاعة + ضريبتها', purchaseReturnEntry.debit('1101'), purchaseReturn.supplierValueMinor + purchaseReturn.inputVatShareMinor)
eq('ضريبة المرتجع تعكس حصة المدخلات', purchaseReturnEntry.credit('2102'), purchaseReturn.inputVatShareMinor)
eq('فرق التكلفة يُحمَّل على الهالك لا يُخفى', purchaseReturnEntry.debit('5111'), purchaseReturn.totalMinor - purchaseReturn.supplierValueMinor)
eq('قيد المرتجع متوازن', purchaseReturnEntry.debits(), purchaseReturnEntry.credits())

r.section('📦 إتلاف: القيمة الخارجة = تكلفة المستند = هالك 5111')
const wastage = st().postWastage({ reason: 'تلف', lines: [{ itemId: item.id, qty: 0.5 }], notes: '' })
const wastageEntry = acc(entryOf(st, 'wastage', wastage.id))
eq('تكلفة مستند الإتلاف = مدين الهالك', wastageEntry.debit('5111'), wastage.totalCostMinor)
eq('دائن المخزون = تكلفة الإتلاف', wastageEntry.credit('1103'), wastage.totalCostMinor)

r.section('📋 جرد: صافي المستند = صافي حركة المخزون')
const currentQty = st().items.find((row) => row.id === item2.id).stockQty
const stocktake = st().postStocktake([{ itemId: item2.id, nameAr: item2.nameAr, expectedQty: currentQty, countedQty: Math.round((currentQty - 0.4) * 1000) / 1000, unitCostMinor: st().items.find((row) => row.id === item2.id).costMinor }], 'فحص')
const stocktakeEntry = acc(entryOf(st, 'adjustment', stocktake.id))
/* F3: عجز الجرد بلا سبب مبرَّر يُقيَّد فقداً على 5120 (الهالك 5111 للمبرَّر فقط) */
eq('عجز الجرد المعلن = مدين الفقد 5120', stocktakeEntry.debit('5120'), stocktake.result.shortageValueMinor)
eq('دائن المخزون = صافي المستند', stocktakeEntry.credit('1103'), stocktake.result.shortageValueMinor - stocktake.result.surplusValueMinor)

r.section('🔁 تحويل بين المخازن: لا حركة دفترية ولا تغيّر في قيمة المخزون')
const beforeTransfer = balanceOf(st().journal, '1103')
const beforeQty = st().items.find((row) => row.id === item.id).stockQty
const transfer = st().postTransfer({ fromWarehouseId: wh, toWarehouseId: wh2, lines: [{ itemId: item.id, qty: 0.25 }], notes: '' })
eq('رصيد المخزون الدفتري لم يتغيّر', balanceOf(st().journal, '1103'), beforeTransfer)
eq('كمية الصنف لم تتغيّر', Math.round(st().items.find((row) => row.id === item.id).stockQty * 1000), Math.round(beforeQty * 1000))
eq('المستند يعلن الكمية المنقولة', transfer.totalQty, 0.25)
if (st().journal.some((entry) => entry.sourceType === 'transfer' && entry.sourceId === transfer.id)) throw new Error('التحويل الداخلي أنشأ قيداً — التكلفة تنتقل ولا تُقيَّد')

r.section('🧾 سند قبض: المبلغ = حركة الخزينة وحركة الطرف')
const voucher = st().postVoucher({ kind: 'receipt', partyKind: 'customer', partyId: customer.id, treasury: '1101', counterAccountCode: '1104', amountMinor: 500, description: 'دفعة عميل', date: '2026-11-17' })
const voucherEntry = acc(entryOf(st, 'receipt_voucher', voucher.id))
eq('مدين الخزينة = مبلغ السند', voucherEntry.debit('1101'), voucher.amountMinor)
eq('دائن حساب الطرف = مبلغ السند', voucherEntry.credit('1104'), voucher.amountMinor)

r.section('🏭 أمر إنتاج: إعادة توزيع داخل المخزون بلا أثر على 1103')
const rawItem = addSimpleItem(c, { nameAr: 'خامة إنتاج', priceMinor: 1500 })
const finished = addSimpleItem(c, { nameAr: 'منتج نهائي', priceMinor: 4000 })
st().postPurchase({ supplierId: supplier.id, date: '2026-11-17', lines: [{ itemId: rawItem.id, qty: 6, unitPriceMinor: 1001, vatPercent: 0, warehouseId: wh }], expenses: [], paidMinor: 0, treasury: '1101', notes: '' })
const beforeProduction = balanceOf(st().journal, '1103')
st().postProduction({ batches: 1, productItemId: finished.id, producedQty: 3, ingredients: [{ itemId: rawItem.id, qty: 4.2, warehouseId: wh }], warehouseId: wh, ingredientWarehouseId: wh, notes: '' })
eq('رصيد المخزون الدفتري لم يتغيّر بالإنتاج', balanceOf(st().journal, '1103'), beforeProduction)
eq('قيمة المخزون الكلية لم تتغيّر', valueSum(st), beforeProduction)

r.section('⚖️ الحكم العام: لا مستند مالي بلا قيد، ولا قيد بلا مستند')
for (const type of ['purchase', 'sale', 'sale_return', 'purchase_return', 'wastage', 'adjustment', 'receipt_voucher']) {
  const orphans = st().journal.filter((entry) => entry.sourceType === type && entry.sourceId == null)
  if (orphans.length) throw new Error(`قيود «${type}» بلا مستند مصدر: ${orphans.length}`)
}
r.ok('كل قيد مصدره مستند معروف')
assertInvariants('بعد دورة المستندات كاملة', c)
eq('1103 = مجموع قيم الأصناف بالقرش', balanceOf(st().journal, '1103'), valueSum(st))
r.done()
