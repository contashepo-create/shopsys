/**
 * ترقية تأجير المعدات الثقيلة (القرار 25):
 * عقود زمنية ساعي/يومي/شهري + عدّاد ساعات (Hour Meter) + وردانيات مشغلين
 * + صيانة وقائية كل N ساعة تشغيل.
 * نواة خالصة: كل الحسابات هنا، والواجهة تعرض فقط.
 */
import type { Minor } from './money.ts'
import { assertBalanced, type JournalLine } from './ledger.ts'

export type RateType = 'hourly' | 'daily' | 'monthly'

export const RATE_TYPE_LABELS: Record<RateType, { nameAr: string; unitAr: string }> = {
  hourly: { nameAr: 'ساعي (بعدّاد الساعات)', unitAr: 'ساعة' },
  daily: { nameAr: 'يومي', unitAr: 'يوم' },
  monthly: { nameAr: 'شهري', unitAr: 'شهر' },
}

/* ─── عدّاد الساعات ─── */

/** قراءة عدّاد صحيحة: رقم غير سالب بدقة عُشر ساعة كحد أقصى */
export function isValidMeterReading(r: number): boolean {
  return Number.isFinite(r) && r >= 0 && r <= 10_000_000 && Math.round(r * 10) === r * 10
}

/**
 * ساعات التشغيل الفعلية بين قراءتين — يرمي لو النهاية قبل البداية
 * (العدّاد لا يرجع للخلف أبداً — خط دفاع ضد أخطاء الإدخال)
 */
export function usageHours(startReading: number, endReading: number): number {
  if (!isValidMeterReading(startReading) || !isValidMeterReading(endReading)) {
    throw new Error('قراءة العدّاد رقم غير سالب بدقة عُشر ساعة')
  }
  if (endReading < startReading) {
    throw new Error(`قراءة النهاية (${endReading}) أقل من البداية (${startReading}) — العدّاد لا يرجع للخلف`)
  }
  return Math.round((endReading - startReading) * 10) / 10
}

/* ─── تسوية العقد الزمني ─── */

export interface UsageBillingInput {
  rateType: RateType
  rateMinor: Minor // سعر الوحدة (ساعة/يوم/شهر)
  bookedUnits: number // المحجوز والمحصَّل عند الفتح
  /** ساعي: قراءتا العدّاد */
  startReading?: number
  endReading?: number
  /** يومي/شهري: تاريخا البداية والنهاية الفعلية YYYY-MM-DD */
  startDate?: string
  endDate?: string
}

export interface UsageBilling {
  actualUnits: number // الاستخدام الفعلي (ساعات/أيام/أشهر)
  bookedUnits: number
  extraUnits: number // ما تجاوز المحجوز (0 لو أقل أو مساوٍ)
  extraMinor: Minor // قيمة التجاوز المستحقة عند الإقفال
}

/** أيام بين تاريخين (النهاية محسوبة — يوم واحد على الأقل) */
export function daysBetweenDates(startDate: string, endDate: string): number {
  const s = Date.parse(startDate)
  const e = Date.parse(endDate)
  if (!Number.isFinite(s) || !Number.isFinite(e)) throw new Error('تاريخ غير صحيح — الصيغة YYYY-MM-DD')
  if (e < s) throw new Error('تاريخ النهاية قبل البداية')
  return Math.max(1, Math.ceil((e - s) / 86_400_000))
}

/**
 * تسوية الإقفال: الاستخدام الفعلي مقابل المحجوز.
 * - ساعي: من فرق قراءتي العدّاد (كسور الساعة تُحاسب لأعلى لأقرب ساعة)
 * - يومي: أيام فعلية بين التاريخين
 * - شهري: كل 30 يوماً مبدوءة = شهر (31 يوماً ⇒ شهران)
 * التجاوز يُحاسَب؛ الاستخدام الأقل لا يُرد (عقد حجز — نفس عرف السوق)
 */
export function computeUsageBilling(input: UsageBillingInput): UsageBilling {
  if (!Number.isInteger(input.bookedUnits) || input.bookedUnits < 1) throw new Error('الوحدات المحجوزة عدد صحيح موجب')
  if (!Number.isInteger(input.rateMinor) || input.rateMinor <= 0) throw new Error('سعر الوحدة يجب أن يكون موجباً')
  let actual: number
  if (input.rateType === 'hourly') {
    if (input.startReading == null || input.endReading == null) throw new Error('العقد الساعي يتطلب قراءتي العدّاد')
    actual = Math.ceil(usageHours(input.startReading, input.endReading))
  } else {
    if (!input.startDate || !input.endDate) throw new Error('العقد الزمني يتطلب تاريخي البداية والنهاية')
    const days = daysBetweenDates(input.startDate, input.endDate)
    actual = input.rateType === 'daily' ? days : Math.max(1, Math.ceil(days / 30))
  }
  const extraUnits = Math.max(0, actual - input.bookedUnits)
  return {
    actualUnits: actual,
    bookedUnits: input.bookedUnits,
    extraUnits,
    extraMinor: extraUnits * input.rateMinor,
  }
}

/**
 * قيد تجاوز الاستخدام عند الإقفال (يُبنى فقط لو extra > 0):
 *   من ح/ خزينة 1101 أو عملاء 1104 (بطريقة سداد العقد)
 *     إلى ح/ 4104 إيراد إيجار معدات + 2102 ض.ق.م
 */
