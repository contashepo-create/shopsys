/**
 * حسابات المراقبة والمقاصة — نتائج التدقيق AUDIT-010 وAUDIT-011 وAUDIT-012 وAUDIT-013.
 *
 * ① AUDIT-010: الوردية لا تُفتح ولا تُقفل بقيمة غير رقمية (كان undefined يمر فيصير «المتوقع» NaN).
 * ② AUDIT-011: القيد اليدوي على حساب مراقبة:
 *      • المقفلة تماماً (1106 أوراق قبض، 1107 سلف، 1108 عهد، 2116 عمولات) مرفوضة برسالة ترشد لمستندها.
 *      • حسابا الأطراف (1104، 2101) مسموحان **بشرط تحديد الطرف** — والسطر يدخل كشف حسابه فوراً،
 *        وعكس القيد ينقل الطرف معه فيتوازن الكشف.
 *      • المخزون 1103 مسموح عمداً (تسويات المحاسب) — موثق في الكود.
 * ③ AUDIT-012: مستند مقاصة OFS يخفض العميل والمورد معاً بسقف أقل الرصيدين.
 * ④ AUDIT-013: كشف الحساب من مصدر واحد — نفس الأرقام من دالة المتجر ومن الشاشة.
 *
 * تشغيل: node --experimental-strip-types scripts/verify_control_accounts_offset.mjs
 */
import assert from 'node:assert/strict'
import { freshCase, assertInvariants, expectReject, balanceOf, addSimpleItem, addParty, reporter } from './auditKit.mjs'
import { fileURLToPath } from 'node:url'
const APP_ROOT = fileURLToPath(new URL('..', import.meta.url))

const R = reporter('حسابات المراقبة والمقاصة (AUDIT-010…013)')
const bal = (c, code) => balanceOf(c.st().journal, code)
const sellOnCredit = (c, customerId, amountMinor) => {
  const item = addSimpleItem(c, { nameAr: `خدمة ${amountMinor}`, priceMinor: amountMinor, isService: true })
  return c.st().postSale({
    lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 1, unitPriceMinor: amountMinor, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }],
    customerId, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, treasury: '1101',
  })
}

// ——— ① AUDIT-010: الوردية ———
{
  const c = await freshCase({ activityId: 'grocery' })
  expectReject('فتح وردية بلا رصيد درج', c, () => c.st().openShift('كاشير'), /الدرج الافتتاحي/)
  expectReject('فتح وردية بكائن بدل الاسم', c, () => c.st().openShift({ openingCashMinor: 10000 }, 10000), /اسم فاتح الوردية/)
  expectReject('رصيد درج كسري', c, () => c.st().openShift('كاشير', 10.5), /القرش الصحيح/)
  R.ok('AUDIT-010: فتح الوردية يرفض القيمة الغائبة والكسرية والاسم غير النصي')
  const shift = c.st().openShift('كاشير', 10000)
  assert.equal(shift.openingCashMinor, 10000)
  expectReject('إقفال بلا عدّ', c, () => c.st().closeShift(), /المعدودة/)
  const closed = c.st().closeShift(12000)
  assert.equal(closed.countedCashMinor, 12000)
  assert.equal(closed.status, 'closed')
  R.ok('AUDIT-010: الإقفال يرفض العدّ الغائب ويسجل المعدود صحيحاً — «المتوقع» رقم دائماً')
}

