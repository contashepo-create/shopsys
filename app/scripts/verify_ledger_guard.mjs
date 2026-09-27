/**
 * verify_ledger_guard.mjs — بوابة الحارس المركزي للدفتر (المرحلة 1 — إغلاق AUDIT-002 وAUDIT-003).
 *
 * تثبت أن **بوابة واحدة** تحمي دفتر اليومية مهما كان المسار:
 *   أ) وحدةً: `validateEntry`/`assertJournalIntegrity` ترفض كل صنف مخالفة بنص عربي.
 *   ب) تكاملاً: مسارات حقيقية (سند/شراء) صار قفل السنة المالية يسري عليها — لا على القيد اليدوي وحده.
 *   ج) توحيد التاريخ: أي مسار يرسل ISO كاملاً يُخزَّن YYYY-MM-DD (وإلا انفتحت ثغرة «آخر يوم في السنة المقفلة»).
 *   د) لا تعديل صامت لسطور قيد مُرحَّل.
 */
import { freshCase, expectReject, addSimpleItem, addParty, assertInvariants, reporter, STANDARD_COA, useAppStore } from './auditKit.mjs'

const { validateEntry, assertJournalIntegrity, normalizeJournalDates } = await import(new URL('../src/core/ledgerGuard.ts', import.meta.url).href)
const { fullCoa } = await import(new URL('../src/core/treasury.ts', import.meta.url).href)
const { DEFAULT_TREASURIES } = await import(new URL('../src/core/treasury.ts', import.meta.url).href)

const R = reporter('بوابة الحارس المركزي للدفتر')
const CTX = { coa: fullCoa(STANDARD_COA, DEFAULT_TREASURIES), fiscalYears: [{ nameAr: 'سنة 2025', startDate: '2025-01-01', endDate: '2025-12-31', status: 'closed' }] }

const entry = (lines, patch = {}) => ({
  id: 1, entryNumber: 1, date: '2026-05-05', description: 'اختبار', sourceType: 'manual',
  sourceId: 1, lines, createdBy: 'المدقق', createdAt: '2026-05-05T00:00:00.000Z',
  reversedByEntryId: null, reversesEntryId: null, ...patch,
})

// ————————————————————————————————————————————————
// أ) وحدةً — كل صنف مخالفة يُرفض بنص عربي
// ————————————————————————————————————————————————
R.section('🔬 فحص الحارس وحدةً')
const cases = [
  ['قيد غير متزن', entry([{ accountCode: '1101', debit: 1000, credit: 0 }, { accountCode: '4101', debit: 0, credit: 900 }]), /غير متزن/],
  ['سطر بجانبين', entry([{ accountCode: '1101', debit: 500, credit: 500 }, { accountCode: '4101', debit: 0, credit: 500 }, { accountCode: '5108', debit: 500, credit: 0 }]), /مدين ودائن معاً/],
  ['مبلغ سالب', entry([{ accountCode: '1101', debit: -100, credit: 0 }, { accountCode: '4101', debit: 0, credit: -100 }]), /سالب/],
  ['مبلغ كسري', entry([{ accountCode: '1101', debit: 10.5, credit: 0 }, { accountCode: '4101', debit: 0, credit: 10.5 }]), /غير صحيح/],
  ['حساب غير موجود', entry([{ accountCode: '9999', debit: 100, credit: 0 }, { accountCode: '4101', debit: 0, credit: 100 }]), /غير موجود/],
  ['حساب تجميعي', entry([{ accountCode: '11', debit: 100, credit: 0 }, { accountCode: '4101', debit: 0, credit: 100 }]), /تجميعي/],
  ['طرف واحد', entry([{ accountCode: '1101', debit: 0, credit: 0 }]), /طرفين/],
  ['بلا نوع مصدر', entry([{ accountCode: '1101', debit: 100, credit: 0 }, { accountCode: '4101', debit: 0, credit: 100 }], { sourceType: '' }), /نوع مصدر/],
  ['تاريخ غير صالح', entry([{ accountCode: '1101', debit: 100, credit: 0 }, { accountCode: '4101', debit: 0, credit: 100 }], { date: '20-5-2026' }), /تاريخ غير صالح/],
  ['داخل سنة مقفلة', entry([{ accountCode: '1101', debit: 100, credit: 0 }, { accountCode: '4101', debit: 0, credit: 100 }], { date: '2025-06-01' }), /مقفلة/],
]
for (const [label, e, pattern] of cases) {
  const errs = validateEntry(e, CTX)
  if (!errs.length) { console.error(`❌ «${label}» مرّ بلا رفض`); process.exit(1) }
  if (!errs.some((x) => pattern.test(x))) { console.error(`❌ «${label}» رُفض برسالة غير متوقعة: ${errs.join(' | ')}`); process.exit(1) }
  if (!errs.every((x) => /[\u0600-\u06FF]/.test(x))) { console.error(`❌ «${label}» رسالته ليست عربية`); process.exit(1) }
  R.ok(`${label}: مرفوض — «${errs[0].slice(0, 70)}…»`)
}

