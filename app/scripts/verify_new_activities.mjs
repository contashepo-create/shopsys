/**
 * فحص أنشطة القرار 27: المقاولات + العيادة + معرض السيارات
 * node --experimental-strip-types scripts/verify_new_activities.mjs
 */
import {
  validateProject, computeExtractTotals, buildExtractEntry,
  buildProjectCostEntry, buildRetentionReleaseEntry, projectProfit,
} from '../src/core/contracting.ts'
import {
  computeVisitTotals, buildVisitEntry, buildPatientCollectionEntry,
  validateTreatmentPlan, sessionFees, patientBalance, patientFileSummary,
} from '../src/core/clinic.ts'
import {
  validateCar, buildCarPurchaseEntry, buildCarPrepEntry,
  computeCarSale, buildCarSaleEntry, showroomSummary,
} from '../src/core/cars.ts'
import { STANDARD_COA } from '../src/core/ledger.ts'
import { ACTIVITY_TEMPLATES, ALL_MODULES, toggleModuleList } from '../src/core/activities.ts'

let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) { pass++ } else { fail++; console.error(`❌ ${name}`) } }
const throws = (fn, name) => { try { fn(); fail++; console.error(`❌ لم يرمِ: ${name}`) } catch { pass++ } }
const balanced = (lines) => lines.reduce((a, l) => a + l.debit, 0) === lines.reduce((a, l) => a + l.credit, 0)

/* ─── الحسابات الجديدة بالشجرة ─── */
const codes = new Set(STANDARD_COA.map((a) => a.code))
ok(codes.has('1105'), '1105 محتجزات ضمان موجود')
ok(codes.has('4107'), '4107 إيرادات مقاولات موجود')
ok(codes.has('4108'), '4108 إيرادات كشف وعلاج موجود')
ok(codes.has('5110'), '5110 تكاليف مشروعات موجود')
ok(STANDARD_COA.find((a) => a.code === '1105').rootType === 'assets', '1105 أصل')

/* ─── قوالب الأنشطة والوحدات ─── */
for (const id of ['contracting', 'clinic', 'cars']) {
  const t = ACTIVITY_TEMPLATES.find((a) => a.id === id)
  ok(!!t, `نشاط ${id} موجود`)
  ok(t.modules.length > 0, `نشاط ${id} له وحدات`)
}
ok(ALL_MODULES.includes('contracting') && ALL_MODULES.includes('clinic') && ALL_MODULES.includes('cars'), 'الوحدات الثلاث في ALL_MODULES')
ok(ACTIVITY_TEMPLATES.find((a) => a.id === 'cars').modules.includes('equipment_rental'), 'معرض السيارات يتكامل مع وحدة الإيجار')
// وحدة clinic تحسب كوحدة عمل — إلغاؤها وهي الوحيدة يرمي
throws(() => toggleModuleList(['clinic'], 'clinic'), 'لا يمكن إلغاء آخر وحدة عمل (clinic)')
ok(toggleModuleList(['contracting'], 'inventory').includes('inventory'), 'تفعيل مخزون لنشاط مقاولات يعمل')

/* ═══ المقاولات ═══ */
ok(validateProject({ nameAr: 'فيلا', contractValueMinor: 1_000_000_00, retentionPercent: 5 }).length === 0, 'مشروع سليم')
ok(validateProject({ nameAr: '', contractValueMinor: 100, retentionPercent: 5 }).length > 0, 'اسم فارغ يُرفض')
ok(validateProject({ nameAr: 'x', contractValueMinor: 100, retentionPercent: 25 }).length > 0, 'محتجز 25٪ يُرفض')

const ex = computeExtractTotals(100_000_00, 5, 14)
ok(ex.retentionMinor === 5_000_00, 'محتجز 5٪ من قيمة الأعمال')
ok(ex.vatMinor === 14_000_00, 'ضريبة 14٪')
ok(ex.dueMinor === 100_000_00 + 14_000_00 - 5_000_00, 'المستحق = قيمة + ضريبة − محتجز')
throws(() => computeExtractTotals(0, 5, 14), 'مستخلص صفري يرمي')

