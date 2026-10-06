/**
 * فحص فاتورة إيجار المعدات للعميل (طلب المالك: «كيف أصدر فاتورة لمستأجر
 * المعدات كي يسدد إيجاره؟») — الدالة النقية rentalInvoiceDoc:
 * سطور الفاتورة وإجمالياتها ومتبقي العميل عبر كل أنماط السداد، بما فيها
 * تجاوز الاستخدام عند الإقفال (عدّاد ساعي أو مدة إرجاع متأخرة).
 *
 * التشغيل: node --experimental-strip-types scripts/verify_rental_invoice.mjs
 */
import assert from 'node:assert/strict'
import { computeRentalTotals, rentalInvoiceDoc } from '../src/core/rental.ts'

let pass = 0
const ok = (name) => { pass++; console.log('  ✓', name) }

const baseInput = { equipmentName: 'لودر كاتربلر 950', days: 10, dailyRateMinor: 350000, depositMinor: 50000, payment: 'cash', paidMinor: undefined, vatPercent: 14 }

/* ═══ ① عقد نقدي بلا ضريبة: مسدد بالكامل لحظة الفتح ═══ */
{
  const input = { ...baseInput, vatPercent: 0 }
  const totals = computeRentalTotals(input)
  const doc = rentalInvoiceDoc({ equipmentName: baseInput.equipmentName, contractNumber: 'RC-0001', days: 10, dailyRateMinor: 350000, rateType: 'daily', payment: 'cash', vatPercent: 0, totals, extraMinor: 0 })
  assert.equal(doc.rows.length, 1, 'سطر واحد: إيجار المدة')
  assert.ok(doc.rows[0].nameAr.includes('لودر') && doc.rows[0].nameAr.includes('10 يوم'), 'السطر يسمي المعدة والمدة')
  assert.equal(doc.rows[0].totalMinor, 3500000, 'إجمالي السطر = 10 × 3500')
  assert.equal(doc.totalMinor, 3500000, 'الإجمالي بلا ضريبة')
  assert.equal(doc.dueMinor, 0, 'نقدي ⇒ لا متبقي')
  assert.equal(doc.paidMinor, 3500000, 'المدفوع = الإجمالي')
  assert.equal(doc.depositMinor, 50000, 'التأمين المحتجز يظهر كالتزام مستقل')
  ok('نقدي: فاتورة مسددة بالكامل لحظة الفتح — سطر واحد بلا متبقٍ')
}

/* ═══ ② عقد آجل كامل بضريبة: كل الاستحقاق على ذمة العميل ═══ */
{
  const input = { ...baseInput, payment: 'credit', paidMinor: 0, vatPercent: 14 }
  const totals = computeRentalTotals(input)
  const doc = rentalInvoiceDoc({ equipmentName: input.equipmentName, contractNumber: 'RC-0002', days: 10, dailyRateMinor: 350000, rateType: 'daily', payment: 'credit', vatPercent: 14, totals, extraMinor: 0 })
  assert.equal(doc.totalMinor, totals.grandMinor, 'الإجمالي = إيجار + ض.ق.م')
  assert.equal(doc.dueMinor, totals.grandMinor, 'آجل ⇒ المتبقي = الإجمالي كله')
  assert.equal(doc.paidMinor, 0, 'لا مدفوع')
  ok('آجل بضريبة 14٪: المتبقي = الإجمالي — الفاتورة هي وثيقة الاستحقاق التي يسددها منها')
}

/* ═══ ③ عقد مختلط: المتبقي = الجزء المقيد على العميل فقط ═══ */
{
  const input = { ...baseInput, payment: 'mixed', paidMinor: 1500000, vatPercent: 14 }
  const totals = computeRentalTotals(input)
  const doc = rentalInvoiceDoc({ equipmentName: input.equipmentName, contractNumber: 'RC-0003', days: 10, dailyRateMinor: 350000, rateType: 'daily', payment: 'mixed', vatPercent: 14, totals, extraMinor: 0 })
  assert.equal(doc.dueMinor, totals.collectCreditMinor, 'مختلط ⇒ المتبقي = آجل الفتح')
  assert.equal(doc.paidMinor, totals.grandMinor - totals.collectCreditMinor, 'المدفوع = المحصل نقداً/ماكينة')
  assert.equal(doc.totalMinor - doc.dueMinor - doc.paidMinor, 0, 'المعادلة مغلقة: إجمالي = مدفوع + متبقٍ')
  ok('مختلط: المعادلة مغلقة — المتبقي جزء الفتح الآجل فقط')
}

