// تحقق الأصول الثابتة والإهلاك (مواصفة Easy Store):
// validateAsset، قيد الاقتناء، جدول القسط الثابت بلا مليم ضائع،
// قيد الإهلاك، تقرير القيمة الدفترية، الشهر التالي
// التشغيل: node --experimental-strip-types scripts/verify_assets.mjs
import {
  validateAsset,
  buildAssetPurchaseEntry,
  depreciationSchedule,
  monthlyDepreciation,
  buildDepreciationEntry,
  assetsReport,
  nextDepreciationMonth,
} from '../src/core/assets.ts'

let pass = 0
let fail = 0
const check = (name, cond) => {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}`) }
}

const base = { nameAr: 'ثلاجة عرض', costMinor: 1200000, salvageMinor: 120000, lifeMonths: 60, paidMinor: 1200000 }

console.log('— validateAsset —')
check('أصل سليم', validateAsset(base).length === 0)
check('يرفض اسماً فارغاً', validateAsset({ ...base, nameAr: ' ' }).length === 1)
check('يرفض تكلفة صفرية', validateAsset({ ...base, costMinor: 0 }).length >= 1)
check('يرفض خردة ≥ التكلفة', validateAsset({ ...base, salvageMinor: 1200000 }).length === 1)
check('يرفض عمر 0', validateAsset({ ...base, lifeMonths: 0 }).length === 1)
check('يرفض عمر > 600 شهر', validateAsset({ ...base, lifeMonths: 601 }).length === 1)
check('يرفض مدفوعاً > التكلفة', validateAsset({ ...base, paidMinor: 1200001 }).length === 1)
check('يقبل شراء آجلاً كاملاً (paid=0)', validateAsset({ ...base, paidMinor: 0 }).length === 0)

console.log('— قيد الاقتناء —')
const sum = (lines, k) => lines.reduce((a, l) => a + l[k], 0)
const find = (lines, code) => lines.filter((l) => l.accountCode === code)
const e1 = buildAssetPurchaseEntry(1200000, 1200000, 'FA-0001')
check('نقدي كامل: 1201 مدين / 1101 دائن', find(e1, '1201')[0].debit === 1200000 && find(e1, '1101')[0].credit === 1200000)
check('نقدي كامل: لا سطر موردين', find(e1, '2101').length === 0)
const e2 = buildAssetPurchaseEntry(1200000, 500000, 'FA-0002')
check('جزئي: 1101 بالمدفوع و2101 بالباقي', find(e2, '1101')[0].credit === 500000 && find(e2, '2101')[0].credit === 700000)
check('متوازن', sum(e2, 'debit') === sum(e2, 'credit'))
const e3 = buildAssetPurchaseEntry(1200000, 0, 'FA-0003')
check('آجل كامل: لا سطر خزينة', find(e3, '1101').length === 0 && find(e3, '2101')[0].credit === 1200000)
let threw = false
try { buildAssetPurchaseEntry(100, 200, 'FA-X') } catch { threw = true }
check('يرفض مدفوعاً يتجاوز التكلفة', threw)

console.log('— جدول القسط الثابت —')
// (1,200,000 − 120,000) ÷ 60 = 18,000 بالضبط
const s1 = depreciationSchedule(1200000, 120000, 60)
check('60 قسطاً متساوياً 18000', s1.length === 60 && s1.every((x) => x === 18000))
check('مجموع الجدول = الوعاء بالضبط', s1.reduce((a, b) => a + b, 0) === 1080000)
// قسمة لا تنقسم: 100000 ÷ 7 — الأخير يلتقط الباقي
const s2 = depreciationSchedule(100000, 0, 7)
check('قسمة عسيرة: المجموع = الوعاء (لا مليم ضائع)', s2.reduce((a, b) => a + b, 0) === 100000)
check('الأشهر الأولى متساوية والأخير يلتقط الباقي', s2[0] === 14285 && s2[6] === 100000 - 14285 * 6)
check('وعاء صفري ← جدول فارغ', depreciationSchedule(100, 100, 12).length === 0)
check('monthlyDepreciation لشهر ضمن العمر', monthlyDepreciation(1200000, 120000, 60, 0) === 18000)
check('monthlyDepreciation بعد انتهاء العمر = 0', monthlyDepreciation(1200000, 120000, 60, 60) === 0)

console.log('— قيد الإهلاك —')
const d1 = buildDepreciationEntry(18000, '2026-09')
check('5107 مدين / 1202 دائن', find(d1, '5107')[0].debit === 18000 && find(d1, '1202')[0].credit === 18000)
check('متوازن وبسطرين', d1.length === 2 && sum(d1, 'debit') === sum(d1, 'credit'))
threw = false
try { buildDepreciationEntry(0, '2026-09') } catch { threw = true }
check('يرفض إهلاكاً صفرياً', threw)

console.log('— assetsReport —')
const assets = [
  { id: 1, nameAr: 'ثلاجة', costMinor: 1200000, salvageMinor: 120000, lifeMonths: 60, monthsDepreciated: 12 },
  { id: 2, nameAr: 'أثاث', costMinor: 100000, salvageMinor: 0, lifeMonths: 7, monthsDepreciated: 7 },
]
const r = assetsReport(assets)
check('مجمع الثلاجة = 12×18000', r.rows[0].accumulatedMinor === 216000)
check('قيمتها الدفترية = التكلفة − المجمع', r.rows[0].bookValueMinor === 984000)
check('الأثاث مُهلَك بالكامل ودفتريته = الخردة (0)', r.rows[1].fullyDepreciated && r.rows[1].bookValueMinor === 0)
check('الإجماليات متسقة', r.totalBookMinor === r.totalCostMinor - r.totalAccumulatedMinor)

console.log('— nextDepreciationMonth —')
check('أول إهلاك = شهر الشراء', nextDepreciationMonth('2026-09', 0) === '2026-09')
check('بعد 3 أشهر', nextDepreciationMonth('2026-09', 3) === '2026-12')
check('عبور السنة', nextDepreciationMonth('2026-11', 2) === '2027-01')
check('عبور سنوات', nextDepreciationMonth('2026-01', 25) === '2028-02')

console.log(`\nالأصول: PASS=${pass} FAIL=${fail}`)
if (fail > 0) process.exit(1)