const exEntry = buildExtractEntry(ex, 'credit', 'PRX-0001')
ok(balanced(exEntry), 'قيد المستخلص متوازن')
ok(exEntry[0].accountCode === '1104' && exEntry[0].debit === ex.dueMinor, 'آجل: عملاء بالمستحق')
ok(exEntry.find((l) => l.accountCode === '1105')?.debit === 5_000_00, 'المحتجز على 1105')
ok(exEntry.find((l) => l.accountCode === '4107')?.credit === 100_000_00, 'الإيراد بقيمة الأعمال')
const exNoRet = buildExtractEntry(computeExtractTotals(50_000_00, 0, 0), 'cash', 'PRX-0002')
ok(!exNoRet.some((l) => l.accountCode === '1105'), 'بلا محتجز ← لا سطر 1105')
ok(exNoRet[0].accountCode === '1101', 'نقدي ← خزينة')

const costEntry = buildProjectCostEntry(20_000_00, 'credit', 'حديد')
ok(balanced(costEntry) && costEntry[0].accountCode === '5110' && costEntry[1].accountCode === '2101', 'تكلفة آجلة: 5110 ← 2101')
ok(buildProjectCostEntry(100, 'cash', 'x')[1].accountCode === '1101', 'تكلفة نقدية ← 1101')
throws(() => buildProjectCostEntry(0, 'cash', 'x'), 'تكلفة صفرية ترمي')

const relEntry = buildRetentionReleaseEntry(5_000_00, 'فيلا')
ok(balanced(relEntry) && relEntry[0].accountCode === '1101' && relEntry[1].accountCode === '1105', 'إفراج: 1101 ← 1105')
throws(() => buildRetentionReleaseEntry(0, 'x'), 'إفراج صفري يرمي')

const pp = projectProfit(
  { contractValueMinor: 1_000_000_00 },
  [{ grossMinor: 100_000_00, retentionMinor: 5_000_00 }, { grossMinor: 200_000_00, retentionMinor: 10_000_00 }],
  [{ kind: 'materials', amountMinor: 120_000_00 }, { kind: 'labor', amountMinor: 60_000_00 }, { kind: 'materials', amountMinor: 30_000_00 }],
  5_000_00,
)
ok(pp.extractedMinor === 300_000_00, 'إجمالي المستخلصات')
ok(pp.costsMinor === 210_000_00, 'إجمالي التكاليف')
ok(pp.profitMinor === 90_000_00, 'الربح')
ok(pp.marginPercent === 30, 'هامش 30٪')
ok(pp.progressPercent === 30, 'إنجاز 30٪ من العقد')
ok(pp.costsByKind.materials === 150_000_00, 'بند المواد مجمع')
ok(pp.retentionHeldMinor === 10_000_00, 'المحتجز القائم = المحتجز − المفرج عنه')

/* ═══ العيادة ═══ */
const v1 = computeVisitTotals({ kind: 'checkup', feeMinor: 300_00, paidMinor: 300_00, vatPercent: 0 })
ok(v1.dueMinor === 0 && v1.totalMinor === 300_00, 'كشف مسدد كاملاً')
const v2 = computeVisitTotals({ kind: 'procedure', feeMinor: 1000_00, paidMinor: 400_00, vatPercent: 14 })
ok(v2.vatMinor === 140_00 && v2.totalMinor === 1140_00 && v2.dueMinor === 740_00, 'سداد جزئي: المتبقي صحيح')
throws(() => computeVisitTotals({ kind: 'checkup', feeMinor: 100, paidMinor: 200, vatPercent: 0 }), 'مسدد أكبر من الإجمالي يرمي')
throws(() => computeVisitTotals({ kind: 'checkup', feeMinor: 0, paidMinor: 0, vatPercent: 0 }), 'زيارة صفرية ترمي')

const vEntry = buildVisitEntry(v2, 'VIS-0001')
ok(balanced(vEntry), 'قيد الزيارة متوازن')
ok(vEntry.find((l) => l.accountCode === '1101')?.debit === 400_00, 'المسدد على الخزينة')
ok(vEntry.find((l) => l.accountCode === '1104')?.debit === 740_00, 'المتبقي على المريض')
ok(vEntry.find((l) => l.accountCode === '4108')?.credit === 1000_00, 'إيراد الكشف')
const vFull = buildVisitEntry(v1, 'VIS-0002')
ok(!vFull.some((l) => l.accountCode === '1104'), 'سداد كامل ← لا سطر عملاء')

const colEntry = buildPatientCollectionEntry(500_00, 'أحمد')
ok(balanced(colEntry) && colEntry[0].accountCode === '1101' && colEntry[1].accountCode === '1104', 'تحصيل متأخرات 1101 ← 1104')

