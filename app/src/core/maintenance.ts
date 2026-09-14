/**
 * الصيانة — أوامر صيانة الموبايلات والأجهزة (المرحلة 6 — القرار 13):
 * التذكرة وحدة العمل: جهاز + عطل، تمر بحالات
 * (مستلَمة ← تحت الصيانة ← جاهزة ← مسلَّمة / ملغاة)،
 * وعند التسليم يُرحَّل قيد واحد متوازن:
 * تحصيل (1101/1104) مقابل 4103 إيراد صيانة + 2102 ضريبة،
 * وقطع الغيار المستهلكة تكلفةً: 5101 / 1103 (بمتوسط التكلفة المرجح — القرار 14).
 * نواة خالصة بلا واجهات — كل الأموال أعداد صحيحة (Minor).
 */
import type { Minor } from './money.ts'
import { assertBalanced, type JournalLine } from './ledger.ts'

export type TicketStatus = 'received' | 'in_progress' | 'ready' | 'delivered' | 'cancelled'

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  received: 'مستلَمة',
  in_progress: 'تحت الصيانة',
  ready: 'جاهزة للتسليم',
  delivered: 'مسلَّمة',
  cancelled: 'ملغاة',
}

/** الانتقالات المسموحة — التسليم والإلغاء نهائيان (append-only للسجل) */
export const TICKET_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  received: ['in_progress', 'ready', 'cancelled'],
  in_progress: ['ready', 'cancelled'],
  ready: ['in_progress', 'delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
}

export interface TicketPartInput {
  itemId: number
  nameAr: string
  qty: number
  unitPriceMinor: Minor // سعر بيع القطعة للعميل
  unitCostMinor: Minor // متوسط التكلفة المرجح وقت التسليم
}

export interface TicketInput {
  deviceName: string // آيفون 13 برو
  issue: string // وصف العطل
}

export interface TicketDeliveryInput {
  laborMinor: Minor // أجرة الصيانة (المصنعية)
  parts: TicketPartInput[]
  payment: 'cash' | 'credit'
  vatPercent: number // تُضاف فوق الإجمالي
}

export interface TicketTotals {
  laborMinor: Minor
  partsPriceMinor: Minor // Σ qty×unitPrice
  partsCostMinor: Minor // Σ qty×unitCost
  revenueMinor: Minor // labor + partsPrice (وعاء الضريبة)
  vatMinor: Minor
  grandMinor: Minor // revenue + vat (المستحق من العميل)
}

const isPosInt = (n: number) => Number.isInteger(n) && n >= 0

/** تحقق فتح التذكرة */
export function validateTicket(input: TicketInput): string[] {
  const errors: string[] = []
  if (!input.deviceName.trim()) errors.push('حدد الجهاز')
  if (!input.issue.trim()) errors.push('صف العطل')
  return errors
}

/** تحقق التسليم — يعيد قائمة أخطاء عربية (فارغة = سليم) */
export function validateDelivery(input: TicketDeliveryInput): string[] {
  const errors: string[] = []
  if (!isPosInt(input.laborMinor)) errors.push('الأجرة لا تكون سالبة')
  if (input.vatPercent < 0 || input.vatPercent > 100) errors.push('نسبة الضريبة بين 0 و100')
  input.parts.forEach((p, i) => {
    if (!p.nameAr.trim()) errors.push(`قطعة ${i + 1}: حدد الاسم`)
    if (!Number.isInteger(p.qty) || p.qty < 1) errors.push(`قطعة ${i + 1}: الكمية عدد صحيح موجب`)
    if (!isPosInt(p.unitPriceMinor)) errors.push(`قطعة ${i + 1}: السعر لا يكون سالباً`)
    if (!isPosInt(p.unitCostMinor)) errors.push(`قطعة ${i + 1}: التكلفة لا تكون سالبة`)
  })
  const totals = computeTicketTotals(input)
  if (totals.revenueMinor <= 0) errors.push('إجمالي التذكرة يجب أن يكون موجباً (أجرة أو قطع)')
  return errors
}

