/**
 * إيجار المعدات الثقيلة (المرحلة 6 — القرار 13):
 * العقد وحدة العمل: معدة × أيام × سعر يومي + تأمين مسترد.
 * قيد الفتح: تحصيل (خزينة/عملاء) مقابل إيراد إيجار 4104 + ض.ق.م 2102
 * + تأمينات مستردة 2103 (التزام). قيد الإقفال: ردّ التأمين من الخزينة،
 * مع إمكان الخصم منه (أضرار) يُعترف به إيراداً في 4104.
 * نواة خالصة بلا واجهات — كل الأموال أعداد صحيحة (Minor).
 */
import type { Minor } from './money.ts'
import { assertBalanced, type JournalLine } from './ledger.ts'

export interface RentalInput {
  equipmentName: string
  days: number
  dailyRateMinor: Minor
  depositMinor: Minor // تأمين مسترد — لا يدخل الإيراد
  payment: 'cash' | 'credit' // تحصيل قيمة الإيجار (التأمين نقدي دائماً)
  vatPercent: number // تُضاف فوق قيمة الإيجار
}

export interface RentalTotals {
  rentMinor: Minor // days × dailyRate
  vatMinor: Minor
  grandMinor: Minor // rent + vat (المستحق عن الإيجار)
  depositMinor: Minor
  collectCashMinor: Minor // ما يُقبض نقداً عند الفتح
  collectCreditMinor: Minor // ما يُقيَّد على حساب العميل
}

const isPosInt = (n: number) => Number.isInteger(n) && n >= 0

/** تحقق شامل قبل أي حساب — يعيد قائمة أخطاء عربية (فارغة = سليم) */
export function validateRental(input: RentalInput): string[] {
  const errors: string[] = []
  if (!input.equipmentName.trim()) errors.push('حدد المعدة')
  if (!Number.isInteger(input.days) || input.days < 1 || input.days > 3650) errors.push('مدة الإيجار بين يوم و3650 يوماً')
  if (!isPosInt(input.dailyRateMinor) || input.dailyRateMinor <= 0) errors.push('السعر اليومي يجب أن يكون موجباً')
  if (!isPosInt(input.depositMinor)) errors.push('التأمين لا يكون سالباً')
  if (input.vatPercent < 0 || input.vatPercent > 100) errors.push('نسبة الضريبة بين 0 و100')
  return errors
}

/** إجماليات العقد — التأمين يُقبض نقداً دائماً، والإيجار حسب طريقة السداد */
export function computeRentalTotals(input: RentalInput): RentalTotals {
  const rentMinor = Math.round(input.dailyRateMinor * input.days)
  const vatMinor = Math.round((rentMinor * input.vatPercent) / 100)
  const grandMinor = rentMinor + vatMinor
  return {
    rentMinor,
    vatMinor,
    grandMinor,
    depositMinor: input.depositMinor,
    collectCashMinor: input.payment === 'cash' ? grandMinor + input.depositMinor : input.depositMinor,
    collectCreditMinor: input.payment === 'cash' ? 0 : grandMinor,
  }
}

/**
 * قيد فتح العقد المتوازن:
 *   من ح/ 1101 الخزينة (النقدي + التأمين) و/أو 1104 العملاء (الآجل)
 *     إلى ح/ 4104 إيراد إيجار معدات (rent)
 *     إلى ح/ 2102 ض.ق.م (vat)
 *     إلى ح/ 2103 تأمينات مستردة (deposit — التزام لا إيراد)
 */
export function buildRentalOpenEntry(totals: RentalTotals, label: string, treasury = '1101'): JournalLine[] {
  if (totals.rentMinor <= 0) throw new Error('قيمة الإيجار يجب أن تكون موجبة')
  const lines: JournalLine[] = []
  if (totals.collectCashMinor > 0) lines.push({ accountCode: treasury, debit: totals.collectCashMinor, credit: 0, note: `تحصيل ${label}` })
  if (totals.collectCreditMinor > 0) lines.push({ accountCode: '1104', debit: totals.collectCreditMinor, credit: 0, note: `آجل ${label}` })
  lines.push({ accountCode: '4104', debit: 0, credit: totals.rentMinor, note: 'إيراد إيجار معدات' })
  if (totals.vatMinor > 0) lines.push({ accountCode: '2102', debit: 0, credit: totals.vatMinor, note: 'ض.ق.م' })
  if (totals.depositMinor > 0) lines.push({ accountCode: '2103', debit: 0, credit: totals.depositMinor, note: 'تأمين مسترد' })
  assertBalanced(lines)
  return lines
}

/**
 * قيد إقفال العقد (ردّ التأمين):
 *   من ح/ 2103 تأمينات مستردة (كامل التأمين — تصفية الالتزام)
 *     إلى ح/ 1101 الخزينة (المردود للعميل)
 *     إلى ح/ 4104 إيراد إيجار (المخصوم أضراراً/غرامة — يُعترف به إيراداً)
 * يعيد null إذا لا تأمين أصلاً (لا حاجة لقيد).
 */
export function buildRentalCloseEntry(depositMinor: Minor, deductMinor: Minor, label: string, treasury = '1101'): JournalLine[] | null {
  if (!isPosInt(depositMinor) || !isPosInt(deductMinor)) throw new Error('قيم التأمين والخصم لا تكون سالبة')
  if (deductMinor > depositMinor) throw new Error('الخصم لا يتجاوز التأمين المحصَّل')
  if (depositMinor === 0) return null
  const refund = depositMinor - deductMinor
  const lines: JournalLine[] = [
    { accountCode: '2103', debit: depositMinor, credit: 0, note: `تصفية تأمين ${label}` },
  ]
  if (refund > 0) lines.push({ accountCode: treasury, debit: 0, credit: refund, note: 'ردّ التأمين للعميل' })
  if (deductMinor > 0) lines.push({ accountCode: '4104', debit: 0, credit: deductMinor, note: 'خصم من التأمين (أضرار/غرامة)' })
  assertBalanced(lines)
  return lines
}

