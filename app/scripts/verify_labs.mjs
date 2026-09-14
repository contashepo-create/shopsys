/**
 * فحص وحدة معامل التحاليل (القرار 26)
 * node --experimental-strip-types scripts/verify_labs.mjs
 */
import {
  validateLabTest, matchRefRange, evaluateResult, ageYears,
  canTransition, deriveOrderStatus, computeLabTotals,
  buildLabOrderEntry, commissionFor, buildCommissionAccrualEntry,
  buildCommissionPayoutEntry, validateReferrer, referrerStatement, STARTER_TESTS,
} from '../src/core/lab.ts'
import { STANDARD_COA } from '../src/core/ledger.ts'

let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) { pass++ } else { fail++; console.error(`❌ ${name}`) } }
const throws = (fn, name) => { try { fn(); fail++; console.error(`❌ لم يرمِ: ${name}`) } catch { pass++ } }

/* ─── شجرة الحسابات: حسابات المعمل موجودة ─── */
const codes = new Set(STANDARD_COA.map((a) => a.code))
ok(codes.has('4106'), 'حساب 4106 إيرادات تحاليل موجود')
ok(codes.has('5109'), 'حساب 5109 عمولات محيلين موجود')
ok(codes.has('2105'), 'حساب 2105 عمولات مستحقة موجود')
ok(STANDARD_COA.find((a) => a.code === '4106').rootType === 'revenue', '4106 إيراد')
ok(STANDARD_COA.find((a) => a.code === '5109').rootType === 'expenses', '5109 مصروف')
ok(STANDARD_COA.find((a) => a.code === '2105').rootType === 'liabilities', '2105 التزام')

/* ─── كتالوج الفحوصات ─── */
const goodTest = { code: 'FBS', nameAr: 'سكر صائم', category: 'كيمياء', sampleType: 'دم', unit: 'mg/dL', priceMinor: 10000, costMinor: 1000, refRanges: [{ gender: 'any', ageMinYears: 0, ageMaxYears: 999, low: 70, high: 100 }] }
ok(validateLabTest(goodTest, []).length === 0, 'فحص سليم يمر')
ok(validateLabTest({ ...goodTest, nameAr: '' }, []).length > 0, 'اسم فارغ يُرفض')
ok(validateLabTest({ ...goodTest, priceMinor: 0 }, []).length > 0, 'سعر صفري يُرفض')
ok(validateLabTest({ ...goodTest, priceMinor: 100.5 }, []).length > 0, 'سعر غير صحيح يُرفض')
const existing = [{ ...goodTest, id: 1, isActive: true }]
ok(validateLabTest({ ...goodTest, code: 'fbs' }, existing).length > 0, 'تكرار كود (بأي حالة) يُرفض')
ok(validateLabTest({ ...goodTest, code: 'fbs' }, existing, 1).length === 0, 'تعديل الفحص نفسه لا يعد تكراراً')
ok(validateLabTest({ ...goodTest, refRanges: [{ gender: 'any', ageMinYears: 0, ageMaxYears: 999, low: 100, high: 70 }] }, []).length > 0, 'نطاق مقلوب يُرفض')
ok(validateLabTest({ ...goodTest, refRanges: [{ gender: 'any', ageMinYears: 5, ageMaxYears: 2, low: 1, high: 2 }] }, []).length > 0, 'مدى عمري مقلوب يُرفض')
ok(validateLabTest({ ...goodTest, refRanges: [{ gender: 'any', ageMinYears: 0, ageMaxYears: 999, low: null, high: null }] }, []).length > 0, 'نطاق بلا حدود يُرفض')

/* ─── مطابقة النطاق حسب الجنس والعمر ─── */
const crea = { refRanges: [
  { gender: 'male', ageMinYears: 18, ageMaxYears: 999, low: 0.7, high: 1.3 },
  { gender: 'female', ageMinYears: 18, ageMaxYears: 999, low: 0.6, high: 1.1 },
  { gender: 'any', ageMinYears: 0, ageMaxYears: 17, low: 0.3, high: 0.7 },
] }
ok(matchRefRange(crea, 'male', 30)?.high === 1.3, 'ذكر بالغ ← نطاق الذكور')
ok(matchRefRange(crea, 'female', 30)?.high === 1.1, 'أنثى بالغة ← نطاق الإناث')
ok(matchRefRange(crea, 'male', 10)?.high === 0.7, 'طفل ← نطاق الأطفال any')
ok(matchRefRange({ refRanges: [] }, 'male', 30) === null, 'بلا نطاقات ← null')
// جنس مطابق يتقدم على any في نفس المدى
const pref = { refRanges: [
  { gender: 'any', ageMinYears: 0, ageMaxYears: 999, low: 1, high: 2 },
  { gender: 'female', ageMinYears: 0, ageMaxYears: 999, low: 3, high: 4 },
] }
ok(matchRefRange(pref, 'female', 25)?.low === 3, 'نطاق الجنس المطابق يتقدم على any')

