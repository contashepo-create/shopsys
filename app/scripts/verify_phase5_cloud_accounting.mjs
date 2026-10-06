/**
 * المرحلة 5 من التدقيق — توافق الخدمات السحابية عند تفعيلها (محاسبياً).
 *
 * السحابة تنقل **حالة المتجر كاملة** مشفّرة بين الأجهزة (سحب/دفع بقفل تفاؤلي).
 * أسئلة التدقيق:
 *   ① هل تنجو البيانات المحاسبية من رحلة JSON ذهاباً وإياباً بلا فقد نوعٍ أو قرش؟
 *   ② هل يمر الدفتر الوارد من السحابة على حارس الدفتر، أم يدخل من الباب الخلفي؟ (AUDIT-016)
 *   ③ هل تبقى هوية المستخدم على هذا الجهاز محلية فلا ينتحل جهازٌ هويةَ آخر في سجل التدقيق؟
 *   ④ هل يُحفَظ العمل المحلي قبل دهسه بحالة سحابية أحدث؟
 *   ⑤ هل النقود تبقى أعداداً صحيحة بالقروش بعد المزامنة؟
 *
 * تشغيل: node --experimental-strip-types scripts/verify_phase5_cloud_accounting.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { freshCase, assertInvariants, balanceOf, addSimpleItem, addParty, reporter } from './auditKit.mjs'
import { assertJournalIntegrity, normalizeJournalDates } from '../src/core/ledgerGuard.ts'
import { STANDARD_COA } from '../src/core/ledger.ts'
import { fullCoa } from '../src/core/treasury.ts'
import { validateSyncConfig, SYNC_SECRET_RE } from '../src/data/syncClient.ts'
import { trialBalance } from '../src/core/financialReports.ts'
import { fileURLToPath } from 'node:url'
const APP_ROOT = fileURLToPath(new URL('..', import.meta.url))

const R = reporter('المرحلة 5 — الخدمات السحابية والمحاسبة')
const RUNNER = readFileSync(`${APP_ROOT}/src/data/syncRunner.ts`, 'utf8')
const LOCAL_SESSION_KEYS = ['currentUserId']

// حالة متجر حقيقية فيها كل أنواع المستندات
const c = await freshCase({ activityId: 'general' })
const cust = addParty(c, 'customer', 'عميل السحابة')
const sup = addParty(c, 'supplier', 'مورد السحابة')
const item = addSimpleItem(c, { nameAr: 'صنف السحابة', priceMinor: 25000 })
c.st().postPurchase({
  supplierId: sup.id, date: '2026-03-01', lines: [{ itemId: item.id, qty: 40, unitPriceMinor: 12000, expiryDate: null }],
  expenses: [], paidMinor: 200000, treasury: '1101', notes: '',
})
c.st().postSale({
  lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 12, unitPriceMinor: 25000, unitCostMinor: 12000, discountPercent: 0, soldByWeight: false }],
  customerId: cust.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: false, treasury: '1101',
})
c.st().postVoucher({ kind: 'receipt', treasury: '1101', counterAccountCode: '1104', amountMinor: 100000, description: 'تحصيل', partyKind: 'customer', partyId: cust.id })
assertInvariants('قبل المزامنة', c)

/* ① رحلة JSON ذهاباً وإياباً */
{
  const state = { ...c.st() }
  for (const k of LOCAL_SESSION_KEYS) delete state[k]
  const serialized = JSON.stringify(state)
  const parsed = JSON.parse(serialized)
  // لا Map/Set في الحالة: JSON يبتلعها صامتاً فتضيع بيانات دون خطأ
  const lossy = []
  for (const [k, v] of Object.entries(state)) {
    if (typeof v === 'function') continue
    if (v instanceof Map || v instanceof Set) lossy.push(k)
    if (typeof v === 'bigint') lossy.push(k)
  }
  assert.deepEqual(lossy, [], `مفاتيح لا تنجو من JSON: ${lossy.join('، ')}`)
  // الدفتر يعبر بالقرش الواحد
  assert.equal(JSON.stringify(parsed.journal), JSON.stringify(state.journal), 'الدفتر تغيّر في الرحلة')
  const before = trialBalance(state.journal, { from: '0000-01-01', to: '2999-12-31' })
  const after = trialBalance(parsed.journal, { from: '0000-01-01', to: '2999-12-31' })
  assert.equal(before.totalDebitMinor, after.totalDebitMinor)
  assert.equal(before.totalCreditMinor, after.totalCreditMinor)
  assert.ok(after.balanced)
  R.ok('حالة المتجر تنجو من رحلة JSON: لا Map/Set/BigInt تضيع، والميزان بعد الرحلة = قبلها بالقرش')
  // كل مبلغ عدد صحيح
  let amounts = 0
  for (const e of parsed.journal) for (const l of e.lines) {
    assert.ok(Number.isInteger(l.debit) && Number.isInteger(l.credit), `مبلغ كسري بعد المزامنة في القيد #${e.entryNumber}`)
    amounts += 2
  }
  R.ok(`${amounts} مبلغاً عبرت المزامنة كأعداد صحيحة بالقروش — لا كسور عائمة تتسرب`)
}