/* ─── تقرير الإيجارات ─── */

export interface RentalReportRow {
  contractId: number
  contractNumber: string
  date: string
  customerId: number | null
  equipmentName: string
  days: number
  rentMinor: Minor
  depositMinor: Minor
  status: 'active' | 'closed'
}

export function rentalReport(
  contracts: {
    id: number
    contractNumber: string
    date: string
    customerId: number | null
    equipmentName: string
    days: number
    status: 'active' | 'closed'
    totals: RentalTotals
  }[],
  period: { from: string; to: string },
): { rows: RentalReportRow[]; totalRentMinor: Minor; activeCount: number; heldDepositsMinor: Minor } {
  const rows: RentalReportRow[] = []
  for (const c of contracts) {
    const d = c.date.slice(0, 10)
    if (d < period.from || d > period.to) continue
    rows.push({
      contractId: c.id,
      contractNumber: c.contractNumber,
      date: d,
      customerId: c.customerId,
      equipmentName: c.equipmentName,
      days: c.days,
      rentMinor: c.totals.rentMinor,
      depositMinor: c.totals.depositMinor,
      status: c.status,
    })
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.contractId - b.contractId))
  return {
    rows,
    totalRentMinor: rows.reduce((a, r) => a + r.rentMinor, 0),
    activeCount: rows.filter((r) => r.status === 'active').length,
    // التأمينات المحتجزة = تأمينات العقود النشطة فقط (المقفلة صُفّيت)
    heldDepositsMinor: rows.filter((r) => r.status === 'active').reduce((a, r) => a + r.depositMinor, 0),
  }
}

/* ─── معدل الاستغلال (نمط Point of Rental/EZRentOut: utilization rate) ───
   نسبة الأيام المؤجَّرة من أيام الفترة لكل معدة — المعدة الراكدة تظهر فوراً */

export interface UtilizationRow {
  equipmentId: number
  equipmentName: string
  rentedDays: number
  periodDays: number
  utilizationPercent: number // 0..100
  revenueMinor: Minor
}

export function utilizationReport(
  contracts: {
    equipmentId: number | null
    equipmentName: string
    date: string
    days: number
    rateType?: 'hourly' | 'daily' | 'monthly'
    totals: RentalTotals
  }[],
  equipment: { id: number; nameAr: string; isActive?: boolean }[],
  period: { from: string; to: string },
): UtilizationRow[] {
  const periodDays = Math.max(1, daysBetweenIso(period.from, period.to) + 1)
  const rows: UtilizationRow[] = []
  for (const eq of equipment) {
    if (eq.isActive === false) continue
    let rented = 0
    let revenue = 0
    for (const c of contracts) {
      if (c.equipmentId !== eq.id) continue
      // مدة العقد بالأيام (الساعي: نسبة من يوم، الشهري: 30 يوماً للوحدة)
      const contractDays = (c.rateType ?? 'daily') === 'hourly' ? c.days / 24 : (c.rateType ?? 'daily') === 'monthly' ? c.days * 30 : c.days
      const start = c.date.slice(0, 10)
      const end = rentalExpectedEnd(c.date, c.days, c.rateType ?? 'daily').slice(0, 10)
      // التقاطع مع الفترة
      const s0 = start > period.from ? start : period.from
      const e0 = end < period.to ? end : period.to
      if (s0 > e0) continue
      const overlap = Math.min(contractDays, daysBetweenIso(s0, e0) + 1)
      rented += overlap
      revenue += c.totals.rentMinor
    }
    rows.push({
      equipmentId: eq.id,
      equipmentName: eq.nameAr,
      rentedDays: Math.round(rented * 10) / 10,
      periodDays,
      utilizationPercent: Math.min(100, Math.round((rented / periodDays) * 100)),
      revenueMinor: revenue,
    })
  }
  rows.sort((a, b) => b.utilizationPercent - a.utilizationPercent)
  return rows
}

function daysBetweenIso(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000)
}

/* ─── جولة مراجعة إيجار المعدات (الطلبات 6–9): تجاوز المدة ─── */

/** نهاية العقد المتوقعة حسب نوع التسعير: ساعات تُحوَّل زمنياً، أيام وأشهر تقويمياً */
export function rentalExpectedEnd(dateIso: string, units: number, rateType: 'hourly' | 'daily' | 'monthly'): string {
  const d = new Date(dateIso)
  if (rateType === 'hourly') d.setTime(d.getTime() + units * 3_600_000)
  else if (rateType === 'daily') d.setDate(d.getDate() + units)
  else d.setMonth(d.getMonth() + units)
  return d.toISOString()
}

/** عقد نشط تجاوزت الساعةُ الحالية نهايتَه المتوقعة = متأخر عن الإرجاع */
export function isRentalOverdue(
  contract: { status: string; date: string; days: number; rateType?: 'hourly' | 'daily' | 'monthly' },
  nowIso: string,
): boolean {
  if (contract.status !== 'active') return false
  return nowIso > rentalExpectedEnd(contract.date, contract.days, contract.rateType ?? 'daily')
}
