/**
 * 🔬 رحلة معمل تحاليل + مغسلة (فحص فردي لنشاطين):
 * ج1 المعمل: كتالوج فحوصات → مريض → طلب بمُحيل (عمولة 2105 مستحقة فوراً)
 *   → دورة العينة الصارمة (سحب→نتيجة→اعتماد، القفز مرفوض) → لقطة أسعار
 *   لا تتأثر بتغيير الكتالوج لاحقاً → صرف عمولات المُحيل بقيد واحد.
 * ج2 المغسلة: أمر بعربون 2109 → رف/شماعة → دورة الحالة → تسليم يصفي العربون
 *   → إلغاء يرد العربون → استرداد خدمة بعد التسليم بسقف تراكمي → ميزان متزن.
 *
 * تشغيل: node --experimental-strip-types scripts/user_journey_lab_and_laundry.mjs
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
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false, done: true, countryCode: 'EG', activityId: 'medical_lab', vatPercent: 0, taxInclusive: true, allowNegativeTreasury: true }, license: { plan: 'pro' } }, version: 0 }))

const { useDataStore } = await import(join(root, 'src/data/repo.ts'))
const { trialBalance } = await import(join(root, 'src/core/financialReports.ts'))
const st = () => useDataStore.getState()
let pass = 0
const ok = (n) => { pass++; console.log('  ✓', n) }
const acctBal = (code) => st().journal.flatMap((e) => e.lines).filter((l) => l.accountCode === code).reduce((s, l) => s + l.debit - l.credit, 0)

console.log('\n═══ 1) كتالوج فحوصات + مريض + مُحيل بعمولة 10% ═══')
{
  st().addLabTest({ code: 'CBC', nameAr: 'صورة دم كاملة', category: 'دم', sampleType: 'دم وريدي', unit: '', priceMinor: 15000, costMinor: 3000, refRanges: [] })
  st().addLabTest({ code: 'FBS', nameAr: 'سكر صائم', category: 'كيمياء', sampleType: 'دم وريدي', unit: 'mg/dL', priceMinor: 8000, costMinor: 1500, refRanges: [] })
  st().addLabPatient({ nameAr: 'أحمد سمير', phone: '0100', gender: 'male', birthDate: '1985-03-01', notes: '' })
  st().addLabReferrer({ nameAr: 'د. منى (باطنة)', phone: '0111', commissionPercent: 10, notes: '' })
  ok('فحصان (CBC بـ150 وFBS بـ80) + مريض + مُحيلة بعمولة 10%')
}
const [cbc, fbs] = st().labTests
const patient = st().labPatients[0]
const referrer = st().labReferrers[0]

console.log('\n═══ 2) طلب نقدي بالمُحيلة: عمولة 10% مستحقة فوراً (5109/2105) ═══')
{
  const order = st().registerLabOrder({ patientId: patient.id, referrerId: referrer.id, testIds: [cbc.id, fbs.id], payment: 'cash', discountPercent: 0, vatPercent: 0, notes: '', treasury: '1101' })
  assert.equal(order.totals.totalMinor, 23000, 'الإجمالي 230')
  assert.equal(acctBal('4106'), -23000, 'إيراد التحاليل')
  assert.equal(acctBal('2105'), -2300, 'عمولة المُحيلة مستحقة 23')
  assert.equal(acctBal('5109'), 2300, 'مصروف العمولة بنفس اللحظة')
  ok('طلب 230: إيراد 4106 + عمولة محيلة 23 مستحقة (2105) ومصروفة (5109) فوراً')
}
const order = st().labOrders[0]

console.log('\n═══ 3) لقطة الأسعار: رفع سعر الكتالوج لا يغير الطلب المسجل ═══')
{
  st().updateLabTest(cbc.id, { priceMinor: 20000 })
  const snap = st().labOrders[0].tests.find((t) => t.testId === cbc.id)
  assert.equal(snap.priceMinor, 15000, 'الطلب بلقطة سعر وقت التسجيل')
  assert.equal(st().labTests.find((t) => t.id === cbc.id).priceMinor, 20000, 'الكتالوج نفسه تحدث')
  ok('الكتالوج 200 لكن الطلب المسجل ثابت على 150 — لا أثر رجعي')
}

console.log('\n═══ 4) دورة العينة الصارمة: pending→collected→resulted→approved ═══')
{
  // القفز من pending إلى resulted مرفوض
  assert.throws(() => st().advanceLabTest(order.id, cbc.id, 'resulted', '5.1'))
  st().advanceLabTest(order.id, cbc.id, 'collected')
  // نتيجة بلا قيمة مرفوضة
  assert.throws(() => st().advanceLabTest(order.id, cbc.id, 'resulted'))
  st().advanceLabTest(order.id, cbc.id, 'resulted', 'طبيعية — لا أنيميا')
  st().advanceLabTest(order.id, cbc.id, 'approved')
  // التراجع بعد الاعتماد مرفوض
  assert.throws(() => st().advanceLabTest(order.id, cbc.id, 'collected'))
  const t = st().labOrders[0].tests.find((x) => x.testId === cbc.id)
  assert.equal(t.status, 'approved')
  ok('الدورة الصارمة تعمل: قفز/نتيجة فارغة/تراجع بعد الاعتماد — كلها مرفوضة')
}

console.log('\n═══ 5) صرف عمولات المُحيلة بقيد واحد ═══')
{
  // طلب ثانٍ لنفس المُحيلة ليتجمع رصيد
  st().registerLabOrder({ patientId: patient.id, referrerId: referrer.id, testIds: [fbs.id], payment: 'cash', discountPercent: 0, vatPercent: 0, notes: '', treasury: '1101' })
  const r = st().payReferrerCommissions(referrer.id, '1101')
  assert.equal(r.total, 2300 + 800, 'إجمالي عمولتي الطلبين')
  assert.equal(r.orderCount, 2)
  assert.equal(acctBal('2105'), 0, 'صُفيت مستحقات المُحيلة')
  // الصرف الثاني: لا شيء مستحق
  assert.throws(() => st().payReferrerCommissions(referrer.id, '1101'))
  ok(`صُرفت عمولتان (${r.total / 100}ج) بقيد واحد وصُفي 2105 — والصرف الفارغ مرفوض`)
}

console.log('\n═══ 6) المغسلة: أمر بعربون → رف → تسليم يصفي العربون ═══')
{
  const o = st().openLaundryOrder({
    customerId: null, customerName: 'مدام هدى', phone: '0122', promisedAt: '2026-09-22T18:00',
    lines: [
      { desc: 'بدلة رجالي', service: 'dry_clean', qty: 1, unitPriceMinor: 12000 },
      { desc: 'قميص', service: 'wash_iron', qty: 4, unitPriceMinor: 2500 },
    ],
    prepaidMinor: 5000, treasury: '1101', notes: '',
  })
  assert.equal(acctBal('2109'), -5000, 'العربون التزام')
  st().setLaundryRack(o.id, 'R-17')
  st().setLaundryStatus(o.id, 'processing')
  // التسليم قبل الجاهزية مرفوض
  assert.throws(() => st().deliverLaundryOrder({ orderId: o.id, treasury: '1101' }))
  st().setLaundryStatus(o.id, 'ready')
  const cashBefore = acctBal('1101')
  st().deliverLaundryOrder({ orderId: o.id, treasury: '1101' })
  const total = 12000 + 4 * 2500 // 220
  assert.equal(acctBal('1101') - cashBefore, total - 5000, 'حُصل المتبقي 170 فقط')
  assert.equal(acctBal('2109'), 0, 'العربون صُفي')
  ok('أمر 220 بعربون 50: رف R-17، التسليم قبل الجاهزية مرفوض، والمتبقي 170 حُصل')
}

console.log('\n═══ 7) إلغاء أمر بعربون يَرُد العربون + استرداد خدمة بعد التسليم ═══')
{
  const o2 = st().openLaundryOrder({ customerId: null, customerName: 'أستاذ سامي', phone: '', promisedAt: '2026-09-23T12:00', lines: [{ desc: 'سجادة', service: 'carpet', qty: 1, unitPriceMinor: 30000 }], prepaidMinor: 10000, treasury: '1101', notes: '' })
  const cashBefore = acctBal('1101')
  st().cancelLaundryOrder(o2.id)
  assert.equal(acctBal('1101') - cashBefore, -10000, 'رُد العربون 100')
  assert.equal(acctBal('2109'), 0)
  // استرداد جزئي من الأمر المُسلَّم (مدام هدى غير راضية عن قميص = 25)
  const delivered = st().laundryOrders.find((x) => x.status === 'delivered')
  st().refundLaundryOrder({ orderId: delivered.id, amountMinor: 2500, mode: 'cash', reason: 'كيّ غير مرضٍ لقميص', treasury: '1101', approvedBy: 'المشرف' })
  // الاسترداد فوق سقف الأمر مرفوض
  assert.throws(() => st().refundLaundryOrder({ orderId: delivered.id, amountMinor: 22000, mode: 'cash', reason: 'كله', treasury: '1101', approvedBy: 'المشرف' }))
  ok('الإلغاء رد العربون، والاسترداد الجزئي 25 مرّ وسقف الأمر يمنع التجاوز')
}

console.log('\n═══ 8) الميزان الختامي ═══')
{
  const tb = trialBalance(st().journal, { from: '2020-01-01', to: '2030-12-31' })
  assert.equal(tb.totalDebitMinor, tb.totalCreditMinor, 'الميزان متزن')
  for (const e of st().journal) {
    assert.equal(e.lines.reduce((s, l) => s + l.debit, 0), e.lines.reduce((s, l) => s + l.credit, 0), `قيد ${e.id} مختل`)
  }
  ok(`${st().journal.length} قيداً كلها متزنة، الميزان ${tb.totalDebitMinor}`)
}

console.log(`\n✅ رحلة المعمل والمغسلة: ${pass} محطات — كلها خضراء\n`)
