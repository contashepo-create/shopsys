/**
 * الموظفون والرواتب — ShopSys (المرحلة 5)
 * ─────────────────────────────────────────
 * منطق خالص: حساب صافي راتب كل موظف (أساسي + بدلات + إضافي − خصومات − سلف)
 * وتوليد قيد المسير المتوازن بنيوياً عبر المحرك الموحد (القرار 9):
 *   - صرف فوري:  من ح/ رواتب وأجور (5102) → إلى ح/ الخزينة أو البنك
 *   - استحقاق:   من ح/ رواتب وأجور (5102) → إلى ح/ رواتب مستحقة (2104)
 *     (يُسدَّد لاحقاً بسند صرف على 2104 من شاشة السندات)
 */
import type { Minor } from './money.ts'
import type { JournalLine } from './ledger.ts'
import { assertBalanced } from './ledger.ts'
import type { TreasuryAccount } from './accounting.ts'

/** طريقة صرف المسير: نقدي فوري من خزينة/بنك، أو استحقاق يُسدد لاحقاً */
export type PayrollPayMode = 'cash' | 'accrue'

/** سطر مسير رواتب لموظف واحد — كل المبالغ Minor */
export interface PayrollLineInput {
  employeeId: number
  baseMinor: Minor // الراتب الأساسي
  allowancesMinor: Minor // بدلات (سكن، مواصلات…)
  overtimeMinor: Minor // إضافي
  deductionsMinor: Minor // خصومات (جزاءات، غياب…) — يختار المالك كم يخصم هذا الشهر
  advancesMinor: Minor // سلف مستقطعة هذا الشهر (المالك حر: كلها أو جزء على عدة رواتب)
  /** مستحق زيادة مصاريف العهدة يُصرف مع الراتب (تصفية 2107) — لا يدخل مصروف الرواتب */
  excessPaidMinor?: Minor
  /**
   * عمولات الموظف المستحقة تُصرف مع الراتب (تصفية 2116) — لا تدخل مصروف الرواتب
   * لأنها حُمِّلت مصروفاً (5117) لحظة استحقاقها على عمليتها (طلب المالك: ربحية سليمة)
   */
  commissionsPaidMinor?: Minor
}

export interface PayrollLineComputed extends PayrollLineInput {
  grossMinor: Minor // أساسي + بدلات + إضافي
  netMinor: Minor // الإجمالي − خصومات − سلف
}

export interface PayrollTotals {
  employeeCount: number
  grossMinor: Minor
  deductionsMinor: Minor // خصومات + سلف معاً
  netMinor: Minor
  excessPaidMinor: Minor // مستحقات زيادة العهد المصروفة مع الرواتب
  commissionsPaidMinor: Minor // عمولات موظفين مصروفة مع الرواتب (تصفية 2116)
}

/** حساب سطر واحد — يرمي خطأ لو خرج الصافي سالباً (خصومات أكبر من الراتب) */
export function computePayrollLine(input: PayrollLineInput): PayrollLineComputed {
  const normalized = { ...input, excessPaidMinor: input.excessPaidMinor ?? 0, commissionsPaidMinor: input.commissionsPaidMinor ?? 0 }
  for (const [k, v] of Object.entries(normalized)) {
    if (k !== 'employeeId' && (!Number.isInteger(v) || (v as number) < 0)) {
      throw new Error(`قيمة «${k}» يجب أن تكون رقماً صحيحاً موجباً`)
    }
  }
  const grossMinor = normalized.baseMinor + normalized.allowancesMinor + normalized.overtimeMinor
  const netMinor = grossMinor - normalized.deductionsMinor - normalized.advancesMinor
  if (netMinor < 0) throw new Error('الخصومات والسلف أكبر من إجمالي الراتب — الصافي لا يكون سالباً')
  return { ...normalized, grossMinor, netMinor }
}

export function computePayrollTotals(lines: PayrollLineComputed[]): PayrollTotals {
  return {
    employeeCount: lines.length,
    grossMinor: lines.reduce((a, l) => a + l.grossMinor, 0),
    deductionsMinor: lines.reduce((a, l) => a + l.deductionsMinor + l.advancesMinor, 0),
    netMinor: lines.reduce((a, l) => a + l.netMinor, 0),
    excessPaidMinor: lines.reduce((a, l) => a + (l.excessPaidMinor ?? 0), 0),
    commissionsPaidMinor: lines.reduce((a, l) => a + (l.commissionsPaidMinor ?? 0), 0),
  }
}

