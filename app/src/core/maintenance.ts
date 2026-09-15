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

/**
 * كتالوج خدمات الصيانة (الأمر 23 — بمستوى موبايل شوب):
 * كل خدمة لها تكلفة داخلية (أجر فني/مواد استهلاكية) وسعر بيع —
 * الربح يُحسب تلقائياً ولا يظهر أبداً في مطبوعات العميل.
 */
export interface MaintenanceService {
  id: number
  nameAr: string
  costMinor: Minor // التكلفة الداخلية — سرية (لا تُطبع للعميل)
  priceMinor: Minor // سعر البيع للعميل
  isActive: boolean
}

export function validateService(input: { nameAr: string; costMinor: number; priceMinor: number }): string[] {
  const errors: string[] = []
  if (!input.nameAr.trim()) errors.push('اسم الخدمة مطلوب')
  if (!isPosInt(input.costMinor)) errors.push('التكلفة لا تكون سالبة')
  if (!isPosInt(input.priceMinor)) errors.push('سعر البيع لا يكون سالباً')
  return errors
}

/** سطر خدمة داخل تسليم التذكرة — السعر والتكلفة يُسحبان من الكتالوج ويقبلان التعديل */
export interface TicketServiceInput {
  serviceId: number | null // null = خدمة حرة (كتبت يدوياً)
  nameAr: string
  qty: number
  unitPriceMinor: Minor
  unitCostMinor: Minor // تكلفة داخلية — لا تظهر للعميل
}

export interface TicketInput {
  deviceName: string // آيفون 13 برو
  issue: string // وصف العطل
}

export interface TicketDeliveryInput {
  laborMinor: Minor // أجرة الصيانة (المصنعية)
  parts: TicketPartInput[]
  /** خدمات من الكتالوج بتكلفة وسعر بيع (الأمر 23) */
  services?: TicketServiceInput[]
  payment: 'cash' | 'credit'
  /**
   * التحصيل المجزأ (الأمر 23): المدفوع نقداً الآن — الباقي دين على العميل.
   * undefined = حسب payment القديم (cash = الكل نقداً، credit = الكل آجل).
   */
  paidMinor?: Minor
  vatPercent: number // تُضاف فوق الإجمالي
}

export interface TicketTotals {
  laborMinor: Minor
  partsPriceMinor: Minor // Σ qty×unitPrice
  partsCostMinor: Minor // Σ qty×unitCost
  servicesPriceMinor: Minor // Σ qty×unitPrice للخدمات (الأمر 23)
  servicesCostMinor: Minor // Σ qty×unitCost للخدمات — سري
  revenueMinor: Minor // labor + partsPrice + servicesPrice (وعاء الضريبة)
  vatMinor: Minor
  grandMinor: Minor // revenue + vat (المستحق من العميل)
  paidMinor: Minor // المحصَّل نقداً عند التسليم (التحصيل المجزأ)
  creditMinor: Minor // الباقي ديناً على العميل = grand − paid
  profitMinor: Minor // revenue − partsCost − servicesCost (لا يُطبع للعميل أبداً)
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
  ;(input.services ?? []).forEach((sv, i) => {
    if (!sv.nameAr.trim()) errors.push(`خدمة ${i + 1}: حدد الاسم`)
    if (!Number.isInteger(sv.qty) || sv.qty < 1) errors.push(`خدمة ${i + 1}: الكمية عدد صحيح موجب`)
    if (!isPosInt(sv.unitPriceMinor)) errors.push(`خدمة ${i + 1}: السعر لا يكون سالباً`)
    if (!isPosInt(sv.unitCostMinor)) errors.push(`خدمة ${i + 1}: التكلفة لا تكون سالبة`)
  })
  const totals = computeTicketTotals(input)
  if (totals.revenueMinor <= 0) errors.push('إجمالي التذكرة يجب أن يكون موجباً (أجرة أو قطع أو خدمات)')
  if (input.paidMinor != null) {
    if (!isPosInt(input.paidMinor)) errors.push('المدفوع لا يكون سالباً')
    else if (input.paidMinor > totals.grandMinor) errors.push('المدفوع يتجاوز إجمالي التذكرة')
  }
  return errors
}