/* ─── تقييم النتائج (مع أرقام عربية — درس فاتورة الكاشير) ─── */
const range = { gender: 'any', ageMinYears: 0, ageMaxYears: 999, low: 70, high: 100 }
ok(evaluateResult('85', range) === 'normal', '85 طبيعي')
ok(evaluateResult('120', range) === 'high', '120 مرتفع')
ok(evaluateResult('60', range) === 'low', '60 منخفض')
ok(evaluateResult('١٢٠', range) === 'high', 'أرقام عربية ١٢٠ ← مرتفع')
ok(evaluateResult('٨٥٫٥', range) === 'normal', '٨٥٫٥ بفاصلة عربية ← طبيعي')
ok(evaluateResult('إيجابي', range) === 'none', 'نتيجة وصفية ← none')
ok(evaluateResult('85', null) === 'none', 'بلا نطاق ← none')
ok(evaluateResult('105', { ...range, high: null }) === 'normal', 'نطاق مفتوح الأعلى')
ok(evaluateResult('50', { ...range, low: null, high: 100 }) === 'normal', 'نطاق مفتوح الأدنى')

/* ─── العمر ─── */
ok(ageYears('1990-06-15', '2026-09-14') === 36, 'عمر بعد عيد الميلاد')
ok(ageYears('1990-12-15', '2026-09-14') === 35, 'عمر قبل عيد الميلاد')
ok(ageYears('2026-01-01', '2026-09-14') === 0, 'رضيع = 0')

/* ─── دورة العينة ─── */
ok(canTransition('pending', 'collected'), 'تسجيل ← سحب')
ok(canTransition('collected', 'resulted'), 'سحب ← نتيجة')
ok(canTransition('resulted', 'approved'), 'نتيجة ← اعتماد')
ok(!canTransition('pending', 'resulted'), 'لا قفز فوق سحب العينة')
ok(!canTransition('pending', 'approved'), 'لا اعتماد بلا نتيجة')
ok(!canTransition('approved', 'resulted'), 'لا رجوع بعد الاعتماد')
ok(deriveOrderStatus(['pending', 'pending']) === 'registered', 'كله pending = مسجل')
ok(deriveOrderStatus(['collected', 'pending']) === 'in_progress', 'بدأ العمل = جارٍ')
ok(deriveOrderStatus(['resulted', 'resulted']) === 'ready', 'كل النتائج = جاهز')
ok(deriveOrderStatus(['resulted', 'approved']) === 'ready', 'خليط نتيجة/اعتماد = جاهز')
ok(deriveOrderStatus(['approved', 'approved']) === 'approved', 'كله معتمد = معتمد')
ok(deriveOrderStatus([]) === 'registered', 'طلب فارغ = مسجل')

/* ─── الإجماليات ─── */
const t1 = computeLabTotals([10000, 20000], 10, 14)
ok(t1.grossMinor === 30000, 'إجمالي الفحوصات 300')
ok(t1.discountMinor === 3000, 'خصم 10٪ = 30')
ok(t1.netMinor === 27000, 'صافي 270')
ok(t1.vatMinor === 3780, 'ضريبة 14٪ من الصافي = 37.80')
ok(t1.totalMinor === 30780, 'الإجمالي النهائي 307.80')
const t0 = computeLabTotals([5000], 0, 0)
ok(t0.totalMinor === 5000 && t0.vatMinor === 0, 'بلا خصم ولا ضريبة (تحاليل معفاة)')
throws(() => computeLabTotals([0], 0, 0), 'سعر صفري يرمي')
throws(() => computeLabTotals([100.5], 0, 0), 'سعر كسري يرمي')
throws(() => computeLabTotals([100], 150, 0), 'خصم فوق 100 يرمي')

