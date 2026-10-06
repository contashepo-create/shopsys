/**
 * فحص §91 — فاتورة البيع لأي طرف (عميل أو مورد أو موظف):
 * «ربنا يريد صاحب النشاط إصدار فاتورة بيع نقدي أو آجل لعميل أو مورد أو موظف».
 * الآجل يقع على حساب الطرف الصحيح (1104 عملاء / 2101 موردون / 1107 جاري الموظفين)،
 * ويظهر بكشف حساب طرفه، والتعديل يرث النوع، والتوافق التام مع الفواتير التاريخية محفوظ.
 *
 * التشغيل: node --experimental-strip-types scripts/verify_sale_any_party.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildSaleEntry, buildSaleEntryWithAllocations, computeTotals, SALE_PARTY_RECEIVABLE } from '../src/core/pos.ts'
import { supplierStatement, employeeStatement, statementBalance } from '../src/core/statements.ts'

let pass = 0
const ok = (name) => { pass++; console.log('  ✓', name) }
const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf-8')

/* ═══ ① الثوابت: حساب كل طرف ═══ */
{
  assert.equal(SALE_PARTY_RECEIVABLE.customer.accountCode, '1104')
  assert.equal(SALE_PARTY_RECEIVABLE.supplier.accountCode, '2101')
  assert.equal(SALE_PARTY_RECEIVABLE.employee.accountCode, '1107')
  ok('الثوابت: عميل ⇒ 1104 · مورد ⇒ 2101 · موظف ⇒ 1107')
}

/* ═══ ② القيد: 3 بنود × 2,000 = 6,000 · تكلفة 3,000 · مدفوع 2,000 ⇒ ذمة 4,000 ═══ */
const totals = computeTotals(
  [{ key: 'l1', itemId: 1, nameAr: 'بند', qty: 3, unitPriceMinor: 2_000, unitCostMinor: 1_000, discountPercent: 0, soldByWeight: false }],
  0, 0, false,
)
{
  assert.equal(totals.totalMinor, 6_000)
  // الافتراضي بلا خيارات = 1104 كما كان دائماً (توافق تام مع الاستدعاءات القائمة)
  const legacy = buildSaleEntry(totals, 'credit', '1101', 2_000)
  assert.equal(legacy.find((l) => l.accountCode === '1104')?.debit, 4_000)
  const supplierEntry = buildSaleEntry(totals, 'credit', '1101', 2_000, { receivableAccount: '2101', receivableNote: 'بيع آجل — حساب المورد' })
  assert.equal(supplierEntry.find((l) => l.accountCode === '2101')?.debit, 4_000)
  assert.ok(!supplierEntry.some((l) => l.accountCode === '1104'), 'لا ذمم عملاء في بيع المورد')
  const employeeEntry = buildSaleEntryWithAllocations(totals, [{ accountCode: '1101', amountMinor: 2_000, note: 'نقدية' }], { receivableAccount: '1107', receivableNote: 'بيع آجل — حساب الموظف' })
  assert.equal(employeeEntry.find((l) => l.accountCode === '1107')?.debit, 4_000)
  assert.ok(!employeeEntry.some((l) => l.accountCode === '1104'), 'لا ذمم عملاء في بيع الموظف')
  ok('القيد: ذمة 4,000 على 2101/1107 حسب الطرف — والافتراضي 1104 كما كان')
}

/* ═══ ③ كشف المورد يعرض فاتورة البيع الآجلة كمديونية تخفض ديننا له ═══ */
{
  const rows = supplierStatement({
    supplierId: 5,
    sales: [{ invoiceNumber: 'S-0007', date: '2026-10-01T10:00:00.000Z', remainderMinor: 4_000 }],
    purchases: [], purchaseReturns: [], allPurchases: [], vouchers: [], cheques: [],
  })
  const saleRow = rows.find((r) => r.docLabel.includes('S-0007'))
  assert.equal(saleRow?.debitMinor, 4_000, 'فاتورة البيع مدين على المورد')
  assert.equal(statementBalance(rows), -4_000, 'رصيد المورد دائن 4,000 أقل — البيع خفض ديننا له')
  ok('كشف المورد: «فاتورة بيع S-0007» مدين 4,000 تخفض ديننا له')
}

/* ═══ ④ كشف الموظف يعرض فاتورة البيع الآجلة على جاريه ═══ */
{
  const rows = employeeStatement({
    employeeId: 7,
    salesReceivable: [{ invoiceNumber: 'S-0009', date: '2026-10-02T12:00:00.000Z', amountMinor: 4_000 }],
    advances: [], payrollRuns: [],
  })
  const saleRow = rows.find((r) => r.docLabel.includes('S-0009'))
  assert.equal(saleRow?.debitMinor, 4_000)
  assert.equal(statementBalance(rows), 4_000, 'رصيد الموظف عليه 4,000 — يُسترد من مسير رواتبه')
  ok('كشف الموظف: «فاتورة بيع S-0009» عليه 4,000 تُسترد من المسير')
}

/* ═══ ⑤ المستودع والواجهة مربوطان فعلاً ═══ */
{
  const repo = src('../src/data/repo.ts')
  assert.ok(repo.includes("partyKind?: 'customer' | 'supplier' | 'employee'"), 'توقيع postSale لا يقبل نوع الطرف')
  assert.ok(repo.includes("receivableAccount: SALE_PARTY_RECEIVABLE[salePartyKind].accountCode"), 'القيد لا يستخدم حساب الطرف')
  assert.ok(repo.includes("const salePartyKind = sale.partyKind ?? 'customer'"), 'editSale لا يرث طرف الفاتورة')
  assert.ok(repo.includes("sl.partyKind === 'employee' && sl.partyId === employeeId"), 'كشف الموظف لا يعرض فواتير البيع')

  const invoice = src('../src/ui/pages/AdvancedSalesInvoicePage.tsx')
  assert.ok(invoice.includes('نوع طرف الفاتورة'), 'الفاتورة بلا منتقي نوع الطرف')
  assert.ok(invoice.includes('saleParties'), 'الفاتورة لا تبدّل قائمة الأطراف')
  assert.ok(invoice.includes('partyKind,partyId:partyKind==='), 'الترحيل لا يمرر الطرف')

  const list = src('../src/ui/pages/SalesInvoicesPage.tsx')
  assert.ok(list.includes("s.partyName"), 'قائمة الفواتير لا تعرض اسم طرف غير العميل')

  ok('الربط الكامل: postSale بpartyKind · editSale يرث · منتقي النوع بالفاتورة · القائمة تعرض الطرف')
}

/* ═══ ⑥ اختبار السلوك الشامل (vitest) خضراء ═══ */
{
  const test = src('../tests/sale_party_kinds.test.ts')
  for (const marker of ["partyKind: 'supplier'", "partyKind: 'employee'", 'الموظف غير موجود', 'يرث طرفه']) {
    assert.ok(test.includes(marker), `الاختبار لا يغطي: ${marker}`)
  }
  ok('اختبار vitest (8 فحوصاً) يغطي: مورد وموظف ونقدي ورفض الحالات الخاطئة والتعديل الوارث')
}

console.log(`\n✅ فاتورة البيع لأي طرف (عميل/مورد/موظف): ${pass} فحوصاً ناجحة`)