/* ═══ ④ عقد ساعي مقفل بتجاوز عدّاد (آجل): التجاوز وضريبته على الذمة ═══ */
{
  const input = { ...baseInput, payment: 'credit', paidMinor: 0, vatPercent: 14 }
  const totals = computeRentalTotals(input)
  const extraMinor = 87000 // تجاوز ساعات عدّاد عند الإقفال
  const doc = rentalInvoiceDoc({ equipmentName: input.equipmentName, contractNumber: 'RC-0004', days: 8, dailyRateMinor: 50000, rateType: 'hourly', payment: 'credit', vatPercent: 14, totals, extraMinor })
  assert.equal(doc.rows.length, 2, 'سطران: الإيجار + التجاوز')
  assert.ok(doc.rows[0].nameAr.includes('ساعة'), 'العقد الساعي يسمي الوحدة «ساعة»')
  assert.ok(doc.rows[1].nameAr.includes('قراءة عدّاد'), 'سطر التجاوز يبين مصدره (عدّاد)')
  const extraVat = Math.round((extraMinor * 14) / 100)
  assert.equal(doc.totalMinor, totals.grandMinor + extraMinor + extraVat, 'الإجمالي يشمل التجاوز وضريبته')
  assert.equal(doc.dueMinor, totals.collectCreditMinor + extraMinor + extraVat, 'آجل ⇒ التجاوز وضريبته يضافان للذمة (نفس buildExtraUsageEntry)')
  ok('ساعي بتجاوز عدّاد: سطر التجاوز وضريبته يدخلان الاستحقاق والذمة معاً')
}

/* ═══ ⑤ عقد نقدي بتجاوز: التجاوز مقبوض من الخزينة — لا يدخل المتبقي ═══ */
{
  const input = { ...baseInput, payment: 'cash', paidMinor: undefined, vatPercent: 14 }
  const totals = computeRentalTotals(input)
  const extraMinor = 120000
  const doc = rentalInvoiceDoc({ equipmentName: input.equipmentName, contractNumber: 'RC-0005', days: 5, dailyRateMinor: 350000, rateType: 'daily', payment: 'cash', vatPercent: 14, totals, extraMinor })
  const extraVat = Math.round((extraMinor * 14) / 100)
  assert.equal(doc.totalMinor, totals.grandMinor + extraMinor + extraVat, 'الإجمالي يشمل التجاوز')
  assert.equal(doc.dueMinor, 0, 'نقدي ⇒ حتى التجاوز مقبوض، لا متبقي')
  assert.equal(doc.paidMinor, doc.totalMinor, 'المدفوع = الإجمالي كله')
  ok('نقدي بتجاوز: التجاوز مقبوض لحظة الإقفال — الفاتورة تبقى مسددة بالكامل')
}

/* ═══ ⑥ عقد شهري + التأمين لا يدخل الاستحقاق أبداً ═══ */
{
  const input = { equipmentName: 'كراك بنزين 25 طن', days: 3, dailyRateMinor: 2500000, depositMinor: 300000, payment: 'mixed', paidMinor: 2000000, vatPercent: 0 }
  const totals = computeRentalTotals(input)
  const doc = rentalInvoiceDoc({ equipmentName: input.equipmentName, contractNumber: 'RC-0006', days: 3, dailyRateMinor: 2500000, rateType: 'monthly', payment: 'mixed', vatPercent: 0, totals, extraMinor: 0 })
  assert.ok(doc.rows[0].nameAr.includes('3 شهر'), 'العقد الشهري يسمي الوحدة «شهر»')
  assert.equal(doc.depositMinor, 300000, 'التأمين معروض للتذييل')
  assert.ok(!doc.rows.some((r) => r.nameAr.includes('تأمين')), 'لا سطر تأمين بين بنود الاستحقاق')
  assert.equal(doc.totalMinor, totals.grandMinor, 'الإجمالي لا يشمل التأمين')
  ok('شهري: التأمين المحتجز (2103) التزام مستقل — يظهر في التذييل ولا يلوث استحقاق الفاتورة')
}

console.log(`\n✅ فاتورة إيجار المعدات للعميل: ${pass} فحوصاً ناجحة`)
