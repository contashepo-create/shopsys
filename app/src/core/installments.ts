/**
 * الأقساط — ShopSys (المرحلة 5)
 * ──────────────────────────────
 * منطق خالص: توليد جدول أقساط بتوزيع «أكبر البواقي» (لا يضيع مليم)،
 * حساب حالة كل قسط (مدفوع/جزئي/مستحق اليوم/متأخر/قادم)،
 * وتنبيهات الاستحقاق (متأخر أو يستحق خلال أيام).
 * السداد يُرحَّل قيداً متوازناً: من ح/ الخزينة → إلى ح/ العملاء (1104).
 */
import type { Minor } from './money.ts'

export interface InstallmentItem {
  seq: number // 1..n
  dueDate: string // YYYY-MM-DD
  amountMinor: Minor
  paidMinor: Minor
  paidAt: string | null // آخر سداد ISO
}

export type InstallmentStatus = 'paid' | 'partial' | 'due_today' | 'overdue' | 'upcoming'

/** أيام التنبيه المبكر الافتراضية */
export const ALERT_DAYS_AHEAD = 7

/**
 * توليد جدول الأقساط: المبلغ الممول = الإجمالي − المقدم، يوزَّع على العدد
 * بالتساوي وبواقي القسمة تُضاف للأقساط الأولى (أكبر البواقي — مجموع الجدول = الممول تماماً)
 */
export function buildSchedule(args: {
  totalMinor: Minor
  downPaymentMinor: Minor
  count: number
  intervalMonths: number // عادة 1 (شهري)
  firstDueDate: string // YYYY-MM-DD
}): InstallmentItem[] {
  const { totalMinor, downPaymentMinor, count, intervalMonths, firstDueDate } = args
  if (!Number.isInteger(totalMinor) || totalMinor <= 0) throw new Error('إجمالي الخطة يجب أن يكون موجباً')
  if (!Number.isInteger(downPaymentMinor) || downPaymentMinor < 0) throw new Error('المقدم لا يكون سالباً')
  if (downPaymentMinor >= totalMinor) throw new Error('المقدم يجب أن يكون أقل من الإجمالي')
  if (!Number.isInteger(count) || count < 1 || count > 120) throw new Error('عدد الأقساط بين 1 و120')
  if (!Number.isInteger(intervalMonths) || intervalMonths < 1 || intervalMonths > 12) throw new Error('الفاصل بين الأقساط 1–12 شهراً')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(firstDueDate)) throw new Error('تاريخ أول قسط بصيغة YYYY-MM-DD')

  const financed = totalMinor - downPaymentMinor
  const base = Math.floor(financed / count)
  const remainder = financed - base * count // يوزَّع 1 على الأقساط الأولى

  const items: InstallmentItem[] = []
  for (let i = 0; i < count; i++) {
    items.push({
      seq: i + 1,
      dueDate: addMonths(firstDueDate, i * intervalMonths),
      amountMinor: base + (i < remainder ? 1 : 0),
      paidMinor: 0,
      paidAt: null,
    })
  }
  return items
}

/** إضافة أشهر لتاريخ مع تثبيت اليوم (وضبط نهايات الشهور: 31 يناير + شهر = 28/29 فبراير) */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const total = (m - 1) + months
  const ny = y + Math.floor(total / 12)
  const nm = (total % 12) + 1
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate()
  const nd = Math.min(d, lastDay)
  return `${ny}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`
}

/** حالة قسط واحد اعتماداً على تاريخ اليوم */
export function installmentStatus(item: InstallmentItem, today: string): InstallmentStatus {
  if (item.paidMinor >= item.amountMinor) return 'paid'
  if (item.paidMinor > 0) return item.dueDate < today ? 'overdue' : 'partial'
  if (item.dueDate < today) return 'overdue'
  if (item.dueDate === today) return 'due_today'
  return 'upcoming'
}

export interface PlanProgress {
  paidCount: number
  totalCount: number
  paidMinor: Minor
  remainingMinor: Minor
  overdueMinor: Minor // إجمالي المتأخر غير المسدد
  nextDue: InstallmentItem | null // أقرب قسط غير مكتمل
  finished: boolean
}

/** ملخص تقدم خطة كاملة */
export function planProgress(items: InstallmentItem[], today: string): PlanProgress {
  let paidCount = 0, paidMinor = 0, remainingMinor = 0, overdueMinor = 0
  let nextDue: InstallmentItem | null = null
  for (const it of items) {
    paidMinor += it.paidMinor
    const rest = it.amountMinor - it.paidMinor
    if (rest <= 0) { paidCount++; continue }
    remainingMinor += rest
    if (it.dueDate < today) overdueMinor += rest
    if (!nextDue || it.dueDate < nextDue.dueDate) nextDue = it
  }
  return {
    paidCount,
    totalCount: items.length,
    paidMinor,
    remainingMinor,
    overdueMinor,
    nextDue,
    finished: remainingMinor === 0,
  }
}

/**
 * سداد دفعة على الجدول: تُوزَّع على الأقساط غير المكتملة بالترتيب (الأقدم أولاً).
 * ترجع نسخة جديدة من الجدول + المبلغ الفائض إن تجاوز المتبقي كله.
 */
export function applyPayment(
  items: InstallmentItem[],
  amountMinor: Minor,
  paidAtIso: string,
): { items: InstallmentItem[]; excessMinor: Minor } {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) throw new Error('مبلغ السداد يجب أن يكون موجباً')
  let rest = amountMinor
  const out = items.map((it) => {
    if (rest <= 0) return it
    const need = it.amountMinor - it.paidMinor
    if (need <= 0) return it
    const pay = Math.min(need, rest)
    rest -= pay
    return { ...it, paidMinor: it.paidMinor + pay, paidAt: paidAtIso }
  })
  return { items: out, excessMinor: rest }
}

export interface InstallmentAlert {
  planId: number
  seq: number
  dueDate: string
  amountDueMinor: Minor // المتبقي على هذا القسط
  kind: 'overdue' | 'due_soon' // متأخر أو يستحق خلال daysAhead
  daysDiff: number // موجب = متبقٍ للاستحقاق، سالب = أيام التأخير
}

/** تنبيهات الأقساط: المتأخرة + المستحقة خلال daysAhead يوماً (مرتبة: الأشد تأخراً أولاً) */
export function collectAlerts(
  plans: { id: number; items: InstallmentItem[] }[],
  today: string,
  daysAhead: number = ALERT_DAYS_AHEAD,
): InstallmentAlert[] {
  const alerts: InstallmentAlert[] = []
  const t = Date.parse(`${today}T00:00:00Z`)
  for (const plan of plans) {
    for (const it of plan.items) {
      const rest = it.amountMinor - it.paidMinor
      if (rest <= 0) continue
      const diffDays = Math.round((Date.parse(`${it.dueDate}T00:00:00Z`) - t) / 86_400_000)
      if (diffDays < 0) alerts.push({ planId: plan.id, seq: it.seq, dueDate: it.dueDate, amountDueMinor: rest, kind: 'overdue', daysDiff: diffDays })
      else if (diffDays <= daysAhead) alerts.push({ planId: plan.id, seq: it.seq, dueDate: it.dueDate, amountDueMinor: rest, kind: 'due_soon', daysDiff: diffDays })
    }
  }
  return alerts.sort((a, b) => a.daysDiff - b.daysDiff)
}