// ——— ② AUDIT-011: حسابات المراقبة ———
{
  const c = await freshCase({ activityId: 'general' })
  const cust = addParty(c, 'customer', 'عميل المراقبة')
  const sup = addParty(c, 'supplier', 'مورد المراقبة')
  const locked = [
    ['1106', 'أوراق قبض'],
    ['1107', 'سلف الموظفين'],
    ['1108', 'عهد الموظفين'],
    ['2116', 'عمولات مستحقة'],
  ]
  for (const [code, label] of locked) {
    expectReject(`قيد يدوي على ${code}`, c, () => c.st().postManualEntry({
      date: '2026-06-01', description: `محاولة على ${label}`,
      lines: [
        { accountCode: code, debit: 10000, credit: 0, note: '' },
        { accountCode: '1101', debit: 0, credit: 10000, note: '' },
      ],
    }), /حساب مراقبة/)
  }
  R.ok(`AUDIT-011: ${locked.length} حسابات مراقبة مقفلة ترفض القيد اليدوي برسالة ترشد لمستندها`)
  // 1104 بلا طرف يُرفض
  expectReject('1104 بلا عميل', c, () => c.st().postManualEntry({
    date: '2026-06-01', description: 'ذمة بلا طرف',
    lines: [
      { accountCode: '1104', debit: 50000, credit: 0, note: '' },
      { accountCode: '4110', debit: 0, credit: 50000, note: '' },
    ],
  }), /حدد العميل/)
  expectReject('2101 بلا مورد', c, () => c.st().postManualEntry({
    date: '2026-06-01', description: 'دين بلا طرف',
    lines: [
      { accountCode: '5108', debit: 50000, credit: 0, note: '' },
      { accountCode: '2101', debit: 0, credit: 50000, note: '' },
    ],
  }), /حدد المورد/)
  expectReject('طرف غير مسجل', c, () => c.st().postManualEntry({
    date: '2026-06-01', description: 'عميل وهمي',
    lines: [
      { accountCode: '1104', debit: 50000, credit: 0, note: '', partyKind: 'customer', partyId: 9999 },
      { accountCode: '4110', debit: 0, credit: 50000, note: '' },
    ],
  }), /غير موجود/)
  R.ok('AUDIT-011: 1104 و2101 يرفضان السطر بلا طرف مسجل — لا ذمة بلا صاحب')
  // مع الطرف: يمر ويدخل الكشف
  const entry = c.st().postManualEntry({
    date: '2026-06-02', description: 'تحميل غرامة تأخير على العميل',
    lines: [
      { accountCode: '1104', debit: 50000, credit: 0, note: 'غرامة تأخير', partyKind: 'customer', partyId: cust.id },
      { accountCode: '4110', debit: 0, credit: 50000, note: 'إيراد غرامات' },
    ],
  })
  assert.equal(bal(c, '1104'), 50000)
  assert.equal(c.st().getCustomerBalance(cust.id), 50000, 'الكشف تحرك مع الدفتر (ث7)')
  assert.ok(c.st().getCustomerStatementRows(cust.id).some((r) => r.docLabel.includes('قيد يدوي')), 'صف القيد اليدوي داخل الكشف')
  assertInvariants('قيد يدوي بطرف', c)
  R.ok('AUDIT-011: القيد اليدوي بطرف محدد يدخل كشف العميل — الدفتر = الكشف بالقرش')
  // مورد كذلك
  c.st().postManualEntry({
    date: '2026-06-03', description: 'مصروف على حساب المورد',
    lines: [
      { accountCode: '5108', debit: 30000, credit: 0, note: 'خدمة' },
      { accountCode: '2101', debit: 0, credit: 30000, note: 'مستحق', partyKind: 'supplier', partyId: sup.id },
    ],
  })
  assert.equal(c.st().getSupplierBalance(sup.id), 30000)
  assertInvariants('قيد يدوي بمورد', c)
  R.ok('AUDIT-011: القيد اليدوي على 2101 بمورد محدد يدخل كشف المورد')
  // العكس ينقل الطرف
  c.st().reverseEntry(entry.id, 'إلغاء الغرامة بقرار المالك')
  assert.equal(bal(c, '1104'), 0)
  assert.equal(c.st().getCustomerBalance(cust.id), 0, 'العكس صفّر الكشف كما صفّر الدفتر')
  assertInvariants('عكس قيد بطرف', c)
  R.ok('AUDIT-011: عكس القيد ينقل الطرف معه — الكشف والدفتر يعودان صفراً معاً')
  // 1103 مسموح عمداً للمحاسب
  const before1103 = bal(c, '1103')
  c.st().postManualEntry({
    date: '2026-06-04', description: 'هبوط قيمة مخزون راكد (تسوية محاسب)',
    lines: [
      { accountCode: '5111', debit: 20000, credit: 0, note: 'هبوط قيمة' },
      { accountCode: '1103', debit: 0, credit: 20000, note: 'تخفيض تقييم' },
    ],
  })
  assert.equal(bal(c, '1103'), before1103 - 20000)
  R.ok('AUDIT-011: المخزون 1103 يبقى مفتوحاً لتسويات المحاسب (موثق في الكود ومحمي بالثابت الخامس)')
}

