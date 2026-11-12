/**
 * حساب نظري لإشعار مستخلص بكميات محددة. لا يرحّل قيداً ولا يوزع مستحقاً
 * على العميل/الخزينة أو الدفعات المقدمة؛ لا يُستخدم وحده لإصدار إشعار.
 */
import { roundNonNegativeRatio } from './money.ts'
import { normalizeMovementQty } from './pos.ts'
import { validateProjectRefundQuantities, type ProjectRefundQuantity, type ProjectRefundQuantityLine } from './projectRefundQuantities.ts'

export interface ProjectCreditLine extends ProjectRefundQuantityLine { lineValueMinor: number }
export interface ProjectCreditTotals { grossMinor: number; vatMinor: number; retentionMinor: number; dueMinor: number }
export interface ProjectCreditEvidence {
  amountMinor: number
  grossMinor: number
  taxShareMinor: number
  retentionMinor: number
  quantities: readonly ProjectRefundQuantity[]
}
export interface ProjectCreditAmounts { grossMinor: number; taxShareMinor: number; retentionMinor: number; amountMinor: number }

/**
 * تُقسم قيمة شريحة كل بند على كميته المثبتة، ثم توزع الضريبة والمحتجز
 * على قيمة الأعمال التراكمية. الفرق بين هدفين تراكميين يمنع ضياع الكسور
 * عند تعدد الإشعارات، ويعيد إجماليات الإصدار تماماً عند رد جميع الكميات.
 * هذا افتراض حسابي للمعاينة والاختبار فقط إلى حين اعتماد مسار التسوية الكامل.
 */
export function planProjectCreditAmounts(args: {
  lines: readonly ProjectCreditLine[]
  totals: ProjectCreditTotals
  refunds: readonly ProjectCreditEvidence[]
  refundedMinor: number
  refundedTaxMinor: number
  selected: readonly ProjectRefundQuantity[]
}): ProjectCreditAmounts {
  const t = args.totals
  if (!t || ![t.grossMinor, t.vatMinor, t.retentionMinor, t.dueMinor, args.refundedMinor, args.refundedTaxMinor].every(Number.isSafeInteger)
    || t.grossMinor <= 0 || t.vatMinor < 0 || t.retentionMinor < 0 || t.retentionMinor > t.grossMinor
    || t.dueMinor <= 0 || !Number.isSafeInteger(t.grossMinor + t.vatMinor) || t.dueMinor !== t.grossMinor + t.vatMinor - t.retentionMinor
    || args.refundedMinor < 0 || args.refundedTaxMinor < 0) throw new Error('إجماليات المستخلص أو الإشعارات غير صالحة')
  validateProjectRefundQuantities({ lines: args.lines, refunds: args.refunds, refundedMinor: args.refundedMinor, selected: args.selected })
  let grossTotal = 0
  for (const line of args.lines) {
    if (!Number.isSafeInteger(line.lineValueMinor) || line.lineValueMinor < 0) throw new Error('قيمة بند المستخلص غير صالحة')
    grossTotal += line.lineValueMinor
    if (!Number.isSafeInteger(grossTotal)) throw new Error('مجموع بنود المستخلص غير صالح')
  }
  if (grossTotal !== t.grossMinor) throw new Error('مجموع بنود المستخلص لا يطابق قيمة الأعمال')
  const cumulative = new Map<number, number>()
  let old: ProjectCreditAmounts = { grossMinor: 0, taxShareMinor: 0, retentionMinor: 0, amountMinor: 0 }
  const advance = (quantities: readonly ProjectRefundQuantity[]): ProjectCreditAmounts => {
    for (const row of quantities) {
      const value = (cumulative.get(row.boqItemId) ?? 0) + Math.round(normalizeMovementQty(row.qty) * 1000)
      if (!Number.isSafeInteger(value)) throw new Error('مجموع كميات الإشعارات غير صالح')
      cumulative.set(row.boqItemId, value)
    }
    let gross = 0
    for (const line of args.lines) {
      const issued = Math.round(normalizeMovementQty(line.newExecutedQty!, true) * 1000) - Math.round(normalizeMovementQty(line.prevExecutedQty!, true) * 1000)
      const returned = cumulative.get(line.boqItemId) ?? 0
      gross += roundNonNegativeRatio(line.lineValueMinor, returned, issued)
      if (!Number.isSafeInteger(gross)) throw new Error('مجموع قيمة الإشعار غير صالح')
    }
    const tax = roundNonNegativeRatio(t.vatMinor, gross, t.grossMinor)
    const retention = roundNonNegativeRatio(t.retentionMinor, gross, t.grossMinor)
    const amount = gross + tax - retention
    if (!Number.isSafeInteger(amount)) throw new Error('صافي قيمة الإشعار غير صالح')
    const current = { grossMinor: gross, taxShareMinor: tax, retentionMinor: retention, amountMinor: amount }
    const delta = { grossMinor: gross - old.grossMinor, taxShareMinor: tax - old.taxShareMinor, retentionMinor: retention - old.retentionMinor, amountMinor: amount - old.amountMinor }
    if (delta.grossMinor <= 0 || delta.taxShareMinor < 0 || delta.retentionMinor < 0 || delta.amountMinor <= 0) throw new Error('كمية الإشعار لا تنتج قيمة موجبة قابلة للتسوية — اجمع الكسور وراجع البيانات')
    old = current
    return delta
  }
  for (const record of args.refunds) {
    const delta = advance(record.quantities)
    if (record.grossMinor !== delta.grossMinor || record.taxShareMinor !== delta.taxShareMinor || record.retentionMinor !== delta.retentionMinor || record.amountMinor !== delta.amountMinor) throw new Error('قيمة أو ضريبة أو محتجز إشعار سابق لا يطابق كمياته — راجع التاريخ')
  }
  if (old.amountMinor !== args.refundedMinor || old.taxShareMinor !== args.refundedTaxMinor) throw new Error('إجماليات إشعارات المستخلص لا تطابق دليل الكميات')
  return advance(args.selected)
}
