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

/* ① المفاتيح الثلاثة نفسها المعرّفة في المكوّن المشترك */
{
  for (const key of ['cashierPrint', 'silentPrint', 'printAfterSave']) {
    assert.ok(new RegExp(`${key}[?:]`).test(printSwitchesFile), `مفتاح «${key}» غير معرف في PrintSwitches`)
  }
  R.ok('المفاتيح الثلاثة معرفة مركزياً: cashierPrint · silentPrint · printAfterSave')
}

/* ② فاتورة الشراء تستهلك المفاتيح بمسار البيع نفسه */
{
  assert.ok(purchasePage.includes('usePrintSwitches'), 'فاتورة الشراء لا تستهلك مفاتيح الطباعة')
  assert.ok(purchasePage.includes('ThermalPreview'), 'لا معاينة حرة (ThermalPreview) في فاتورة الشراء')
  assert.ok(purchasePage.includes('printModelWithTemplate'), 'لا طباعة صامتة عبر محرك القوالب')
  assert.ok(purchasePage.includes('buildModelHtml'), 'لا بناء HTML للمعاينة')
  assert.ok(/silentPrint\)\}/.test(purchasePage) || /silent:printSwitches\.silentPrint/.test(purchasePage), 'المعاينة لا تحترم الطباعة الصامتة عند الطباعة')
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
  for (const pattern of ['usePrintSwitches', 'ThermalPreview', 'printModelWithTemplate', 'buildModelHtml', 'onQuickPrint']) {
    assert.ok(salesPage.includes(pattern), `فاتورة البيع نفسها فقدت ${pattern} — التكافؤ انكسر`)
    assert.ok(purchasePage.includes(pattern), `فاتورة الشراء تفتقد ${pattern} الموجود في البيع`)
  }
  R.ok('التكافؤ: نفس الأنماط الخمسة موجودة في وجهي البيع والشراء')
}

R.done()
