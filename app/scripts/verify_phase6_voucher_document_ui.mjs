/**
 * المرحلة 6 من التدقيق — شكل سندات القبض والصرف ونوافذ الإدخال.
 *
 * السؤال (طلب المالك): هل السندات تتبع **تصميم المستند** الجديد المطبَّق على الفواتير،
 * وهل نافذة الإدخال احترافية تخدم كل سيناريوهات الدفع والقبض والمعاملات؟
 *
 * لغة المستند المعتمدة (من `InvoicePOSFrame`): ترويسة داكنة `#0f2042` فيها نوع المستند
 * ورقمه وحالته، ثم شريط بيانات المنشأة، ثم أقسام بيضاء بحواف `ring-[#dce9ff]`،
 * ثم شريط إجراءات سفلي ثابت. هذه البوابة تمنع أي انحدار عن هذا الشكل.
 *
 * تشغيل: node --experimental-strip-types scripts/verify_phase6_voucher_document_ui.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { reporter } from './auditKit.mjs'

const R = reporter('المرحلة 6 — سندات القبض والصرف بلغة المستند')
const UI = '/home/user/shopsys/app/src/ui/'
const read = (p) => readFileSync(UI + p, 'utf8')
const vouchers = read('pages/VouchersPage.tsx')
const frame = read('components/InvoicePOSFrame.tsx')

/* ① طبقة المستند موحّدة ولها بديل ليلي — لا ألوان محفورة في الصفحة */
{
  const css = readFileSync('/home/user/shopsys/app/src/index.css', 'utf8')
  // الفاتورة نظام أصناف (invoice-doc-*) له وضع ليلي — والسند يجب أن يكون مثله لا ألواناً ست عشرية ثابتة
  assert.ok(frame.includes('invoice-doc-topbar') && css.includes('.dark .invoice-doc-topbar'), 'نظام مستند الفاتورة أو وضعه الليلي مفقود')
  for (const cls of ['.doc-sheet', '.doc-head', '.doc-meta', '.doc-card', '.doc-ring', '.doc-band', '.doc-footer']) {
    assert.ok(css.includes(cls), `طبقة المستند تنقصها ${cls}`)
  }
  assert.ok(css.includes('.dark {') && css.includes('--doc-paper'), 'متغيرات المستند بلا بديل ليلي')
  R.ok('طبقة مستند موحّدة (doc-*) بمتغيرات لونية لها بديل ليلي — كنظام الفاتورة (invoice-doc-*)')

  // لا ألوان ست عشرية في هياكل صفحة السندات (باقي الاستثناءات: شارات حالة وطباعة)
  const structural = ['bg-[#0f2042]', 'bg-[#f8f9ff]', 'bg-[#eff4ff]', 'ring-[#dce9ff]', 'text-[#45464e]', 'text-[#75777f]', 'border-[#c5c6cf]']
  const leftovers = structural.filter((t) => vouchers.includes(t))
  assert.deepEqual(leftovers, [], `ألوان محفورة باقية في هيكل السندات: ${leftovers.join('، ')}`)
  R.ok('لا لون محفور في هيكل صفحة السندات — الشكل يأتي من الطبقة المشتركة فيتبع الوضع الليلي تلقائياً')

  // لا خلفيات بيضاء ثابتة داخل نوافذ المستند (كانت تُعمي النص في الوضع الليلي)
  const docWindows = vouchers.slice(vouchers.indexOf('<Modal open={open}'))
  const hardWhite = (docWindows.match(/bg-white(?![/-])/g) ?? []).length
  assert.equal(hardWhite, 0, `${hardWhite} خلفية بيضاء ثابتة داخل نوافذ المستند`)
  R.ok('لا خلفية بيضاء ثابتة داخل أي نافذة سند — الوضع الليلي يقرأ المستند كاملاً')
}

/* ② النوافذ الأربع كلها بلغة المستند (إنشاء · معاينة · عرض مرحّل · عكس) */
{
  const modals = vouchers.split('<Modal ').slice(1)
  assert.ok(modals.length >= 4, `عدد نوافذ السندات ${modals.length} — متوقع 4 على الأقل`)
  const documentStyled = modals.filter((m) => m.includes('doc-head') || m.includes('doc-sheet') || m.includes('#7a2431'))
  assert.equal(documentStyled.length, modals.length, `${modals.length - documentStyled.length} نافذة ما زالت بالشكل القديم`)
  R.ok(`نوافذ السندات الأربع (إنشاء · معاينة · سند مرحّل · عكس) كلها بلغة المستند — لا نافذة بالشكل القديم`)
}