/** إجماليات التسليم — تشمل الخدمات والتحصيل المجزأ والربح (الأمر 23) */
export function computeTicketTotals(input: TicketDeliveryInput): TicketTotals {
  const partsPriceMinor = input.parts.reduce((a, p) => a + Math.round(p.unitPriceMinor * p.qty), 0)
  const partsCostMinor = input.parts.reduce((a, p) => a + Math.round(p.unitCostMinor * p.qty), 0)
  const services = input.services ?? []
  const servicesPriceMinor = services.reduce((a, sv) => a + Math.round(sv.unitPriceMinor * sv.qty), 0)
  const servicesCostMinor = services.reduce((a, sv) => a + Math.round(sv.unitCostMinor * sv.qty), 0)
  const revenueMinor = input.laborMinor + partsPriceMinor + servicesPriceMinor
  const vatMinor = Math.round((revenueMinor * input.vatPercent) / 100)
  const grandMinor = revenueMinor + vatMinor
  // التحصيل المجزأ: paidMinor صريح ⇒ يعتمد؛ وإلا حسب طريقة الدفع القديمة
  const paidMinor = input.paidMinor != null
    ? Math.min(input.paidMinor, grandMinor)
    : input.payment === 'cash' ? grandMinor : 0
  return {
    laborMinor: input.laborMinor,
    partsPriceMinor,
    partsCostMinor,
    servicesPriceMinor,
    servicesCostMinor,
    revenueMinor,
    vatMinor,
    grandMinor,
    paidMinor,
    creditMinor: grandMinor - paidMinor,
    profitMinor: revenueMinor - partsCostMinor - servicesCostMinor,
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
export function buildTicketDeliveryEntry(totals: TicketTotals, payment: 'cash' | 'credit', label: string, treasury = '1101'): JournalLine[] {
  if (totals.revenueMinor <= 0) throw new Error('إيراد التذكرة يجب أن يكون موجباً')
  const lines: JournalLine[] = []
  // التحصيل المجزأ (الأمر 23): نقدي محصَّل الآن + الباقي ذمم عميل
  if (totals.paidMinor > 0) lines.push({ accountCode: treasury, debit: totals.paidMinor, credit: 0, note: `تحصيل نقدي ${label}` })
  if (totals.creditMinor > 0) lines.push({ accountCode: '1104', debit: totals.creditMinor, credit: 0, note: `آجل على العميل ${label}` })
  if (totals.paidMinor === 0 && totals.creditMinor === 0 && totals.grandMinor > 0) {
    // fallback نظري — لا يحدث عملياً لأن grand = paid + credit
    lines.push({ accountCode: payment === 'cash' ? treasury : '1104', debit: totals.grandMinor, credit: 0, note: `تحصيل ${label}` })
  }
  lines.push({ accountCode: '4103', debit: 0, credit: totals.revenueMinor, note: 'إيراد صيانة' })
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

/* ─── جولة مراجعة المغسلة (الطلبات 6–9): موعد التسليم الموعود ─── */

/**
 * تذكرة متأخرة = لها موعد تسليم موعود، لم تُسلَّم ولم تُلغَ، والوقت تجاوز الموعد.
 * (المغاسل تعِد بموعد استلام القطع — والصيانة تستفيد بنفس الميزة)
 */
export function isTicketOverdue(
  ticket: { status: TicketStatus; promisedAt?: string | null },
  nowIso: string,
): boolean {
  if (!ticket.promisedAt) return false
  if (ticket.status === 'delivered' || ticket.status === 'cancelled') return false
  return nowIso > ticket.promisedAt
}
