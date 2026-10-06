/* بوابة مفاتيح الطباعة لفاتورة الشراء (طلب المالك ㉘): فاتورة الشراء تتبع
   مفاتيح الطباعة الثلاثة (طباعة الكاشير/الطباعة الصامتة/الطباعة بعد الحفظ)
   مثل فاتورة البيع تماماً — لا مسار طباعة خاصاً بها. */
import assert from 'node:assert/strict'
import { reporter } from './auditKit.mjs'
import { readFileSync } from 'node:fs'

const R = reporter('مفاتيح الطباعة — فاتورة الشراء مثل البيع')
const purchasePage = readFileSync(new URL('../src/ui/pages/AdvancedPurchaseInvoicePage.tsx', import.meta.url), 'utf8')
const salesPage = readFileSync(new URL('../src/ui/pages/AdvancedSalesInvoicePage.tsx', import.meta.url), 'utf8')
const printSwitchesFile = readFileSync(new URL('../src/ui/components/PrintSwitches.tsx', import.meta.url), 'utf8')
  /* v1.0.15: تعريف حالة المفاتيح انتقل لملف hook مستقل (سياسة Fast Refresh) */
  const printSwitchesHookFile = readFileSync(new URL('../src/ui/hooks/usePrintSwitches.ts', import.meta.url), 'utf8')
  const printSwitchesSources = printSwitchesFile + printSwitchesHookFile

/* ① المفاتيح الثلاثة نفسها المعرّفة في المكوّن المشترك */
{
  for (const key of ['cashierPrint', 'silentPrint', 'printAfterSave']) {
    assert.ok(new RegExp(`${key}[?:]`).test(printSwitchesSources), `مفتاح «${key}» غير معرف في PrintSwitches`)
  }
  R.ok('المفاتيح الثلاثة معرفة مركزياً: cashierPrint · silentPrint · printAfterSave')
}

/* ② فاتورة الشراء تستهلك المفاتيح بمسار البيع نفسه */
{
  assert.ok(purchasePage.includes('usePrintSwitches'), 'فاتورة الشراء لا تستهلك مفاتيح الطباعة')
  assert.ok(purchasePage.includes('openPrintPreview'), 'لا معاينة حرة (openPrintPreview) في فاتورة الشراء')
  assert.ok(purchasePage.includes('printModelWithTemplate'), 'لا طباعة صامتة عبر محرك القوالب')
  assert.ok(purchasePage.includes('buildModelHtml'), 'لا بناء HTML للمعاينة')
  /* الطباعة من المعاينة العامة الآن (ThermalPreview) — المفتاح يُقرأ لحظة
     الطباعة (getState) لا لحظة فتح المعاينة، فلا إغلاق قديم (stale) */
  const previewComponent = readFileSync(new URL('../src/ui/components/ThermalPreview.tsx', import.meta.url), 'utf8')
  assert.ok(/silent: useAppStore\.getState\(\)\.receipt\.silentPrint \?\? false/.test(previewComponent), 'المعاينة لا تقرأ مفتاح الطباعة الصامتة لحظة الطباعة')
  assert.ok(purchasePage.includes('cashierPrint?\'thermal\':\'a4\''), 'الطباعة السريعة لا تتبع مفتاح الكاشير (thermal/a4)')
  assert.ok(purchasePage.includes('onQuickPrint'), 'زر الطباعة السريعة مفقود')
  R.ok('فاتورة الشراء: معاينة/صامت + طباعة سريعة بمفتاح الكاشير')
}

/* ③ الطباعة بعد الحفظ: تتبع المفتاح ولا تعطّل الترحيل عند الفشل */
{
  const idx = purchasePage.indexOf('printAfterSave){try{printDraft(printSwitches.cashierPrint')
  assert.ok(idx > 0, 'الطباعة بعد الحفظ لا تتبع مفتاح الكاشير')
  assert.ok(purchasePage.slice(idx, idx + 400).includes('الطباعة لا تعطّل الترحيل'), 'فشل الطباعة بعد الحفظ قد يوقف الترحيل')
  R.ok('الطباعة بعد الحفظ داخل try/catch — الطباعة لا تعطّل الترحيل')
}

/* ④ التكافؤ مع فاتورة البيع: نفس الأنماط الأربعة */
{
  for (const pattern of ['usePrintSwitches', 'openPrintPreview', 'printModelWithTemplate', 'buildModelHtml', 'onQuickPrint']) {
    assert.ok(salesPage.includes(pattern), `فاتورة البيع نفسها فقدت ${pattern} — التكافؤ انكسر`)
    assert.ok(purchasePage.includes(pattern), `فاتورة الشراء تفتقد ${pattern} الموجود في البيع`)
  }
  R.ok('التكافؤ: نفس الأنماط الخمسة موجودة في وجهي البيع والشراء')
}

R.done()