export function buildExtraUsageEntry(
  extraMinor: Minor,
  vatPercent: number,
  payment: 'cash' | 'credit' | 'mixed',
  label: string,
  treasury = '1101',
): JournalLine[] {
  if (!Number.isInteger(extraMinor) || extraMinor <= 0) throw new Error('قيمة التجاوز يجب أن تكون موجبة')
  const vat = Math.round((extraMinor * vatPercent) / 100)
  const lines: JournalLine[] = [
    { accountCode: payment === 'cash' ? treasury : '1104', debit: extraMinor + vat, credit: 0, note: `تجاوز استخدام ${label}` },
    { accountCode: '4104', debit: 0, credit: extraMinor, note: 'إيراد تجاوز ساعات/مدة' },
  ]
  if (vat > 0) lines.push({ accountCode: '2102', debit: 0, credit: vat, note: 'ض.ق.م' })
  assertBalanced(lines)
  return lines
}

/* ─── الوردانيات (ورديات المشغلين) ─── */

export interface OperatorShift {
  id: number
  equipmentId: number
  operatorName: string
  date: string // YYYY-MM-DD
  startReading: number
  endReading: number
  notes: string
}

export function validateOperatorShift(s: Omit<OperatorShift, 'id'>): string[] {
  const errors: string[] = []
  if (!s.operatorName.trim()) errors.push('اسم المشغل مطلوب')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.date)) errors.push('التاريخ بصيغة YYYY-MM-DD')
  try {
    usageHours(s.startReading, s.endReading)
  } catch (e) {
    errors.push((e as Error).message)
  }
  return errors
}

/** ساعات وردية واحدة */
export function shiftHours(s: Pick<OperatorShift, 'startReading' | 'endReading'>): number {
  return usageHours(s.startReading, s.endReading)
}

/** ملخص وردانيات معدة: إجمالي الساعات ولكل مشغل */
export function shiftsSummary(shifts: readonly OperatorShift[], equipmentId: number): {
  totalHours: number
  byOperator: { operatorName: string; hours: number; shiftCount: number }[]
} {
  const mine = shifts.filter((s) => s.equipmentId === equipmentId)
  const byOp = new Map<string, { hours: number; count: number }>()
  let total = 0
  for (const s of mine) {
    const h = shiftHours(s)
    total = Math.round((total + h) * 10) / 10
    const cur = byOp.get(s.operatorName) ?? { hours: 0, count: 0 }
    byOp.set(s.operatorName, { hours: Math.round((cur.hours + h) * 10) / 10, count: cur.count + 1 })
  }
  return {
    totalHours: total,
    byOperator: [...byOp.entries()]
      .map(([operatorName, v]) => ({ operatorName, hours: v.hours, shiftCount: v.count }))
      .sort((a, b) => b.hours - a.hours),
  }
}

/* ─── الصيانة الوقائية (كل N ساعة تشغيل) ─── */

export interface ServiceStatus {
  dueAtReading: number // القراءة التي تستحق عندها الخدمة القادمة
  remainingHours: number // المتبقي (سالب = متأخرة)
  overdue: boolean
  /** نسبة استهلاك الفترة 0..1 (للشريط) — تتجاوز 1 عند التأخر ثم تُشبع */
  progress: number
}

/**
 * حالة الصيانة الوقائية: آخر خدمة عند قراءة معينة + فترة كل N ساعة.
 * everyHours = 0 يعني لا خطة صيانة (يعيد null).
 */
export function serviceStatus(
  lastServiceReading: number,
  everyHours: number,
  currentReading: number,
): ServiceStatus | null {
  if (everyHours <= 0) return null
  if (!isValidMeterReading(lastServiceReading) || !isValidMeterReading(currentReading)) {
    throw new Error('قراءات العدّاد أرقام غير سالبة')
  }
  const dueAt = Math.round((lastServiceReading + everyHours) * 10) / 10
  const remaining = Math.round((dueAt - currentReading) * 10) / 10
  const used = currentReading - lastServiceReading
  return {
    dueAtReading: dueAt,
    remainingHours: remaining,
    overdue: remaining < 0,
    progress: Math.min(1, Math.max(0, used / everyHours)),
  }
}


/* ─── تكاليف تشغيل المعدة وربحيتها (سد فجوة Point of Rental/HCSS) ─── */

export type EquipmentCostKind = 'fuel' | 'maintenance' | 'repair' | 'operator' | 'other'

export const EQUIPMENT_COST_LABELS: Record<EquipmentCostKind, string> = {
  fuel: 'وقود',
  maintenance: 'صيانة دورية',
  repair: 'إصلاح عطل',
  operator: 'أجر مشغّل',
  other: 'أخرى',
}

/**
 * ربحية معدة: الإيراد من عقودها − تكاليف تشغيلها، والساعات الموثقة
 * (عقود ساعية بقراءات + وردانيات مشغلين) لاشتقاق ربح الساعة.
 */
export function equipmentProfitability(args: {
  rentMinor: number
  extraMinor: number
  costsMinor: number
  contractHours: number
  shiftHours: number
}): { revenueMinor: number; costsMinor: number; profitMinor: number; hours: number; profitPerHourMinor: number | null } {
  const revenue = args.rentMinor + args.extraMinor
  const profit = revenue - args.costsMinor
  const hours = Math.round((args.contractHours + args.shiftHours) * 10) / 10
  return {
    revenueMinor: revenue,
    costsMinor: args.costsMinor,
    profitMinor: profit,
    hours,
    profitPerHourMinor: hours > 0 ? Math.round(profit / hours) : null,
  }
}