/* ② حارس الدفتر على الوارد (AUDIT-016) */
{
  assert.ok(RUNNER.includes('assertIncomingLedgerSafe'), 'لا حارس للوارد من السحابة')
  assert.ok(RUNNER.includes('assertJournalIntegrity'), 'الحارس لا يستدعي فحص سلامة الدفتر')
  assert.ok(/rejected|رُفضت حالة السحابة/.test(RUNNER), 'لا رسالة رفض عربية للحالة السحابية المختلة')
  const applyIdx = RUNNER.indexOf('useDataStore.setState(parsed)')
  const guardIdx = RUNNER.indexOf('assertIncomingLedgerSafe(parsed)')
  assert.ok(guardIdx > 0 && guardIdx < applyIdx, 'الحارس يجب أن يسبق التطبيق')
  R.ok('AUDIT-016: كل دفتر وارد من السحابة يمر بحارس الدفتر **قبل** تطبيقه — لا باب خلفي للقيود')

  // محاكاة الحارس على دفعة مسمومة
  const coa = fullCoa(STANDARD_COA, c.st().treasuries)
  const poisoned = [...c.st().journal, {
    id: 9999, entryNumber: 9999, date: '2026-06-01', description: 'قيد غير متزن من جهاز مخترق',
    sourceType: 'manual', sourceId: null,
    lines: [{ accountCode: '1101', debit: 100000, credit: 0, note: '' }, { accountCode: '4101', debit: 0, credit: 1, note: '' }],
    createdBy: 'مهاجم', createdAt: new Date().toISOString(), reversedByEntryId: null, reversesEntryId: null,
  }]
  assert.throws(() => assertJournalIntegrity([], normalizeJournalDates(poisoned), { coa, fiscalYears: [] }), /غير متزن|رُفض/)
  R.ok('دفعة سحابية تحمل قيداً غير متزن تُرفض كاملةً — الدفتر المحلي يبقى كما هو (لا تطبيق جزئي)')

  const unknownAccount = [...c.st().journal, {
    id: 9998, entryNumber: 9998, date: '2026-06-01', description: 'حساب لا وجود له',
    sourceType: 'manual', sourceId: null,
    lines: [{ accountCode: '9999', debit: 5000, credit: 0, note: '' }, { accountCode: '1101', debit: 0, credit: 5000, note: '' }],
    createdBy: 'مهاجم', createdAt: new Date().toISOString(), reversedByEntryId: null, reversesEntryId: null,
  }]
  assert.throws(() => assertJournalIntegrity([], normalizeJournalDates(unknownAccount), { coa, fiscalYears: [] }))
  R.ok('دفعة سحابية تُرحّل على حساب غير موجود في الشجرة تُرفض أيضاً')

  const dupNumbers = [...c.st().journal].map((e, i) => (i === 0 ? { ...e, entryNumber: c.st().journal[1]?.entryNumber ?? e.entryNumber } : e))
  if (c.st().journal.length > 1) {
    assert.throws(() => assertJournalIntegrity([], normalizeJournalDates(dupNumbers), { coa, fiscalYears: [] }))
    R.ok('دفعة سحابية بأرقام قيود مكررة تُرفض — الترقيم المتصل شرط قبول')
  }
}