/* ③ السند المرحّل مستند كامل: رقم وحالة وطرف ومبلغ بالحروف وقيد وتوقيعات */
{
  const view = vouchers.slice(vouchers.indexOf('<Modal open={!!viewing}'), vouchers.indexOf('عكس السند {reverseTarget.voucherNumber}'))
  for (const [needle, why] of [
    ['voucherNumber', 'رقم السند في الترويسة'],
    ['Receipt Voucher', 'التسمية الإنجليزية للمستند'],
    ['مرحّل ومعتمد', 'حالة السند'],
    ['amountInWords', 'المبلغ بالحروف (شرط مستندي)'],
    ['القيد المحاسبي المتولد', 'القيد المتولد داخل المستند'],
    ['القيد متوازن', 'إجمالي مدين = دائن معروض'],
    ['توقيع', 'خانات التوقيع'],
    ['أمين الخزينة', 'توقيع أمين الخزينة'],
    ['الاعتماد', 'خانة الاعتماد'],
  ]) assert.ok(view.includes(needle), `السند المرحّل ينقصه: ${why}`)
  R.ok('السند المرحّل مستند كامل: رقم وحالة وطرف ومبلغ بالحروف وقيده المتوازن وثلاث خانات توقيع')
}

/* ④ نافذة الإنشاء تخدم كل سيناريوهات القبض والصرف */
{
  const create = vouchers.slice(vouchers.indexOf('<Modal open={open}'), vouchers.indexOf('<Modal open={previewOpen}'))
  const scenarios = [
    ['PartyQuickPicker', 'اختيار العميل/المورد بالبحث السريع'],
    ['liveBalance', 'عرض رصيد الطرف قبل السند'],
    ['PaymentMethodPicker', 'وسيلة الدفع (نقدي/بنك/ماكينة)'],
    ['terminalPayment', 'مرجع ماكينة الدفع'],
    ['جدول تخصيص', 'توزيع السداد على الفواتير'],
    ['تحت الحساب', 'الباقي تحت الحساب'],
    ['getAssetDue', 'سداد أقساط الأصول للمورد'],
    ['costCenterId', 'ربط مركز التكلفة'],
    ['vehicle', 'تحميل المصروف على مركبة'],
    ['isPurchaseExpense', 'مصروف على فاتورة شراء يرفع تكلفة أصنافها'],
    ['voucherDate', 'تاريخ السند'],
    ['addQuickAccount', 'إضافة حساب مقابل سريع'],
    ['amountInWords', 'المبلغ بالحروف أثناء الإدخال'],
    ['saveDraft', 'حفظ كمسودة'],
    ['printDraft', 'طباعة السند'],
  ]
  const missing = scenarios.filter(([k]) => !create.includes(k)).map(([, why]) => why)
  assert.deepEqual(missing, [], `نافذة الإنشاء تنقصها سيناريوهات: ${missing.join('، ')}`)
  R.ok(`نافذة الإنشاء تغطي ${scenarios.length} سيناريو: من التخصيص على الفواتير إلى أقساط الأصول وماكينة الدفع ومركز التكلفة`)
}

/* ⑤ نافذة العكس: قرار محاسبي معلن الأثر وسبب إلزامي */
{
  const rev = vouchers.slice(vouchers.indexOf('عكس السند {reverseTarget.voucherNumber}'))
  assert.ok(rev.includes('ماذا سيحدث بالضبط؟'), 'لا شرح لأثر العكس قبل التنفيذ')
  assert.ok(rev.includes('قيد عاكس'), 'لا توضيح أن التصحيح بقيد عاكس')
  assert.ok(rev.includes('disabled={!reverseReason.trim()}'), 'العكس يجب أن يشترط سبباً')
  R.ok('نافذة العكس تعلن الأثر قبل التنفيذ وتشترط سبباً — لا حذف صامت من الدفتر')
}

/* ⑥ لا انحدار: الأنماط القديمة اختفت من صفحة السندات */
{
  assert.ok(!/<Modal[^>]*title="معاينة السند"[^>]*>\s*<div className="space-y-4">/.test(vouchers), 'عادت نافذة بالشكل القديم')
  const oldStyleHits = (vouchers.match(/bg-slate-50 dark:bg-slate-800\/50/g) ?? []).length
  assert.equal(oldStyleHits, 0, 'بقايا الشكل القديم (بطاقات slate) في صفحة السندات')
  R.ok('لا بقايا من الشكل القديم في صفحة السندات — المستند واحد في كل الشاشة')
}

/* ⑦ الطباعة تحمل نفس هوية المستند */
{
  assert.ok(vouchers.includes('printDraft') && vouchers.includes('amountInWords'), 'الطباعة بلا مبلغ بالحروف')
  assert.ok(vouchers.slice(vouchers.indexOf('const printDraft')).includes('#0f2042'), 'الطباعة بلا هوية لونية موحدة')
  R.ok('نسخة الطباعة تحمل هوية المستند نفسها (ألوان وترويسة ومبلغ بالحروف)')
}

R.done('— سندات القبض والصرف صارت مستندات كاملة بلغة الفواتير نفسها، إنشاءً وعرضاً وعكساً وطباعةً')
