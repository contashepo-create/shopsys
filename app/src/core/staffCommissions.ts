/**
 * عمولات الموظفين — نواة خالصة (طلب المالك):
 * ─────────────────────────────────────────
 * موظف يسجل عملية (إيجار عقار / بيع عقار / فاتورة بيع / أي مستند) وله عمولة عنها:
 *   استحقاق: مدين 5117 مصروف عمولات موظفين ← دائن 2116 عمولات موظفين مستحقة
 *   ⇒ تُحمّل مصروفاً لحظة الاستحقاق فتدخل ربحية الفترة (والعملية) بشكل سليم
 *   صرف منفرد: مدين 2116 ← دائن خزينة/بنك
 *   صرف مع الراتب: سطر 2116 مدين داخل قيد مسير الرواتب (تصفية مع الصافي)
 *   إلغاء: عكس الاستحقاق (2116 مدين ← 5117 دائن) — يُرفض إن كانت مصروفة
 *   تعديل: إلغاء ثم استحقاق جديد بالمبلغ الصحيح (أثر تدقيقي كامل)
 *
 * المعيار العالمي (Odoo Commissions / Zoho People / برامج الوساطة العقارية):
 * العمولة مستند مستقل مربوط بمصدرها + حالة دورة حياة + تتبع صرف — وهذا ما ننفذه.
 */
import type { Minor } from './money.ts'
import type { JournalLine } from './ledger.ts'
import { assertBalanced } from './ledger.ts'

/* حسابات النظام */
export const STAFF_COMMISSION_EXPENSE = '5117' // مصروف عمولات موظفين
export const STAFF_COMMISSION_PAYABLE = '2116' // عمولات موظفين مستحقة

/** مصدر العمولة — أي مستند في النظام يمكن أن يولد عمولة موظف */
export type StaffCommissionSource =
  | 'lease' // عقد إيجار عقار
  | 'property_sale' // بيع عقار
  | 'sale' // فاتورة بيع
  | 'car_sale' // بيع سيارة
  | 'project' // مشروع مقاولات
  | 'manual' // يدوية (مكافأة عملية بلا مستند)

export const STAFF_COMMISSION_SOURCE_LABELS: Record<StaffCommissionSource, string> = {
  lease: 'عقد إيجار',
  property_sale: 'بيع عقار',
  sale: 'فاتورة بيع',
  car_sale: 'بيع سيارة',
  project: 'مشروع مقاولات',
  manual: 'يدوية',
}

export type StaffCommissionStatus = 'accrued' | 'paid' | 'cancelled'

export const STAFF_COMMISSION_STATUS_LABELS: Record<StaffCommissionStatus, { nameAr: string; icon: string }> = {
  accrued: { nameAr: 'مستحقة', icon: '⏳' },
  paid: { nameAr: 'مصروفة', icon: '✅' },
  cancelled: { nameAr: 'ملغاة', icon: '🚫' },
}

/** عمولة موظف — مستند مستقل بدورة حياة كاملة */
export interface StaffCommission {
  id: number
  code: string // SCM-0001
  employeeId: number
  source: StaffCommissionSource
  /** معرف المستند المصدر (عقد الإيجار/فاتورة البيع…) — null لليدوية */
  sourceId: number | null
  /** وصف حر يظهر في الكشوف: «عمولة تأجير وحدة A-3 عقد LSE-0007» */
  description: string
  amountMinor: Minor
  /** قيمة الاستحقاق الأصلية وتسويات المرتجعات التراكمية */
  originalAmountMinor?: Minor
  returnAdjustedMinor?: Minor
  date: string
  status: StaffCommissionStatus
  /** قيد الاستحقاق 5117/2116 */
  accrualEntryId: number
  /** قيد الصرف المنفرد أو قيد مسير الرواتب الذي صُرفت ضمنه */
  payoutEntryId: number | null
  /** كيف صُرفت: سند منفرد أم ضمن مسير رواتب */
  payoutMode: 'voucher' | 'payroll' | null
  /** قيد الإلغاء العاكس إن أُلغيت */
  cancelEntryId: number | null
  cancelReason: string
  createdBy: string
  createdAt: string
}