// قيد الإقفال السنوي مستثنى من قفل السنة (يقع في آخر يوم من السنة المقفلة نفسها)
{
  const closing = entry([{ accountCode: '4101', debit: 1000, credit: 0 }, { accountCode: '3102', debit: 0, credit: 1000 }], { date: '2025-12-31', sourceType: 'year_closing' })
  const errs = validateEntry(closing, CTX)
  if (errs.length) { console.error(`❌ قيد الإقفال السنوي رُفض: ${errs.join(' | ')}`); process.exit(1) }
  R.ok('قيد الإقفال السنوي مسموح داخل السنة المقفلة (استثناء موثق وحيد)')
}

// ث9: تعديل سطور قيد مُرحَّل
{
  const prev = [entry([{ accountCode: '1101', debit: 100, credit: 0 }, { accountCode: '4101', debit: 0, credit: 100 }])]
  const tampered = [{ ...prev[0], lines: [{ accountCode: '1101', debit: 900, credit: 0 }, { accountCode: '4101', debit: 0, credit: 900 }] }]
  let threw = false
  try { assertJournalIntegrity(prev, tampered, CTX) } catch (e) { threw = /تعديل صامت/.test(e.message) }
  if (!threw) { console.error('❌ تعديل سطور قيد مُرحَّل لم يُرفض'); process.exit(1) }
  R.ok('ث9: تعديل سطور قيد مُرحَّل مرفوض — التصحيح بقيد عاكس فقط')
}

// ث4: تكرار رقم القيد
{
  const a = entry([{ accountCode: '1101', debit: 100, credit: 0 }, { accountCode: '4101', debit: 0, credit: 100 }])
  const b = { ...a, id: 2 }
  let threw = false
  try { assertJournalIntegrity([], [a, b], CTX) } catch (e) { threw = /مكرر/.test(e.message) }
  if (!threw) { console.error('❌ تكرار رقم القيد لم يُرفض'); process.exit(1) }
  R.ok('ث4: رقم قيد مكرر مرفوض')
}

// توحيد التاريخ
{
  const iso = [entry([{ accountCode: '1101', debit: 1, credit: 0 }, { accountCode: '4101', debit: 0, credit: 1 }], { date: '2026-09-20T09:00:00.000Z' })]
  const out = normalizeJournalDates(iso)
  if (out[0].date !== '2026-09-20') { console.error('❌ لم يُطبَّع التاريخ'); process.exit(1) }
  if (normalizeJournalDates([entry([{ accountCode: '1101', debit: 1, credit: 0 }, { accountCode: '4101', debit: 0, credit: 1 }])]).length !== 1) { console.error('❌ التطبيع أفسد المصفوفة'); process.exit(1) }
  R.ok('توحيد التاريخ: ISO كامل ⇒ YYYY-MM-DD (يسد ثغرة آخر يوم في السنة المقفلة)')
}