ok(validateTreatmentPlan({ totalSessions: 4, totalFeeMinor: 2000_00 }).length === 0, 'خطة سليمة')
ok(validateTreatmentPlan({ totalSessions: 1, totalFeeMinor: 2000_00 }).length > 0, 'جلسة واحدة تُرفض')
const fees = sessionFees(1000_00, 3)
ok(fees.length === 3 && fees[0] === 333_33 && fees[2] === 333_34, 'قسمة الجلسات بلا فقد قرش')
ok(fees.reduce((a, b) => a + b, 0) === 1000_00, 'مجموع الجلسات = الخطة')

ok(patientBalance([{ dueMinor: 740_00 }, { dueMinor: 100_00 }], [{ amountMinor: 500_00 }]) === 340_00, 'رصيد المريض')
const summary = patientFileSummary([
  { kind: 'checkup', feeMinor: 300_00, dueMinor: 0, date: '2026-09-01T10:00:00Z' },
  { kind: 'procedure', feeMinor: 1000_00, dueMinor: 740_00, date: '2026-09-10T10:00:00Z' },
])
ok(summary.visitCount === 2 && summary.totalFeesMinor === 1300_00, 'ملخص الملف')
ok(summary.lastVisit === '2026-09-10T10:00:00Z' && summary.byKind.checkup === 1, 'آخر زيارة وتوزيع الأنواع')

/* ═══ معرض السيارات ═══ */
const carIn = { make: 'تويوتا', model: 'كورولا', year: 2022, plateOrVin: 'س ص ع 123', purpose: 'sale', purchaseCostMinor: 500_000_00, odometerKm: 45000 }
ok(validateCar(carIn, []).length === 0, 'سيارة سليمة')
ok(validateCar({ ...carIn, plateOrVin: '' }, []).length > 0, 'بلا لوحة تُرفض')
ok(validateCar(carIn, ['س ص ع 123']).length > 0, 'لوحة مكررة تُرفض')
ok(validateCar({ ...carIn, year: 1800 }, []).length > 0, 'سنة غير منطقية تُرفض')

const buyEntry = buildCarPurchaseEntry(500_000_00, 'cash', 'كورولا')
ok(balanced(buyEntry) && buyEntry[0].accountCode === '1103' && buyEntry[1].accountCode === '1101', 'شراء: مخزون ← خزينة')
ok(buildCarPurchaseEntry(100, 'credit', 'x')[1].accountCode === '2101', 'شراء آجل ← موردون')
const prepEntry = buildCarPrepEntry(20_000_00, 'cash', 'سمكرة')
ok(balanced(prepEntry) && prepEntry[0].accountCode === '1103', 'التجهيز يُرسمل على المخزون')

const sale = computeCarSale(600_000_00, 520_000_00, 0)
ok(sale.profitMinor === 80_000_00, 'ربح البيع = السعر − التكلفة الكاملة')
const saleEntry = buildCarSaleEntry(sale, 'cash', 'كورولا')
ok(balanced(saleEntry), 'قيد البيع متوازن (إيراد + إخراج تكلفة)')
ok(saleEntry.find((l) => l.accountCode === '4101')?.credit === 600_000_00, 'الإيراد بسعر البيع')
ok(saleEntry.find((l) => l.accountCode === '5101')?.debit === 520_000_00, 'التكلفة على 5101')
ok(saleEntry.find((l) => l.accountCode === '1103')?.credit === 520_000_00, 'إخراج من المخزون')
const saleVat = computeCarSale(100_000_00, 90_000_00, 15)
ok(saleVat.vatMinor === 15_000_00 && balanced(buildCarSaleEntry(saleVat, 'credit', 'x')), 'بيع بضريبة 15٪ متوازن')
throws(() => computeCarSale(0, 100, 0), 'بيع صفري يرمي')

const sum = showroomSummary([
  { status: 'in_stock', fullCostMinor: 500_000_00, profitMinor: null },
  { status: 'sold', fullCostMinor: 520_000_00, profitMinor: 80_000_00 },
  { status: 'renting', fullCostMinor: 300_000_00, profitMinor: null },
])
ok(sum.inStock === 1 && sum.sold === 1 && sum.renting === 1, 'عدادات المعرض')
ok(sum.stockValueMinor === 500_000_00 && sum.totalProfitMinor === 80_000_00, 'قيمة المخزون وأرباح البيع')

console.log(`PASS=${pass} FAIL=${fail}`)
if (fail > 0) process.exit(1)
console.log(`🎉 نجح فحص أنشطة القرار 27 — ${pass} اختباراً`)
