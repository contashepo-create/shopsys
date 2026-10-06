/**
 * قسائم الرواتب — مسير احترافي لكل موظف على حدة (طلب المالك).
 *
 * المشكلة التي يحلّها: كان المسير قيداً واحداً مُجمَّعاً، فإذا استُحق ولم يُدفع
 * تعذّر معرفة نصيب كل موظف، وتعذّر صرف راتب موظف اليوم وآخر غداً.
 *
 * التصميم المحاسبي (دفتر أستاذ مساعد):
 *   • **الاستحقاق**: قيد واحد للمسير —
 *       مدين 5102 أجور ورواتب (إجمالي المستحق + السلف المستردة)
 *       دائن 2104 رواتب مستحقة — **سطر مستقل لكل موظف** يحمل اسمه ورقم قسيمته
 *       دائن 1107 سلف الموظفين (بما استُرد منها)
 *   • **الصرف**: لكل قسيمة قيدها المستقل —
 *       مدين 2104 بصافي القسيمة ← دائن الخزينة/البنك
 *   فيبقى رصيد 2104 = مجموع القسائم غير المصروفة، والتفصيل في هذا الدفتر المساعد.
 */
import type { Minor } from './money.ts'
import { assertBalanced, type JournalLine } from './ledger.ts'

export type PayrollSlipStatus = 'accrued' | 'paid' | 'cancelled'

export interface PayrollSlip {
  id: number
  slipNumber: string // PS-0001
  runId: number
  month: string // YYYY-MM
  employeeId: number
  employeeName: string
  /** الأساسي والبدلات والعمولات قبل الخصومات */
  grossMinor: Minor
  allowancesMinor: Minor
  /** خصومات (غياب · تأخير · جزاءات) */
  deductionsMinor: Minor
  /** سلف مستقطعة من هذا الراتب */
  advanceMinor: Minor
  /** الصافي المستحق للموظف */
  netMinor: Minor
  status: PayrollSlipStatus
  accruedAt: string
  accrualEntryId: number
  paidAt?: string | null
  paidEntryId?: number | null
  paidFrom?: string | null
  notes?: string
  /** §93: الجزاءات المسجلة التي خُصمت بهذه القسيمة (الأقدم أولاً) — تُعكس عند الإلغاء */
  recoveredDeductions?: { deductionId: number; minor: number }[]
}

export const slipNetMinor = (row: { grossMinor: Minor; allowancesMinor: Minor; deductionsMinor: Minor; advanceMinor: Minor }): Minor =>
  Math.max(0, row.grossMinor + row.allowancesMinor - row.deductionsMinor - row.advanceMinor)

export function slipsTotals(slips: PayrollSlip[]): { gross: Minor; deductions: Minor; advances: Minor; net: Minor; unpaid: Minor } {
  return slips.reduce(
    (sum, slip) => ({
      gross: sum.gross + slip.grossMinor + slip.allowancesMinor,
      deductions: sum.deductions + slip.deductionsMinor,
      advances: sum.advances + slip.advanceMinor,
      net: sum.net + slip.netMinor,
      unpaid: sum.unpaid + (slip.status === 'accrued' ? slip.netMinor : 0),
    }),
    { gross: 0, deductions: 0, advances: 0, net: 0, unpaid: 0 },
  )
}

/** قانون العمل: لا يُخصم من الراتب أكثر من نصفه دون اعتماد صريح */
export function validateSlipDraft(row: {
  employeeId: number
  grossMinor: Minor
  allowancesMinor: Minor
  deductionsMinor: Minor
  advanceMinor: Minor
  overrideBy?: string | null
}): string[] {
  const errors: string[] = []
  if (!row.employeeId) errors.push('اختر الموظف')
  if (row.grossMinor <= 0) errors.push('الراتب الأساسي يجب أن يكون أكبر من صفر')
  for (const [value, label] of [[row.allowancesMinor, 'البدلات'], [row.deductionsMinor, 'الخصومات'], [row.advanceMinor, 'السلف المستقطعة']] as const)
    if (value < 0) errors.push(`${label} لا تكون سالبة`)
  const base = row.grossMinor + row.allowancesMinor
  if (!row.overrideBy && row.deductionsMinor + row.advanceMinor > Math.round(base / 2))
    errors.push('إجمالي الخصم والسلف يتجاوز نصف الراتب — يحتاج اعتماد مشرف')
  return errors
}

/** قيد استحقاق المسير: سطر دائن مستقل لكل موظف على 2104 */
export function buildSlipAccrualLines(
  slips: { employeeName: string; slipNumber: string; netMinor: Minor; advanceMinor: Minor }[],
  monthLabel: string,
): JournalLine[] {
  if (!slips.length) throw new Error('لا قسائم في المسير')
  const net = slips.reduce((sum, slip) => sum + slip.netMinor, 0)
  const advances = slips.reduce((sum, slip) => sum + slip.advanceMinor, 0)
  if (net <= 0) throw new Error('صافي المسير يجب أن يكون أكبر من صفر')
  const lines: JournalLine[] = [
    { accountCode: '5102', debit: net + advances, credit: 0, note: `استحقاق رواتب ${monthLabel}` },
    ...slips.map((slip) => ({
      accountCode: '2104', debit: 0, credit: slip.netMinor,
      note: `${slip.slipNumber} — ${slip.employeeName}`,
    })),
  ]
  if (advances > 0) lines.push({ accountCode: '1107', debit: 0, credit: advances, note: 'استقطاع سلف الموظفين من الرواتب' })
  assertBalanced(lines)
  return lines
}

/** قيد صرف قسيمة واحدة: مدين 2104 بصافيها ← دائن الخزينة */
export function buildSlipPaymentLines(slip: { slipNumber: string; employeeName: string; netMinor: Minor }, payAccount: string): JournalLine[] {
  if (slip.netMinor <= 0) throw new Error('لا يمكن صرف قسيمة بصافٍ صفر')
  const lines: JournalLine[] = [
    { accountCode: '2104', debit: slip.netMinor, credit: 0, note: `صرف ${slip.slipNumber} — ${slip.employeeName}` },
    { accountCode: payAccount, debit: 0, credit: slip.netMinor, note: `صرف راتب ${slip.employeeName}` },
  ]
  assertBalanced(lines)
  return lines
}