// ————————————————————————————————————————————————
// ب) تكاملاً — المسارات الحقيقية صارت محمية
// ————————————————————————————————————————————————
R.section('🔗 الحارس داخل المسارات الحقيقية')
{
  const c = await freshCase({
    activityId: 'general',
    fiscalYears: [
      { id: 1, nameAr: 'سنة 2025', startDate: '2025-01-01', endDate: '2025-12-31', status: 'closed' },
      { id: 2, nameAr: 'سنة 2026', startDate: '2026-01-01', endDate: '2026-12-31', status: 'open' },
    ],
  })
  const item = addSimpleItem(c, { nameAr: 'صنف', priceMinor: 5000 })
  const sup = addParty(c, 'supplier', 'مورد')
  const cust = addParty(c, 'customer', 'عميل')

  // AUDIT-003 سابقاً: السند كان يمر بتاريخ داخل سنة مقفلة
  expectReject('سند قبض بتاريخ داخل سنة مقفلة', c, () => c.st().postVoucher({
    kind: 'receipt', treasury: '1101', counterAccountCode: '1104', amountMinor: 10000,
    description: 'تحصيل قديم', date: '2025-07-01', partyKind: 'customer', partyId: cust.id,
  }), /مقفلة/)
  R.ok('سند قبض داخل سنة مقفلة: مرفوض الآن (كان يمر قبل الحارس)')

  expectReject('فاتورة شراء بتاريخ داخل سنة مقفلة', c, () => c.st().postPurchase({
    supplierId: sup.id, date: '2025-11-20', treasury: '1101', notes: '', paidMinor: 0, expenses: [],
    lines: [{ itemId: item.id, qty: 5, unitPriceMinor: 3000 }],
  }), /مقفلة/)
  R.ok('فاتورة شراء داخل سنة مقفلة: مرفوضة الآن بلا أثر على المخزون ولا الدفتر')

  // نفس المسارات تعمل داخل السنة المفتوحة
  c.st().postPurchase({ supplierId: sup.id, date: '2026-04-10T08:30:00.000Z', treasury: '1101', notes: '', paidMinor: 0, expenses: [], lines: [{ itemId: item.id, qty: 10, unitPriceMinor: 3000 }] })
  const dates = c.st().journal.map((e) => e.date)
  if (dates.some((d) => d.length !== 10)) { console.error(`❌ تاريخ غير موحد في الدفتر: ${dates.join(', ')}`); process.exit(1) }
  R.ok(`الشراء داخل السنة المفتوحة يمر، وكل تواريخ الدفتر موحدة (${dates.join('، ')})`)

  assertInvariants('بعد عمل الحارس', c)
  R.ok('الثوابت العشرة سليمة بعد الرفض والقبول')
}

// السنة تُقفل بعد الترحيل: القيود القديمة تبقى، والجديد يُمنع
{
  const c = await freshCase({ activityId: 'general' })
  c.st().postVoucher({ kind: 'payment', treasury: '1101', counterAccountCode: '5108', amountMinor: 2000, description: 'مصروف 2026', date: '2026-06-01' })
  const before = c.st().journal.length
  useAppStore.setState({ fiscalYears: [{ id: 1, nameAr: 'سنة 2026', startDate: '2026-01-01', endDate: '2026-12-31', status: 'closed' }] })
  expectReject('ترحيل بعد إقفال السنة', c, () => c.st().postVoucher({
    kind: 'payment', treasury: '1101', counterAccountCode: '5108', amountMinor: 3000, description: 'مصروف متأخر', date: '2026-08-01',
  }), /مقفلة/)
  if (c.st().journal.length !== before) { console.error('❌ القيود القديمة تأثرت'); process.exit(1) }
  R.ok('إقفال السنة يمنع الجديد ولا يمس القديم')
  useAppStore.setState({ fiscalYears: [{ id: 1, nameAr: 'سنة 2026', startDate: '2026-01-01', endDate: '2026-12-31', status: 'open' }] })
}

R.done('· الحارس المركزي يغطي ث1 وث2 وث3 وث4 وث9 على كل المسارات')