/** إجماليات التسليم */
export function computeTicketTotals(input: TicketDeliveryInput): TicketTotals {
  const partsPriceMinor = input.parts.reduce((a, p) => a + Math.round(p.unitPriceMinor * p.qty), 0)
  const partsCostMinor = input.parts.reduce((a, p) => a + Math.round(p.unitCostMinor * p.qty), 0)
  const revenueMinor = input.laborMinor + partsPriceMinor
  const vatMinor = Math.round((revenueMinor * input.vatPercent) / 100)
  return {
    laborMinor: input.laborMinor,
    partsPriceMinor,
    partsCostMinor,
    revenueMinor,
    vatMinor,
    grandMinor: revenueMinor + vatMinor,
  }
}

/**
 * قيد تسليم التذكرة المتوازن:
 *   من ح/ 1101 الخزينة أو 1104 العملاء (grand)
 *     إلى ح/ 4103 إيرادات صيانة (revenue)
 *     إلى ح/ 2102 ض.ق.م (vat)
 *   من ح/ 5101 تكلفة البضاعة (partsCost — القطع المستهلكة)
 *     إلى ح/ 1103 المخزون (partsCost)
 */
export function buildTicketDeliveryEntry(totals: TicketTotals, payment: 'cash' | 'credit', label: string): JournalLine[] {
  if (totals.revenueMinor <= 0) throw new Error('إيراد التذكرة يجب أن يكون موجباً')
  const lines: JournalLine[] = [
    { accountCode: payment === 'cash' ? '1101' : '1104', debit: totals.grandMinor, credit: 0, note: `تحصيل ${label}` },
    { accountCode: '4103', debit: 0, credit: totals.revenueMinor, note: 'إيراد صيانة' },
  ]
  if (totals.vatMinor > 0) lines.push({ accountCode: '2102', debit: 0, credit: totals.vatMinor, note: 'ض.ق.م' })
  if (totals.partsCostMinor > 0) {
    lines.push({ accountCode: '5101', debit: totals.partsCostMinor, credit: 0, note: 'تكلفة قطع الغيار' })
    lines.push({ accountCode: '1103', debit: 0, credit: totals.partsCostMinor, note: 'صرف قطع من المخزون' })
  }
  assertBalanced(lines)
  return lines
}

/* ─── تقرير الصيانة ─── */

export interface TicketReportRow {
  ticketId: number
  ticketNumber: string
  date: string
  customerId: number | null
  deviceName: string
  status: TicketStatus
  revenueMinor: Minor
  partsCostMinor: Minor
  profitMinor: Minor // revenue − partsCost (قبل غير المباشر)
}

export function maintenanceReport(
  tickets: {
    id: number
    ticketNumber: string
    date: string
    customerId: number | null
    deviceName: string
    status: TicketStatus
    totals: TicketTotals | null // null = لم تُسلَّم بعد
  }[],
  period: { from: string; to: string },
): { rows: TicketReportRow[]; totalRevenueMinor: Minor; totalProfitMinor: Minor; openCount: number } {
  const rows: TicketReportRow[] = []
  for (const t of tickets) {
    const d = t.date.slice(0, 10)
    if (d < period.from || d > period.to) continue
    const revenue = t.totals?.revenueMinor ?? 0
    const cost = t.totals?.partsCostMinor ?? 0
    rows.push({
      ticketId: t.id,
      ticketNumber: t.ticketNumber,
      date: d,
      customerId: t.customerId,
      deviceName: t.deviceName,
      status: t.status,
      revenueMinor: revenue,
      partsCostMinor: cost,
      profitMinor: revenue - cost,
    })
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.ticketId - b.ticketId))
  return {
    rows,
    totalRevenueMinor: rows.reduce((a, r) => a + r.revenueMinor, 0),
    totalProfitMinor: rows.reduce((a, r) => a + r.profitMinor, 0),
    openCount: rows.filter((r) => r.status !== 'delivered' && r.status !== 'cancelled').length,
  }
}
