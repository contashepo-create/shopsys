/**
 * اللوجستيات (النقلات) — ShopSys (المرحلة 6)
 * ─────────────────────────────────────────────
 * المفاهيم منقولة ومكيّفة من مشروع logistics-web (القرار 13):
 * - النقلة وحدة العمل: من/إلى، مركبة، سائق، عدد × سعر النقلة، أرقام حاويات
 * - مصاريف النقلة بمصادر تمويل: نقدي (من الخزينة فوراً)،
 *   على العميل (تُضاف لفاتورته)، آجل (ذمة مورد/محطة)
 * - ربحية لكل نقلة: الإيراد − المصاريف المباشرة والآجلة
 * كل نقلة تُرحَّل بقيد واحد متوازن بنيوياً في الدفتر الموحد:
 *   4105 إيرادات نقلات / 5106 مصروفات نقلات (القرار 9)
 */
import type { Minor } from './money.ts'
import type { JournalLine } from './ledger.ts'
import { assertBalanced } from './ledger.ts'

/** مصدر تمويل مصروف النقلة (نمط logistics-web) */
export type TripExpenseSource = 'cash' | 'customer' | 'credit'

export interface TripExpenseInput {
  nameAr: string // سولار، كارت طريق، تفويج…
  qty: number
  unitAmountMinor: Minor
  source: TripExpenseSource
}

export interface TripExpenseComputed extends TripExpenseInput {
  amountMinor: Minor // qty × unitAmount
}

export interface TripInput {
  fromLoc: string
  toLoc: string
  qty: number // عدد النقلات لنفس الوجهة
  unitPriceMinor: Minor // سعر النقلة الواحدة
  expenses: TripExpenseInput[]
  payment: 'cash' | 'credit' // تحصيل من العميل: نقدي أو على حسابه
  vatPercent: number // ضريبة مضافة على الإيراد (B2B — تضاف فوق السعر)
  containerNumbers: string[] // بحد أقصى qty
}

export interface TripTotals {
  baseMinor: Minor // qty × unitPrice
  billableMinor: Minor // مصاريف على العميل — تُضاف لإيراده
  revenueMinor: Minor // base + billable (وعاء الضريبة)
  vatMinor: Minor
  grandMinor: Minor // ما يُحصَّل من العميل = revenue + vat
  directCashMinor: Minor // مصاريف نقدية من الخزينة
  creditMinor: Minor // مصاريف آجلة (ذمم موردين)
  costMinor: Minor // direct + credit (تكلفة النقلة)
  profitMinor: Minor // revenue − cost (صافي ربح النقلة قبل غير المباشر)
}

const isPosInt = (n: number) => Number.isInteger(n) && n >= 0

/** تحقق شامل قبل أي حساب — يعيد قائمة أخطاء عربية (فارغة = سليم) */
export function validateTrip(input: TripInput): string[] {
  const errors: string[] = []
  if (!input.fromLoc.trim()) errors.push('حدد جهة الانطلاق')
  if (!input.toLoc.trim()) errors.push('حدد جهة الوصول')
  if (!Number.isInteger(input.qty) || input.qty < 1 || input.qty > 1000) errors.push('عدد النقلات بين 1 و1000')
  if (!isPosInt(input.unitPriceMinor) || input.unitPriceMinor <= 0) errors.push('سعر النقلة يجب أن يكون موجباً')
  if (input.vatPercent < 0 || input.vatPercent > 100) errors.push('نسبة الضريبة بين 0 و100')
  if (input.containerNumbers.filter((c) => c.trim()).length > input.qty) {
    errors.push('أرقام الحاويات لا تتجاوز عدد النقلات')
  }
  input.expenses.forEach((e, i) => {
    if (!e.nameAr.trim()) errors.push(`مصروف ${i + 1}: حدد البيان`)
    if (!(e.qty > 0)) errors.push(`مصروف ${i + 1}: العدد يجب أن يكون موجباً`)
    if (!isPosInt(e.unitAmountMinor) || e.unitAmountMinor <= 0) errors.push(`مصروف ${i + 1}: القيمة يجب أن تكون موجبة`)
  })
  return errors
}

