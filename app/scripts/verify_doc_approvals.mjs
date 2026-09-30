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
  R.ok('منطق الاعتماد: تفعيل/إيقاف · نطاق · حد مبلغ · معتمِدون · تجاوز صريح')
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
  assert.ok(/data-approvals-list/.test(page) && /data-approval-row/.test(page), 'شاشة الاعتماد بلا معرّفات')
  assert.ok(/data-approvals-badge/.test(page), 'لا عدّاد للمعلّق في الشاشة')
  assert.ok(/data-approvals-alert/.test(menu) && /pendingForUser/.test(menu), 'لا شارة تنبيه للمعتمِد في الشريط العلوي')
  assert.ok(/const submitForApprovalIfNeeded=/.test(sales) && /if\(!approvedBy&&submitForApprovalIfNeeded\(\)\)return;/.test(sales),
    'فاتورة البيع لا تمرّ ببوابة الاعتماد قبل الترحيل')
  R.ok('شاشة الطلبات + شارة التنبيه + بوابة الاعتماد في فاتورة البيع')
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
  assert.ok(/if\(!printSwitches\.silentPrint\)\{setThermalPreview\(/.test(sales), 'الطباعة غير الصامتة لا تعرض معاينة')
  R.ok('معاينة الإيصال الحراري بأزرار طباعة/إلغاء/إعدادات قبل الطبع')
}
R.done()
