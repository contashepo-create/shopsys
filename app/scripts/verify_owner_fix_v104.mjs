/* بوابة جولة v1.0.4 — التقييم المادي للمخزون الافتتاحي وإعلان رأس المال (نمط العالمية):
   ① المخزون الافتتاحي يسجَّل «كمية × تكلفة وحدة» لا مبلغاً مجرداً (بلاغ المالك):
      القيمة الدفترية (1103/3101) والكمية الفعلية (stockQty) والتكلفة المرجعية تثبت معاً
   ② التعديل يرحّل فرق القيمة قيداً وفرق الكمية على الرصيد الحالي — وبلا نزول تحت المستهلك
   ③ تحرير بطاقة صنف بعد الحركات لا يغيّر قيمة المخزون صامتاً (ثابت 1103) —
      قبل الحركات يقيد الفرق (امتداد AUDIT-005 للتحرير)
   ④ لوحة توازن الميزانية الافتتاحية + إعلان رأس المال: الفرق يرحّل لأرباح مرحّلة 3102
   ⑤ الحقول الجديدة تسترجع بعد إعادة التحميل (persist) */
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { reporter } from './auditKit.mjs'

const R = reporter('جولة v1.0.4 — التقييم المادي وإعلان رأس المال')
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

/* ① النواة */
{
  const core = read('src/core/openingBalances.ts')
  assert.ok(core.includes('export interface OpeningItemDetail'), 'لا سجل للتقييم المادي في النواة')
  assert.ok(core.includes('qty: number') && core.includes('unitCostMinor: number'))
  assert.ok(core.includes('export function summarizeOpeningBalances'), 'لا تجميع للميزانية الافتتاحية')
  assert.ok(core.includes('export function buildCapitalDeclarationEntry'), 'لا قيد إعلان رأس المال')
  assert.ok(core.includes("'3102'"), 'إعلان رأس المال لا يستعمل أرباح مرحّلة 3102')
  R.ok('النواة: سجل (كمية×تكلفة) + تجميع الميزانية + قيد إعلان رأس المال لأرباح مرحّلة 3102')
}

/* ② repo: الفعل المادي والحارس والpersist */
{
  const repo = read('src/data/repo.ts')
  assert.ok(repo.includes('setOpeningItemStock: (args: { itemId: number; qty: number; unitCostMinor: number })'), 'فعل التقييم المادي غير معرف')
  assert.ok(repo.includes('declareOpeningCapital: (declaredMinor: number)'), 'فعل إعلان رأس المال غير معرف')
  assert.ok(repo.includes('openingItems: Record<number, OpeningItemDetail>'), 'سجل الأصناف الافتتاحية غير محفوظ')
  assert.ok(repo.includes('openingDeclaredCapitalMinor: number | null'), 'رأس المال المعلن غير محفوظ')
  assert.ok(repo.includes('استخدم تسوية الجرد'), 'لا حارس ضد النزول تحت المستهلك')
  assert.ok(repo.includes('الخدمات لا تدخل المخزون'), 'الخدمات غير ممنوعة من المخزون')
  assert.ok(repo.includes('تم من تسوية الجرد أو شاشة الأرصدة الافتتاحية'), 'تحرير البطاقة بعد الحركات بلا حارس')
  assert.ok(repo.includes('openingItems: s.openingItems ?? {}') && repo.includes('openingDeclaredCapitalMinor: s.openingDeclaredCapitalMinor ?? null'), 'الحقول الجديدة لا تسترجع بعد إعادة التحميل'
  )
  assert.ok(/openingItems: \{ \.\.\.state\.openingItems, \[id\]: \{ qty: item\.stockQty \|\| 0, unitCostMinor: item\.costMinor \|\| 0 \} \}/.test(repo), 'إضافة صنف جديد بلا تسجيل تقييمه المادي')
  R.ok('repo: تقييم مادي متكامل (كمية×تكلفة) + حارس البطاقة + استرجاع كل الحقول الجديدة')
}

/* ③ الواجهة */
{
  const page = read('src/ui/pages/OpeningBalancesPage.tsx')
  assert.ok(page.includes('setOpeningItemStock'), 'الشاشة لا تستعمل التقييم المادي')
  assert.ok(page.includes('الكمية') && page.includes('تكلفة الوحدة'), 'لا حقلا كمية وتكلفة في الجدول')
  assert.ok(page.includes('القيمة = كمية × تكلفة'), 'لا عمود قيمة محسوبة')
  assert.ok(page.includes('data-opening-balance-panel'), 'لا لوحة توازن')
  assert.ok(page.includes('declareOpeningCapital'), 'لا زر إعلان رأس المال')
  assert.ok(page.includes('summarizeOpeningBalances'), 'اللوحة لا تجمع الميزانية الافتتاحية')
  assert.ok(page.includes('capitalLedgerMinor'), 'اللوحة لا تعرض رصيد 3101 الدفتري الحقيقي')
  assert.ok(page.includes("a.code !== '3102'"), 'الأرباح المرحّلة تقبل رصيداً يدوياً من التبويب العام')
  R.ok('الشاشة: جدول (كمية×تكلفة×قيمة) + لوحة توازن برصيد 3101 الدفتري + إعلان رأس المال')
}

/* ④ الاختبارات */
{
  const t = read('tests/opening_stock_physical.test.ts')
  assert.ok(t.includes('كمية × تكلفة الوحدة'), 'لا اختبار للتقييم المادي')
  assert.ok(t.includes('لا يمكن تخفيض الكمية الافتتاحية دون المستهلك'), 'لا اختبار لحارس التخفيض')
  assert.ok(t.includes('لأرباح مرحّلة 3102 متوازناً'), 'لا اختبار لإعلان رأس المال')
  assert.ok(t.includes('assertInvariant1103'), 'لا فحص لثابت 1103 لحظة التقييم')
  R.ok('اختبارات v1.0.4: التقييم المادي + الحارس + الإعلان + الثابت الأعظم')
}

R.done()