/* ─── قيد الطلب ─── */
const eCash = buildLabOrderEntry(t1, 'cash', 'LAB-0001')
ok(eCash[0].accountCode === '1101' && eCash[0].debit === 30780, 'نقدي: خزينة مدينة بالإجمالي')
ok(eCash.find((l) => l.accountCode === '4106')?.credit === 27000, 'إيراد التحاليل بالصافي')
ok(eCash.find((l) => l.accountCode === '2102')?.credit === 3780, 'الضريبة دائنة')
const eCredit = buildLabOrderEntry(t0, 'credit', 'LAB-0002')
ok(eCredit[0].accountCode === '1104', 'آجل/شركة: عملاء مدينون')
ok(eCredit.length === 2, 'بلا ضريبة ← لا سطر 2102')
throws(() => buildLabOrderEntry({ ...t0, netMinor: 0, totalMinor: 0 }, 'cash', 'X'), 'طلب صفري يرمي')

/* ─── العمولات ─── */
ok(validateReferrer({ nameAr: 'أحمد', phone: '', commissionPercent: 10, notes: '' }).length === 0, 'طبيب سليم')
ok(validateReferrer({ nameAr: '', phone: '', commissionPercent: 10, notes: '' }).length > 0, 'اسم فارغ يُرفض')
ok(validateReferrer({ nameAr: 'x', phone: '', commissionPercent: 60, notes: '' }).length > 0, 'عمولة 60٪ تُرفض')
ok(commissionFor(27000, 10) === 2700, 'عمولة 10٪ من الصافي')
ok(commissionFor(27000, 0) === 0, 'صفر ٪ = صفر')
ok(commissionFor(9999, 10) === 1000, 'تقريب لأقرب وحدة')
const acc = buildCommissionAccrualEntry(2700, 'LAB-0001')
ok(acc[0].accountCode === '5109' && acc[0].debit === 2700, 'استحقاق: مصروف مدين')
ok(acc[1].accountCode === '2105' && acc[1].credit === 2700, 'استحقاق: مستحقات دائنة')
throws(() => buildCommissionAccrualEntry(0, 'X'), 'استحقاق صفري يرمي')
const pay = buildCommissionPayoutEntry(5400, 'أحمد')
ok(pay[0].accountCode === '2105' && pay[0].debit === 5400, 'صرف: تصفية المستحقات')
ok(pay[1].accountCode === '1101' && pay[1].credit === 5400, 'صرف: نقدي دائن')
throws(() => buildCommissionPayoutEntry(0, 'X'), 'صرف صفري يرمي')

/* ─── كشف الطبيب ─── */
const orders = [
  { id: 1, orderNumber: 'LAB-0001', date: '2026-09-05T10:00:00Z', patientName: 'سعاد', referrerId: 1, totals: t1, commissionMinor: 2700, commissionPaid: false },
  { id: 2, orderNumber: 'LAB-0002', date: '2026-09-02T10:00:00Z', patientName: 'كريم', referrerId: 1, totals: t0, commissionMinor: 500, commissionPaid: true },
  { id: 3, orderNumber: 'LAB-0003', date: '2026-08-20T10:00:00Z', patientName: 'منى', referrerId: 1, totals: t0, commissionMinor: 500, commissionPaid: false },
  { id: 4, orderNumber: 'LAB-0004', date: '2026-09-07T10:00:00Z', patientName: 'هدى', referrerId: 2, totals: t0, commissionMinor: 500, commissionPaid: false },
]
const st = referrerStatement(orders, 1, { from: '2026-09-01', to: '2026-09-30' })
ok(st.rows.length === 2, 'كشف سبتمبر: طلبان للطبيب 1 فقط')
ok(st.rows[0].orderNumber === 'LAB-0002', 'مرتب تصاعدياً بالتاريخ')
ok(st.totalCommissionMinor === 3200, 'إجمالي عمولات الشهر')
ok(st.unpaidCommissionMinor === 2700, 'غير المدفوع فقط')
ok(st.totalNetMinor === 27000 + 5000, 'صافي الإحالات')

/* ─── كتالوج البدء ─── */
ok(STARTER_TESTS.length === 10, 'كتالوج البدء 10 فحوصات')
ok(new Set(STARTER_TESTS.map((t) => t.code)).size === 10, 'أكواد فريدة')
ok(STARTER_TESTS.some((t) => t.refRanges.some((r) => r.gender === 'male')), 'فيه نطاقات مفصلة بالجنس')

console.log(`PASS=${pass} FAIL=${fail}`)
if (fail > 0) process.exit(1)
console.log(`🎉 نجح فحص معامل التحاليل — ${pass} اختباراً`)