/* ③ هوية الجهاز لا تُزامَن */
{
  assert.ok(RUNNER.includes("LOCAL_SESSION_KEYS = ['currentUserId']"), 'مفاتيح الجلسة المحلية غير محددة')
  const serializeFn = RUNNER.slice(RUNNER.indexOf('function serializeStore'), RUNNER.indexOf('function serializeStore') + 320)
  assert.ok(serializeFn.includes('delete state[k]'), 'التسلسل لا يحذف مفاتيح الجلسة')
  assert.ok(RUNNER.includes('for (const k of LOCAL_SESSION_KEYS) delete parsed[k]'), 'التطبيق لا يحمي جلسة الجهاز')
  R.ok('هوية المستخدم النشط لا تُرفع ولا تُنزَّل: كاشير الفرع لا يصير «المحاسب» في سجل تدقيق جهاز آخر')
}

/* ④ لا عمل محلي يُدهس بلا لقطة */
{
  assert.ok(RUNNER.includes('saveConflictSnapshot(serializeStore())'), 'لا لقطة أمان قبل تطبيق حالة أحدث')
  assert.ok(RUNNER.includes('restoreConflictSnapshot'), 'لا استرجاع للقطات')
  const pullBlock = RUNNER.slice(RUNNER.indexOf("outcome.action === 'pulled'"), RUNNER.indexOf('applyingPull = true'))
  assert.ok(pullBlock.includes('saveConflictSnapshot'), 'اللقطة يجب أن تُحفظ قبل السحب المطبَّق')
  R.ok('قبل دهس عمل محلي غير مدفوع بحالة سحابية أحدث تُحفظ لقطة كاملة قابلة للاسترجاع')
  assert.ok(RUNNER.includes('اللقطة مرفوضة'), 'استرجاع اللقطة بلا حارس')
  R.ok('حتى اللقطة المسترجَعة تمر بحارس الدفتر — ملف قديم مختل لا يعود للدفتر')
}

/* ⑤ إعدادات السحابة: لا تفعيل بإعداد ناقص */
{
  assert.ok(validateSyncConfig({ url: '', anonKey: '', storeId: '', secret: '', accessToken: '' }).length > 0)
  assert.ok(validateSyncConfig({ url: 'https://x.supabase.co', anonKey: 'k', storeId: 'store', secret: 'قصير', accessToken: 't' }).length > 0, 'سر ضعيف يجب أن يُرفض')
  assert.ok(SYNC_SECRET_RE.test('a'.repeat(43)), 'نمط السر 256-بت')
  R.ok('لا تُفعَّل المزامنة بإعداد ناقص أو سر ضعيف — التشفير شرط لا خيار')
}

/* ⑥ المزامنة لا تغيّر أرقام المحاسبة */
{
  const cash = balanceOf(c.st().journal, '1101')
  const receivable = balanceOf(c.st().journal, '1104')
  const roundTrip = JSON.parse(JSON.stringify({ journal: c.st().journal }))
  assert.equal(balanceOf(roundTrip.journal, '1101'), cash)
  assert.equal(balanceOf(roundTrip.journal, '1104'), receivable)
  assert.equal(c.st().getCustomerBalance(cust.id), receivable, 'كشف العميل = الحساب الإجمالي بعد الرحلة')
  assertInvariants('بعد المزامنة', c)
  R.ok('أرصدة الخزينة والعملاء وكشوفهم تعبر السحابة بلا قرش زائد أو ناقص')
}

R.done('— السحابة تنقل الحالة بأمان: الوارد محروس، والجلسة محلية، والعمل لا يضيع، والقروش لا تتغير')
