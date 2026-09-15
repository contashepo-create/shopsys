/**
 * فحص جولة مراجعة نشاط معمل التحاليل (الطلبات 6–9 — الجولة 12):
 * السجل التراكمي للنتائج + Delta Check (كما بأنظمة LIS العالمية):
 * ① patientResultHistory: نتائج المريض السابقة لنفس الفحص، الأحدث أولاً، resulted/approved فقط
 * ② resultDeltaPercent: نسبة التغير عن السابقة — null للنصوص/الصفر
 * تشغيل: node --experimental-strip-types scripts/verify_lab_review.mjs
 */
const { patientResultHistory, resultDeltaPercent } = await import('../src/core/lab.ts')

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra) : ''}`) } }

const T = (testId, status, resultValue, flag = 'none') => ({ testId, status, resultValue, resultFlag: flag, refLow: 70, refHigh: 110 })
const orders = [
  { orderNumber: 'LAB-0001', date: '2026-01-05T08:00:00Z', patientId: 1, tests: [T(10, 'approved', '95', 'normal'), T(20, 'approved', '5.1')] },
  { orderNumber: 'LAB-0002', date: '2026-03-10T08:00:00Z', patientId: 1, tests: [T(10, 'approved', '128', 'high')] },
  { orderNumber: 'LAB-0003', date: '2026-05-01T08:00:00Z', patientId: 2, tests: [T(10, 'approved', '80', 'normal')] },
  { orderNumber: 'LAB-0004', date: '2026-06-01T08:00:00Z', patientId: 1, tests: [T(10, 'collected', '')] },
  { orderNumber: 'LAB-0005', date: '2026-07-01T08:00:00Z', patientId: 1, tests: [T(10, 'resulted', '102', 'normal')] },
]

console.log('\n1️⃣ السجل التراكمي')
const hist = patientResultHistory(orders, 1, 10)
ok('ثلاث نتائج فقط (المسحوبة بلا نتيجة تُستبعد)', hist.length === 3)
ok('الأحدث أولاً', hist[0].orderNumber === 'LAB-0005' && hist[2].orderNumber === 'LAB-0001')
ok('مريض آخر لا يتسرب', hist.every((h) => h.orderNumber !== 'LAB-0003'))
ok('فحص آخر لا يتسرب', patientResultHistory(orders, 1, 20).length === 1)
ok('العلم والنطاق محفوظان لقطة', hist[1].resultFlag === 'high' && hist[1].refHigh === 110)
ok('مريض بلا سوابق = فارغ', patientResultHistory(orders, 99, 10).length === 0)

console.log('\n2️⃣ Delta Check')
ok('من 100 إلى 128 = ‎+28%', resultDeltaPercent('128', '100') === 28)
ok('من 100 إلى 80 = ‎−20%', resultDeltaPercent('80', '100') === -20)
ok('تقريب لعشر واحد: 95→102 = ‎+7.4%', resultDeltaPercent('102', '95') === 7.4)
ok('نتيجة نصية = null', resultDeltaPercent('إيجابي', '100') === null)
ok('سابقة صفر = null', resultDeltaPercent('50', '0') === null)
ok('سابقة سالبة: من −100 إلى −50 = ‎+50% (ارتفاع)', resultDeltaPercent('-50', '-100') === 50)

console.log(`\n${'─'.repeat(40)}\n✅ ${pass} ناجح — ❌ ${fail} فاشل`)
if (fail > 0) process.exit(1)
