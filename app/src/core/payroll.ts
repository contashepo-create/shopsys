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
  deductionsMinor: Minor // خصومات (جزاءات، غياب…)
  advancesMinor: Minor // سلف مستقطعة
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
}

/** حساب سطر واحد — يرمي خطأ لو خرج الصافي سالباً (خصومات أكبر من الراتب) */
export function computePayrollLine(input: PayrollLineInput): PayrollLineComputed {
  for (const [k, v] of Object.entries(input)) {
    if (k !== 'employeeId' && (!Number.isInteger(v) || v < 0)) {
      throw new Error(`قيمة «${k}» يجب أن تكون رقماً صحيحاً موجباً`)
    }
  }
  const grossMinor = input.baseMinor + input.allowancesMinor + input.overtimeMinor
  const netMinor = grossMinor - input.deductionsMinor - input.advancesMinor
  if (netMinor < 0) throw new Error('الخصومات والسلف أكبر من إجمالي الراتب — الصافي لا يكون سالباً')
  return { ...input, grossMinor, netMinor }
}

export function computePayrollTotals(lines: PayrollLineComputed[]): PayrollTotals {
  return {
    employeeCount: lines.length,
    grossMinor: lines.reduce((a, l) => a + l.grossMinor, 0),
    deductionsMinor: lines.reduce((a, l) => a + l.deductionsMinor + l.advancesMinor, 0),
    netMinor: lines.reduce((a, l) => a + l.netMinor, 0),
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
 * نقدي:    من ح/ 5102 رواتب وأجور  إلى ح/ الخزينة (1101/1102)
 * استحقاق: من ح/ 5102 رواتب وأجور  إلى ح/ 2104 رواتب مستحقة
 */
export function buildPayrollEntry(
  netMinor: Minor,
  mode: PayrollPayMode,
  treasury: TreasuryAccount,
  monthLabel: string,
): JournalLine[] {
  if (netMinor <= 0) throw new Error('صافي المسير يجب أن يكون أكبر من صفر')
  const creditAccount = mode === 'cash' ? treasury : '2104'
  const lines: JournalLine[] = [
    { accountCode: '5102', debit: netMinor, credit: 0, note: `رواتب شهر ${monthLabel}` },
    { accountCode: creditAccount, debit: 0, credit: netMinor, note: mode === 'cash' ? 'صرف نقدي' : 'استحقاق يُسدد لاحقاً' },
  ]
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