/* ─── تحقق ─── */

export function validateStaffCommission(args: {
  employeeId: number | null
  amountMinor: number
  description: string
}): string[] {
  const errors: string[] = []
  if (args.employeeId == null) errors.push('اختر الموظف صاحب العمولة')
  if (!Number.isInteger(args.amountMinor) || args.amountMinor <= 0) errors.push('مبلغ العمولة يجب أن يكون رقماً صحيحاً أكبر من صفر')
  if (!args.description.trim()) errors.push('بيان العمولة مطلوب — اذكر العملية المرتبطة')
  return errors
}

/** نسبة عمولة → مبلغ Minor مقرب (لعمولات النسبة من قيمة العملية) */
export function commissionFromPercent(baseMinor: Minor, percent: number): Minor {
  if (!(percent > 0) || percent > 100) throw new Error('نسبة العمولة يجب أن تكون أكبر من 0 وحتى 100')
  if (!Number.isInteger(baseMinor) || baseMinor <= 0) throw new Error('أساس العمولة يجب أن يكون مبلغاً صحيحاً موجباً')
  return Math.round(baseMinor * percent / 100)
}

/* ─── بناء القيود (نقية — كلها assertBalanced) ─── */

/** استحقاق: 5117 مدين ← 2116 دائن — مصروف يدخل الأرباح لحظة الاستحقاق */
export function buildStaffCommissionAccrual(amountMinor: Minor, employeeName: string, label: string): JournalLine[] {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) throw new Error('مبلغ العمولة يجب أن يكون رقماً صحيحاً موجباً')
  const lines: JournalLine[] = [
    { accountCode: STAFF_COMMISSION_EXPENSE, debit: amountMinor, credit: 0, note: `عمولة ${employeeName} — ${label}` },
    { accountCode: STAFF_COMMISSION_PAYABLE, debit: 0, credit: amountMinor, note: `مستحقة لـ${employeeName}` },
  ]
  assertBalanced(lines)
  return lines
}

/** صرف منفرد: 2116 مدين ← خزينة دائن */
export function buildStaffCommissionPayout(amountMinor: Minor, treasury: string, employeeName: string): JournalLine[] {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) throw new Error('مبلغ الصرف يجب أن يكون رقماً صحيحاً موجباً')
  const lines: JournalLine[] = [
    { accountCode: STAFF_COMMISSION_PAYABLE, debit: amountMinor, credit: 0, note: `صرف عمولة ${employeeName}` },
    { accountCode: treasury, debit: 0, credit: amountMinor, note: 'صرف نقدي' },
  ]
  assertBalanced(lines)
  return lines
}

/** إلغاء استحقاق: عكس القيد — 2116 مدين ← 5117 دائن */
export function buildStaffCommissionCancel(amountMinor: Minor, employeeName: string, reason: string): JournalLine[] {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) throw new Error('مبلغ الإلغاء يجب أن يكون رقماً صحيحاً موجباً')
  const lines: JournalLine[] = [
    { accountCode: STAFF_COMMISSION_PAYABLE, debit: amountMinor, credit: 0, note: `إلغاء عمولة ${employeeName}` },
    { accountCode: STAFF_COMMISSION_EXPENSE, debit: 0, credit: amountMinor, note: reason || 'إلغاء استحقاق عمولة' },
  ]
  assertBalanced(lines)
  return lines
}

/* ─── استعلامات نقية ─── */

/** مجموع عمولات موظف المستحقة غير المصروفة — يظهر في مسير الرواتب */
export function unpaidCommissionsMinor(commissions: readonly StaffCommission[], employeeId: number): Minor {
  return commissions
    .filter((c) => c.employeeId === employeeId && c.status === 'accrued')
    .reduce((a, c) => a + c.amountMinor, 0)
}

/** العمولات المستحقة لموظف (لصرفها مع الراتب أو منفردة) */
export function accruedCommissionsFor(commissions: readonly StaffCommission[], employeeId: number): StaffCommission[] {
  return commissions.filter((c) => c.employeeId === employeeId && c.status === 'accrued')
}
