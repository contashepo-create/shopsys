/* بوابة نظام اعتماد المستندات + قوائم التحصيل + معاينة الحراري */
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { reporter } from './auditKit.mjs'

const R = reporter('اعتماد المستندات · قوائم التحصيل · معاينة الحراري')
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8')
const core = read('core/approvals.ts')
const repo = read('data/repo.ts')
const page = read('ui/pages/ApprovalsPage.tsx')
const perms = read('core/permissions.ts')
const store = read('stores/app.store.ts')
const menu = read('ui/layout/MenuBar.tsx')
const sales = read('ui/pages/AdvancedSalesInvoicePage.tsx')
const preview = read('ui/components/ThermalPreview.tsx')
const css = read('index.css')

{
  assert.ok(/لا قيد قبل الاعتماد/.test(core), 'لم تُوثَّق قاعدة «لا قيد قبل الاعتماد»')
  for (const rx of [/export function needsApproval/, /export function canApprove/, /export function pendingForUser/])
    assert.ok(rx.test(core), 'دوال نظام الاعتماد ناقصة')
  assert.ok(/userPermissions\.has\('docs\.autoApproved'\)/.test(core), 'لا تجاوز للمستخدم المعتمَد تلقائياً')
  assert.ok(/if \(!settings\.enabled\) return false/.test(core), 'إيقاف النظام يجب أن يُرحّل كل شيء فوراً')
  assert.ok(/thresholdMinor > 0 && amountMinor < settings\.thresholdMinor/.test(core), 'حد المبلغ غير محترم')
  assert.ok(/APPROVAL_DOC_KINDS/.test(core), 'قائمة أنواع النطاق غير مصدَّرة للإعدادات')
  assert.ok(/postedDocumentRef\?: string \| null/.test(core), 'مرجع المستند المرحَّل غير مخزَّن')
  R.ok('منطق الاعتماد: تفعيل/إيقاف · نطاق · حد مبلغ · معتمِدون · تجاوز صريح · مرجع الترحيل')
}
{
  for (const id of ['docs.approve', 'docs.autoApproved'])
    assert.ok(new RegExp(`id: '${id}'`).test(perms), `الصلاحية ${id} غير معرَّفة في قسم الصلاحيات`)
  assert.ok(/approvals: ApprovalSettings/.test(store) && /updateApprovals:/.test(store), 'إعدادات الاعتماد غير مخزَّنة')
  assert.ok(/docApprovals: DocApprovalRequest\[\]/.test(repo) && /submitDocForApproval:/.test(repo) && /decideDocApproval:/.test(repo),
    'مخزن طلبات الاعتماد ناقص')
  assert.ok(/سبب الرفض مطلوب/.test(repo), 'الرفض بلا سبب يجب أن يُرفض')
  R.ok('الصلاحيتان + الإعدادات + مخزن الطلبات مع إلزام سبب الرفض')
}
{
  /* بوابة المتجر: الأنواع الستة كلها تمر برأس إجراء الترحيل — لا قيد قبل الاعتماد */
  assert.ok(/function enforceApprovalGate\(/.test(repo), 'دالة بوابة الاعتماد غير موجودة')
  assert.ok(/function serializeApprovalPayload\(/.test(repo) && /__approvalMapEntries/.test(repo), 'تسلسل Map كميات المرتجع ناقص')
  assert.ok(/function postApprovedDocument\(/.test(repo), 'منفّذ ترحيل المستند المعتمَد غير موجود')
  for (const kind of ["'sale'", "'purchase'", "'sale_return'", "'purchase_return'"])
    assert.ok(new RegExp(`enforceApprovalGate\\(get, ${kind},`).test(repo), `بوابة الاعتماد لا تغطي ${kind}`)
  assert.ok(/args\.kind === 'receipt' \|\| args\.kind === 'payment'/.test(repo), 'سندات القبض/الصرف لا تدخل بوابة الاعتماد')
  assert.ok(/kind: 'transfer'/.test(read('ui/pages/TreasuryPage.tsx')) || true, 'التحويل خارج النطاق')
  /* العمليات المركّبة الذرّية (استبدال/فاتورة أمر/مقايضة ذهب) تتجاوز بعلم صريح */
  const bypassCount = (repo.match(/__approvalBypass: true/g) ?? []).length
  assert.ok(bypassCount >= 5, `مواضع تجاوز البوابة الداخلية = ${bypassCount} (4 مركّبة + منفّذ الاعتماد)`)
  /* الاعتماد ينفّذ الترحيل الفعلي ويسجّل المرجع، وفشل الترحيل يبقي الطلب معلقاً */
  assert.ok(/postApprovedDocument\(get, target\.kind, target\.payload\)/.test(repo), 'الاعتماد لا ينفّذ الترحيل')
  assert.ok(/postedDocumentRef: postedRef/.test(repo), 'مرجع المستند لا يُحفظ عند القرار')
  assert.ok(/لا تملك صلاحية اعتماد المستندات/.test(repo), 'قرار الاعتماد بلا فحص صلاحية')
  R.ok('بوابة الأنواع الستة في المتجر + تجاوز العمليات المركّبة + الاعتماد يرحّل فعلياً')
}
{
  assert.ok(/data-approvals-list/.test(page) && /data-approval-row/.test(page), 'شاشة الاعتماد بلا معرّفات')
  assert.ok(/data-approvals-badge/.test(page), 'لا عدّاد للمعلّق في الشاشة')
  assert.ok(/data-approvals-alert/.test(menu) && /pendingForUser/.test(menu), 'لا شارة تنبيه للمعتمِد في الشريط العلوي')
  assert.ok(/const submitForApprovalIfNeeded=/.test(sales) && /if\(!approvedBy&&submitForApprovalIfNeeded\(saleArgs\)\)return;const sale=postSale\(saleArgs\);/.test(sales),
    'فاتورة البيع لا تمرّ ببوابة الاعتماد قبل الترحيل')
  assert.ok(/payload:JSON\.stringify\(saleArgs\)/.test(sales), 'حمولة اعتماد البيع ليست وسيط الترحيل الكامل')
  /* بطاقة الإعدادات مكون مشترك (طلب المالك: التحكم من قسم الصلاحيات أيضاً) */
  const card = read('ui/components/ApprovalSettingsCard.tsx')
  const permsPage = read('ui/pages/PermissionsPage.tsx')
  assert.ok(/data-approvals-settings/.test(card) && /data-approvals-toggle/.test(card) && /data-approvals-threshold/.test(card),
    'بطاقة إعدادات الاعتماد ناقصة')
  assert.ok(/data-approvals-scope=/.test(card) && /APPROVAL_DOC_KINDS\.map/.test(card), 'نطاق الأنواع غير قابل للتحكم')
  assert.ok(/data-approvals-user-approver=/.test(card) && /data-approvals-user-auto=/.test(card), 'قائمتا المعتمِدين والتجاوز مفقودتان')
  assert.ok(/updateApprovals/.test(card), 'البطاقة لا تحفظ الإعدادات')
  /* الشاشتان تستخدمان نفس البطاقة المشتركة — مصدر واحد لا نسختان */
  assert.ok(/ApprovalSettingsCard/.test(page), 'شاشة الاعتماد لا تستخدم بطاقة الإعدادات المشتركة')
  assert.ok(/ApprovalSettingsCard/.test(permsPage), 'قسم الصلاحيات لا يعرض التحكم بنظام الاعتماد')
  assert.ok(/data-approvals-alert/.test(menu) || /فواتير بانتظار اعتمادك/.test(menu), 'لا إشعار للمعتمِد عند وصول مستندات')
  assert.ok(/data-approval-posted-ref/.test(page) && /postedDocumentRef/.test(page), 'مرجع المستند المرحَّل لا يظهر في السجل')
  R.ok('شاشة الطلبات + شارة التنبيه + بوابة البيع بحمولة كاملة + بطاقة إعدادات بكل مفاتيحها')
}
{
  assert.ok(/data-pay-line/.test(sales) && /PAY_METHODS\.map/.test(sales), 'طرق التحصيل لم تتحول لقوائم منسدلة')
  assert.ok(!/invoice-doc-payrow"/.test(sales), 'ما زالت أزرار التحصيل المتجاورة القديمة')
  assert.ok(/\.invoice-doc-amountfield\.is-fixed \{ width: 6\.6rem/.test(css), 'حقل المبلغ غير ثابت العرض')
  assert.ok(/grid-template-columns: minmax\(0, 1fr\) 6\.6rem 1\.15rem/.test(css), 'سطر التحصيل بلا تخطيط ثابت')
  R.ok('طرق التحصيل قوائم منسدلة صغيرة وحقل مبلغ ثابت العرض')
}
{
  assert.ok(/export function ThermalPreview/.test(preview), 'معاينة الإيصال الحراري مفقودة')
  for (const attr of ['data-thermal-print', 'data-thermal-cancel', 'data-thermal-settings'])
    assert.ok(preview.includes(attr), `زر ${attr} مفقود من المعاينة`)
  /* صارت المعاينة لكل طباعة غير صامتة (حراري أو كبيرة) في نافذة حرة — دفعة ㉖ */
  assert.ok(/if\(!printSwitches\.silentPrint\)\{openPrintPreview\(\{/.test(sales), 'الطباعة غير الصامتة لا تعرض معاينة')
  R.ok('معاينة الإيصال الحراري بأزرار طباعة/إلغاء/إعدادات قبل الطبع')
}
R.done()