// ——— ③ AUDIT-012: المقاصة ———
{
  const c = await freshCase({ activityId: 'general' })
  const cust = addParty(c, 'customer', 'شريك تجاري')
  const sup = addParty(c, 'supplier', 'شريك تجاري')
  sellOnCredit(c, cust.id, 300000)
  const item = addSimpleItem(c, { nameAr: 'خامة', priceMinor: 1000 })
  c.st().postPurchase({
    supplierId: sup.id, date: '2026-06-05', lines: [{ itemId: item.id, qty: 100, unitPriceMinor: 2000, expiryDate: null }],
    expenses: [], paidMinor: 0, treasury: '1101', notes: '',
  })
  expectReject('مقاصة بصفر', c, () => c.st().postPartyOffset({ customerId: cust.id, supplierId: sup.id, amountMinor: 0 }), /أكبر من صفر/)
  expectReject('مقاصة فوق السقف', c, () => c.st().postPartyOffset({ customerId: cust.id, supplierId: sup.id, amountMinor: 300000 }), /أقصى مقاصة/)
  const doc = c.st().postPartyOffset({ customerId: cust.id, supplierId: sup.id, amountMinor: 200000, notes: 'تسوية ربع سنوية' })
  assert.match(doc.offsetNumber, /^OFS-\d{4}$/)
  assert.equal(c.st().getCustomerBalance(cust.id), 100000)
  assert.equal(c.st().getSupplierBalance(sup.id), 0)
  assert.equal(bal(c, '1104'), 100000)
  assert.equal(bal(c, '2101'), 0)
  const entry = c.st().journal.find((e) => e.id === doc.journalEntryId)
  assert.equal(entry.sourceType, 'party_offset')
  assert.equal(entry.sourceId, doc.id)
  assertInvariants('مقاصة', c)
  R.ok('AUDIT-012: مستند OFS يخفض الطرفين بقيد واحد، بسقف أقل الرصيدين، وبمصدر party_offset موثق')
  expectReject('مقاصة بلا مستحق للمورد', c, () => c.st().postPartyOffset({ customerId: cust.id, supplierId: sup.id, amountMinor: 1000 }), /لا مستحق للمورد/)
  R.ok('AUDIT-012: بعد إقفال المورد لا مقاصة جديدة — لا رصيد سالب مصطنع')
}

// ——— ④ AUDIT-013: مصدر واحد للكشف ———
{
  const { readFileSync } = await import('node:fs')
  const root = `${APP_ROOT}/`
  for (const f of ['src/ui/pages/StatementsPage.tsx', 'src/ui/pages/SettlementsPage.tsx']) {
    const src = readFileSync(root + f, 'utf8')
    assert.ok(!src.includes('customerStatement('), `${f}: لا يعيد تركيب كشف العميل`)
    assert.ok(!src.includes('supplierStatement('), `${f}: لا يعيد تركيب كشف المورد`)
  }
  R.ok('AUDIT-013: شاشتا الكشوف والتسويات لا تحتويان نسخة موازية من منطق الكشف')
  const c = await freshCase({ activityId: 'general' })
  const cust = addParty(c, 'customer', 'عميل الولاء')
  sellOnCredit(c, cust.id, 100000)
  const rowsBalance = c.st().getCustomerStatementRows(cust.id).reduce((s, r) => s + r.debitMinor - r.creditMinor, 0)
  assert.equal(rowsBalance, c.st().getCustomerBalance(cust.id))
  assert.equal(rowsBalance, bal(c, '1104'))
  R.ok('AUDIT-013: صفوف الكشف = رصيد الدالة = رصيد الدفتر — ثلاثتها رقم واحد')
}

/* ⑤ واجهة المقاصة موجودة فعلاً (لا محرك بلا شاشة) */
{
  const { readFileSync } = await import('node:fs')
  const page = readFileSync(`${APP_ROOT}/src/ui/pages/SettlementsPage.tsx`, 'utf8')
  assert.ok(page.includes('postPartyOffset'), 'شاشة التسويات لا تستدعي محرك المقاصة')
  assert.ok(page.includes('offsetCapMinor') && page.includes('أقصى مقاصة ممكنة'), 'الشاشة لا تعرض سقف المقاصة (أقل الرصيدين)')
  assert.ok(page.includes('getCustomerBalance') && page.includes('getSupplierBalance'), 'الشاشة لا تعرض رصيدي الطرفين قبل المقاصة')
  assert.ok(page.includes('القيد الذي سيُرحَّل'), 'الشاشة لا تُظهر القيد قبل الترحيل')
  assert.ok(page.includes('doc-head') && page.includes('doc-footer'), 'نافذة المقاصة ليست بلغة المستند')
  R.ok('واجهة المقاصة موجودة في شاشة التسويات: رصيدا الطرفين + سقف المقاصة + القيد المعلن + لغة المستند')
}

R.done('— حسابات المراقبة مغلقة بمستنداتها، والمقاصة لها مستندها وشاشتها، والكشف مصدره واحد')