/** حساب إجماليات النقلة — أموال صحيحة (Minor) وتقريب نصف-لأعلى للضريبة */
export function computeTripTotals(input: TripInput): TripTotals {
  const expenses: TripExpenseComputed[] = input.expenses.map((e) => ({
    ...e,
    amountMinor: Math.round(e.unitAmountMinor * e.qty),
  }))
  const baseMinor = Math.round(input.unitPriceMinor * input.qty)
  const billableMinor = expenses.filter((e) => e.source === 'customer').reduce((a, e) => a + e.amountMinor, 0)
  const directCashMinor = expenses.filter((e) => e.source === 'cash').reduce((a, e) => a + e.amountMinor, 0)
  const creditMinor = expenses.filter((e) => e.source === 'credit').reduce((a, e) => a + e.amountMinor, 0)
  const revenueMinor = baseMinor + billableMinor
  const vatMinor = Math.round((revenueMinor * input.vatPercent) / 100)
  const costMinor = directCashMinor + creditMinor
  return {
    baseMinor,
    billableMinor,
    revenueMinor,
    vatMinor,
    grandMinor: revenueMinor + vatMinor,
    directCashMinor,
    creditMinor,
    costMinor,
    profitMinor: revenueMinor - costMinor,
  }
}

/**
 * قيد النقلة الواحد المتوازن:
 *   من ح/ الخزينة أو العملاء (grand)      ← تحصيل الإيراد
 *     إلى ح/ 4105 إيرادات نقلات (revenue)
 *     إلى ح/ 2102 ض.ق.م (vat)
 *   من ح/ 5106 مصروفات نقلات (cost)       ← تكلفة النقلة
 *     إلى ح/ 1101 الخزينة (المصاريف النقدية)
 *     إلى ح/ 2101 الموردون (المصاريف الآجلة)
 */
export function buildTripEntry(totals: TripTotals, payment: 'cash' | 'credit', tripLabel: string): JournalLine[] {
  if (totals.revenueMinor <= 0) throw new Error('إيراد النقلة يجب أن يكون موجباً')
  const lines: JournalLine[] = [
    { accountCode: payment === 'cash' ? '1101' : '1104', debit: totals.grandMinor, credit: 0, note: `تحصيل ${tripLabel}` },
    { accountCode: '4105', debit: 0, credit: totals.revenueMinor, note: 'إيراد نقلات' },
  ]
  if (totals.vatMinor > 0) lines.push({ accountCode: '2102', debit: 0, credit: totals.vatMinor, note: 'ض.ق.م' })
  if (totals.costMinor > 0) {
    lines.push({ accountCode: '5106', debit: totals.costMinor, credit: 0, note: 'مصاريف النقلة' })
    if (totals.directCashMinor > 0) lines.push({ accountCode: '1101', debit: 0, credit: totals.directCashMinor, note: 'مصاريف نقدية' })
    if (totals.creditMinor > 0) lines.push({ accountCode: '2101', debit: 0, credit: totals.creditMinor, note: 'مصاريف آجلة (محطات/موردون)' })
  }
  assertBalanced(lines)
  return lines
}

/* ─── تقرير ربحية النقلات (نمط tripProfitsReport في logistics-web) ─── */

export interface TripProfitRow {
  tripId: number
  tripNumber: string
  date: string
  customerId: number | null
  route: string // «الرياض ← جدة»
  qty: number
  revenueMinor: Minor
  costMinor: Minor
  profitMinor: Minor
  marginPercent: number // نسبة الربح من الإيراد
}

export function tripProfitReport(
  trips: {
    id: number
    tripNumber: string
    date: string
    customerId: number | null
    fromLoc: string
    toLoc: string
    qty: number
    totals: TripTotals
  }[],
  period: { from: string; to: string },
): { rows: TripProfitRow[]; totalRevenueMinor: Minor; totalCostMinor: Minor; totalProfitMinor: Minor } {
  const rows: TripProfitRow[] = []
  for (const t of trips) {
    const d = t.date.slice(0, 10)
    if (d < period.from || d > period.to) continue
    rows.push({
      tripId: t.id,
      tripNumber: t.tripNumber,
      date: d,
      customerId: t.customerId,
      route: `${t.fromLoc} ← ${t.toLoc}`,
      qty: t.qty,
      revenueMinor: t.totals.revenueMinor,
      costMinor: t.totals.costMinor,
      profitMinor: t.totals.profitMinor,
      marginPercent: t.totals.revenueMinor > 0 ? Math.round((t.totals.profitMinor / t.totals.revenueMinor) * 1000) / 10 : 0,
    })
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.tripId - b.tripId))
  return {
    rows,
    totalRevenueMinor: rows.reduce((a, r) => a + r.revenueMinor, 0),
    totalCostMinor: rows.reduce((a, r) => a + r.costMinor, 0),
    totalProfitMinor: rows.reduce((a, r) => a + r.profitMinor, 0),
  }
}

export const EXPENSE_SOURCE_LABELS: Record<TripExpenseSource, string> = {
  cash: 'نقدي من الخزينة',
  customer: 'على العميل (يُضاف لفاتورته)',
  credit: 'آجل (محطة/مورد)',
}
