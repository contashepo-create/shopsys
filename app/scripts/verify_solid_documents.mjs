/**
 * فحص §92 — المستندات الصلبة الرسمية:
 * ① نافذة مسير الرواتب بطابع مستند صلب: ترويسة داكنة برقم مستند وشبارة،
 *    وشريط إجماليات سفلي كبير (استحقاق/خصومات/سلف/صافي) وزر ترحيل محصّن.
 * ② محررا عرض السعر والمشروع يرثان منظومة فاتورة الأعلاف: مسودات محفوظة
 *    (kind='quotation'/'project') + لوحة «مراجعة قبل الترحيل» بأخطاء النواة نفسها.
 *
 * التشغيل: node --experimental-strip-types scripts/verify_solid_documents.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

let pass = 0
const ok = (name) => { pass++; console.log('  ✓', name) }
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8')

const employees = read('ui/pages/EmployeesPage.tsx')
const quotes = read('ui/pages/QuotationsPage.tsx')
const contracting = read('ui/pages/ContractingPages.tsx')
const repo = read('data/repo.ts')
const modal = read('ui/components/InvoiceDraftsModal.tsx')

/* ═══ ① نافذة مسير الرواتب الصلبة ═══ */
{
  // الترويسة الرسمية: مستند داكن برقم PR-<الشهر> وشارة عدد القسائم والصافي
  assert.ok(employees.includes('payroll-doc-head') && employees.includes('PR-'), 'لا ترويسة مستند رسمية للمسير')
  assert.ok(employees.includes('data-slip-count') && employees.includes('data-slip-head-net'), 'الترويسة بلا عدّاد قسائم وصافي')
  // شريط الإجماليات الصلب: أربع خلايا كبيرة + زر ترحيل محصّن بالصافي الموجب
  assert.ok(employees.includes('data-slip-totals-bar'), 'لا شريط إجماليات صلب أسفل المسير')
  for (const cell of ['إجمالي الاستحقاق', 'خصومات وجزاءات', 'سلف مستقطعة (1107)', 'صافي المستحق']) {
    assert.ok(employees.includes(cell), `خلية الشريط مفقودة: ${cell}`)
  }
  assert.ok(employees.includes('data-slip-total-net'), 'الصافي الكلي غير مميز في الشريط')
  assert.ok(/disabled=\{slipTotals\.count === 0 \|\| slipTotals\.net <= 0\}/.test(employees), 'زر الترحيل لا يُعطَّل عند لا قسائم أو صافي غير موجب')
  assert.ok(/const slipTotals = useMemo/.test(employees), 'إجماليات المسير ليست مشتقة من الحالة')
  ok('مسير الرواتب: ترويسة مستند PR-<شهر> + شريط إجماليات صلب + ترحيل محصّن')
}

/* ═══ ② مسودات العروض والمشروعات بنفس مخزن الفواتير ═══ */
{
  // المخزن: النوع موسع والتسميات موجودة
  assert.ok(repo.includes("kind: 'sale' | 'purchase' | 'quotation' | 'project'"), 'مخزن المسودات لا يقبل العروض والمشروعات')
  assert.ok(modal.includes("'quotation' | 'project'") && modal.includes('عروض الأسعار') && modal.includes('المشروعات'), 'نافذة المسودات بلا تسميات العروض والمشروعات')
  // العرض: حفظ واسترجاع وربط بالشريط وحذف عند الاعتماد
  assert.ok(quotes.includes("kind: 'quotation'") && quotes.includes('const saveDraft = () =>'), 'العرض لا يحفظ مسودة')
  assert.ok(quotes.includes('onSaveDraft={saveDraft}') && quotes.includes('onRestoreDraft={() => setDraftsOpen(true)}'), 'أزرار شريط العرض غير مربوطة بالمسودات')
  assert.ok(quotes.includes('deleteAdvancedInvoiceDraft(draftId)'), 'المسودة لا تُمسح بعد اعتماد العرض')
  // المشروع: نفس المنظومة
  assert.ok(contracting.includes("kind: 'project'") && contracting.includes('const saveProjectDraft = () =>'), 'المشروع لا يحفظ مسودة')
  assert.ok(contracting.includes('onSaveDraft={saveProjectDraft}') && contracting.includes('onRestoreDraft={() => setProjDraftsOpen(true)}'), 'أزرار شريط المشروع غير مربوطة')
  assert.ok(contracting.includes('deleteAdvancedInvoiceDraft(projDraftId)'), 'مسودة المشروع لا تُمسح بعد الإنشاء')
  ok('مسودات العروض (quotation) والمشروعات (project) بنفس مخزن الفواتير — حفظ واسترجاع ومسح بعد الاعتماد')
}

/* ═══ ③ لوحة المراجعة قبل الاعتماد — أخطاء النواة نفسها ═══ */
{
  // العرض: validateQuotation من النواة (لا ازدواج منطق) + صلاحية منتهاة + أسعار صفر
  assert.ok(quotes.includes('validateQuotation({ titleAr, clientName, lines: parsedLines })'), 'أخطاء العرض ليست من validateQuotation النواة')
  assert.ok(quotes.includes('صلاحية العرض انتهت') && quotes.includes('بسعر صفر — عرض مجاني؟'), 'فحوص واجهة العرض ناقصة')
  assert.ok(/if \(blockingCount > 0\) \{ setChecksOpen\(true\); return \}/.test(quotes), 'المانع لا يفتح لوحة المراجعة في العرض')
  // المشروع: مانعو الإنشاء
  for (const marker of ['اسم المشروع مطلوب', 'بند جدول كميات واحداً على الأقل', 'قيمة العقد الإجمالية مطلوبة']) {
    assert.ok(contracting.includes(marker), `فحص مشروع مفقود: ${marker.slice(0, 20)}`)
  }
  assert.ok(/if \(projectBlocking > 0\) \{ setProjChecksOpen\(true\); return \}/.test(contracting), 'المانع لا يفتح لوحة المراجعة في المشروع')
  // اللوحة نفسها مركّبة في المحررين
  assert.ok(quotes.includes('<PrePostChecks issues={quoteIssues}') && contracting.includes('<PrePostChecks issues={projectIssues}'), 'لوحة المراجعة غير مركّبة')
  ok('لوحة «مراجعة قبل الترحيل» في المحررين — أخطاء النواة نفسها + فحوص الصلاحية والأسعار')
}

/* ═══ ④ البوابات القديمة لم تُكسر (عينات حرفية ترصدها) ═══ */
{
  // بوابة مسير الرواتب القائمة تشترط نصوصها الحرفية — تأكيد بقائها
  assert.ok(/<Modal open=\{slipDraftOpen\}[\s\S]{0,200}مسير رواتب/.test(employees), 'شرط بوابة المسير القديمة انكسر')
  assert.ok(employees.includes('data-slip-search') && employees.includes('data-slip-draft'), 'معرفات بوابة المسير مفقودة')
  assert.ok(employees.includes('data-apply-attendance'), 'زر احتساب من الحضور اختفى')
  assert.ok(quotes.includes('data-quotation-doc-editor'), 'معرف محرر العرض مفقود')
  ok('المعرفات الحرفية التي ترصدها البوابات القائمة كلها باقية')
}

console.log(`\n✅ المستندات الصلبة (مسير الرواتب + مسودات العروض والمشروعات): ${pass} فحوصاً ناجحة`)