/**
 * التحقق قبل الترحيل: شهر صالح YYYY-MM، لا مسير مكرر لنفس الشهر،
 * سطر واحد على الأقل، وصافي إجمالي أكبر من صفر
 */
export function validatePayrollRun(args: {
  month: string
  lines: PayrollLineComputed[]
  existingMonths: string[]
}): string[] {
  const errors: string[] = []
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(args.month)) errors.push('صيغة الشهر يجب أن تكون YYYY-MM')
  else if (args.existingMonths.includes(args.month)) errors.push(`يوجد مسير رواتب مرحّل بالفعل لشهر ${args.month}`)
  if (args.lines.length === 0) errors.push('المسير فارغ — أضف موظفاً واحداً على الأقل')
  const net = args.lines.reduce((a, l) => a + l.netMinor, 0)
  if (args.lines.length > 0 && net <= 0) errors.push('صافي المسير يجب أن يكون أكبر من صفر')
  return errors
}

/**
 * قيد مسير الرواتب — بالصافي المستحق للموظفين:
 * نقدي:    من ح/ 5102 رواتب وأجور (بالصافي + السلف المستردة)  إلى ح/ الخزينة + 1107 سلف مستردة
 * استحقاق: من ح/ 5102  إلى ح/ 2104 رواتب مستحقة + 1107
 * السلف المستقطعة (advancesRecoveredMinor) تُقفل من حساب «سلف وعهد الموظفين» (1107)
 * فيتصفّر رصيد الموظف تلقائياً في كشف حسابه (طلب المالك)
 */
export function buildPayrollEntry(
  netMinor: Minor,
  mode: PayrollPayMode,
  payAccount: TreasuryAccount, // خزينة/بنك — أو 1108 لو الصرف من عهدة موظف (طلب المالك)
  monthLabel: string,
  advancesRecoveredMinor: Minor = 0,
  excessPaidMinor: Minor = 0,
  commissionsPaidMinor: Minor = 0,
): JournalLine[] {
  if (netMinor <= 0) throw new Error('صافي المسير يجب أن يكون أكبر من صفر')
  if (advancesRecoveredMinor < 0) throw new Error('السلف المستردة لا تكون سالبة')
  if (excessPaidMinor < 0) throw new Error('مستحقات العهد المصروفة لا تكون سالبة')
  if (commissionsPaidMinor < 0) throw new Error('العمولات المصروفة لا تكون سالبة')
  const creditAccount = mode === 'cash' ? payAccount : '2104'
  const lines: JournalLine[] = [
    // المصروف = الصافي المدفوع + السلف المستردة (كانت مصروفة مسبقاً من 1107 كأصل)
    { accountCode: '5102', debit: netMinor + advancesRecoveredMinor, credit: 0, note: `رواتب شهر ${monthLabel}` },
    { accountCode: creditAccount, debit: 0, credit: netMinor + excessPaidMinor + commissionsPaidMinor, note: mode === 'cash' ? 'صرف نقدي' : 'استحقاق يُسدد لاحقاً' },
  ]
  if (excessPaidMinor > 0) {
    // تصفية مستحق الموظف عن زيادة مصاريف عهدته (تجمّع على 2107 عند تسجيل المصروف)
    lines.push({ accountCode: '2107', debit: excessPaidMinor, credit: 0, note: 'صرف مستحق زيادة مصاريف العهدة مع الراتب' })
  }
  if (commissionsPaidMinor > 0) {
    // تصفية عمولات الموظفين المستحقة (تجمّعت على 2116 عند استحقاقها على عملياتها)
    lines.push({ accountCode: '2116', debit: commissionsPaidMinor, credit: 0, note: 'صرف عمولات مستحقة مع الراتب' })
  }
  if (advancesRecoveredMinor > 0) {
    lines.push({ accountCode: '1107', debit: 0, credit: advancesRecoveredMinor, note: 'استرداد سلف الموظفين' })
  }
  assertBalanced(lines)
  return lines
}

/** تسمية الشهر بالعربية: 2026-09 → «سبتمبر 2026» */
const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']
export function monthLabelAr(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month)
  if (!m) return month
  return `${MONTHS_AR[Number(m[2]) - 1]} ${m[1]}`
}
