/**
 * فحص بطاقة تقرير المشروع الشاملة (مركز تقارير المقاولات — طلب المالك):
 * projectReportCard فوق projectProfit وeffectiveContractValue — سيناريو واحد
 * محسوب باليد يغطي كل مؤشر: العقود الأصلية/الفعلية بأوامر التغيير،
 * المعلقة من الأوامر، المستخلصات وضريبتها، التكاليف والربح والهامش،
 * المحتجز القائم، والدفعات المقدمة (مستلمة/مستردة/متبقية).
 *
 * التشغيل: node --experimental-strip-types scripts/verify_contracting_reports.mjs
 */
import assert from 'node:assert/strict'
import { projectReportCard, effectiveContractValue } from '../src/core/contracting.ts'

let pass = 0
const ok = (name) => { pass++; console.log('  ✓', name) }

/* السيناريو: مشروع بعقد مليون، مستخلصان، ثلاث تكاليف، ثلاثة أوامر تغيير، دفعتان مقدمتان */
const project = { contractValueMinor: 1_000_000 }
const extracts = [
  { grossMinor: 400_000, vatMinor: 56_000, retentionMinor: 20_000, date: '2026-09-01' },
  { grossMinor: 300_000, vatMinor: 42_000, retentionMinor: 15_000, date: '2026-09-20' },
]
const costs = [
  { kind: 'materials', amountMinor: 200_000 },
  { kind: 'labor', amountMinor: 80_000 },
  { kind: 'equipment', amountMinor: 20_000 },
]
const releasedRetentionMinor = 0
const orders = [
  { id: 1, projectId: 1, number: 'CO-0001', titleAr: 'أعمال إضافية', amountMinor: 100_000, status: 'approved', date: '2026-09-05', approvedAt: '2026-09-05' },
  { id: 2, projectId: 1, number: 'CO-0002', titleAr: 'تخفيض نطاق', amountMinor: -30_000, status: 'rejected', date: '2026-09-06', approvedAt: null },
  { id: 3, projectId: 1, number: 'CO-0003', titleAr: 'زيادة متوقعة', amountMinor: 50_000, status: 'draft', date: '2026-09-25', approvedAt: null },
]
const advances = [
  { amountMinor: 100_000, recoveredMinor: 40_000 },
  { amountMinor: 50_000, recoveredMinor: 20_000 },
]
const c = projectReportCard(project, extracts, costs, releasedRetentionMinor, orders, advances)

/* ═══ ① العقد وأوامر التغيير ═══ */
{
  assert.equal(c.contractOriginalMinor, 1_000_000, 'الأصلية كما هي')
  assert.equal(c.contractEffectiveMinor, 1_100_000, 'الفعلية = مليون + المعتمد 100 ألف (المرفوض لا يدخل)')
  assert.equal(c.changeOrdersPendingMinor, 50_000, 'المعلقة = صافي المسودات فقط')
  assert.equal(c.changeOrdersApprovedCount, 1, 'المعتمد عدداً = 1 (المرفوض مستبعد)')
  assert.equal(effectiveContractValue(1_000_000, orders), 1_100_000, 'effectiveContractValue متسقة مع البطاقة')
  ok('العقد: الأصلية 1,000,000 · الفعلية 1,100,000 (المعتمد يدخل والمرفوض لا) · المعلقة 50,000 من المسودة')
}

/* ═══ ② المستخلصات والضريبة والإنجاز ═══ */
{
  assert.equal(c.extractedMinor, 700_000, 'قيمة الأعمال = 400+300 ألف')
  assert.equal(c.extractsCount, 2)
  assert.equal(c.lastExtractDate, '2026-09-20', 'آخر مستخلص بالتاريخ الأحدث')
  assert.equal(c.vatChargedMinor, 98_000, 'ض.ق.م محمّلة = 56+42 ألف (معلومة الإقرار)')
  assert.equal(c.progressPercent, 70, 'الإنجاز على العقد الأصلي (سلوك projectProfit القائم) = 70٪')
  ok('المستخلصات: 700,000 · آخرها 2026-09-20 · ض.ق.م محمّلة 98,000 · إنجاز 70٪')
}

/* ═══ ③ التكاليف والربح والهامش ═══ */
{
  assert.equal(c.costsMinor, 300_000)
  assert.equal(c.costsByKind.materials, 200_000)
  assert.equal(c.costsByKind.labor, 80_000)
  assert.equal(c.costsByKind.equipment, 20_000)
  assert.equal(c.costsByKind.subcontract, 0, 'بلا باطن')
  assert.equal(c.profitMinor, 400_000, 'الربح = 700 − 300')
  assert.equal(c.marginPercent, 57.1, 'الهامش مقرب لعُشر واحد: 57.1٪')
  ok('التكاليف 300,000 بتوزيعها · الربح 400,000 · الهامش 57.1٪')
}

/* ═══ ④ المحتجز والدفعات المقدمة ═══ */
{
  assert.equal(c.retentionHeldMinor, 35_000, 'محتجز قائم = 20+15 (لم يُفرج عن شيء)')
  assert.equal(c.advancesReceivedMinor, 150_000)
  assert.equal(c.advancesRecoveredMinor, 60_000)
  assert.equal(c.advancesRemainingMinor, 90_000, 'المتبقي = 150 − 60 (التزام 2109 قائم')
  ok('المحتجز 35,000 · المقدمة: 150,000 مستلمة / 60,000 مستردة / 90,000 متبقية')
}

/* ═══ ⑤ التوافق مع projectProfit: البطاقة امتداد لا استبدال ═══ */
{
  const { projectProfit } = await import('../src/core/contracting.ts')
  const base = projectProfit(project, extracts, costs, releasedRetentionMinor)
  assert.equal(base.extractedMinor, c.extractedMinor)
  assert.equal(base.profitMinor, c.profitMinor)
  assert.equal(base.retentionHeldMinor, c.retentionHeldMinor)
  assert.equal(base.progressPercent, c.progressPercent)
  ok('البطاقة تمتد projectProfit كما هي — لا ازدواج منطق ولا انحراف')
}

console.log(`\n✅ بطاقة تقرير المشروع الشاملة: ${pass} فحوصاً ناجحة`)
