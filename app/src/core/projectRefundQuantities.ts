/**
 * حارس كميات الإشعار على شريحة مستخلص بعينه، لا على الحصر الفعلي.
 * نواة تحقق فقط: لا تنشئ قيداً ولا تحدد مبلغ الإشعار أو تعيد فتح الختامي.
 */
import { normalizeMovementQty } from './pos.ts'

export interface ProjectRefundQuantityLine {
  boqItemId: number
  prevExecutedQty?: number
  newExecutedQty?: number
  previousQtyEstimated?: boolean
}
export interface ProjectRefundQuantity { boqItemId: number; qty: number }
export interface ProjectRefundQuantityRecord { amountMinor: number; quantities?: readonly ProjectRefundQuantity[] }

function milli(value: number, allowZero = false): number {
  return Math.round(normalizeMovementQty(value, allowZero) * 1000)
}

/**
 * التحقق من كل إشعارات المستخلص، بما فيها السابقة، قبل قبول اختيار جديد.
 * السجلات القديمة بلا دليل كميات لا تُحوّل تلقائياً من مبلغ أو نسبة إلى كمية.
 * الدالة تحسب المتبقي من شريحة هذا المستخلص لا من كمية العقد أو الحصر.
 */
export function validateProjectRefundQuantities(args: {
  lines?: readonly ProjectRefundQuantityLine[]
  refunds: readonly ProjectRefundQuantityRecord[]
  refundedMinor: number
  selected: readonly ProjectRefundQuantity[]
}): { boqItemId: number; issuedQty: number; alreadyReturnedQty: number; requestedQty: number; remainingQty: number }[] {
  if (!args.lines?.length) throw new Error('المستخلص بلا بنود كمية مثبتة — راجع التاريخ قبل تحديد المرتجع')
  if (!Number.isSafeInteger(args.refundedMinor) || args.refundedMinor < 0) throw new Error('رصيد الإشعارات السابق غير صالح')
  const capacity = new Map<number, number>()
  for (const line of args.lines) {
    if (!Number.isSafeInteger(line.boqItemId) || line.boqItemId <= 0 || capacity.has(line.boqItemId)) throw new Error('بند المستخلص غير صالح أو مكرر')
    if (line.previousQtyEstimated || line.prevExecutedQty == null || line.newExecutedQty == null) throw new Error('كمية المستخلص غير مثبتة بدقة — راجع التاريخ قبل تحديد المرتجع')
    const previous = milli(line.prevExecutedQty, true), current = milli(line.newExecutedQty, true)
    if (current <= previous) throw new Error('شريحة كمية المستخلص غير صالحة')
    capacity.set(line.boqItemId, current - previous)
  }
  const previous = new Map<number, number>()
  let totalRefunded = 0
  const apply = (rows: readonly ProjectRefundQuantity[], target: Map<number, number>) => {
    if (!Array.isArray(rows) || !rows.length) throw new Error('يلزم تحديد بنود وكميات كل إشعار — راجع التاريخ')
    const seen = new Set<number>()
    for (const row of rows) {
      if (!row || !Number.isSafeInteger(row.boqItemId) || seen.has(row.boqItemId) || !capacity.has(row.boqItemId)) throw new Error('بند الإشعار غير موجود في المستخلص أو مكرر')
      seen.add(row.boqItemId)
      const amount = milli(row.qty)
      const value = (target.get(row.boqItemId) ?? 0) + amount
      if (!Number.isSafeInteger(value) || value > capacity.get(row.boqItemId)!) throw new Error('كمية الإشعار تتجاوز المتبقي من شريحة المستخلص')
      target.set(row.boqItemId, value)
    }
  }
  for (const refund of args.refunds) {
    if (!Number.isSafeInteger(refund.amountMinor) || refund.amountMinor <= 0) throw new Error('قيمة إشعار سابق غير صالحة')
    totalRefunded += refund.amountMinor
    if (!Number.isSafeInteger(totalRefunded)) throw new Error('مجموع الإشعارات غير صالح')
    if (!refund.quantities) throw new Error('إشعار سابق بلا كميات موثقة — راجع التاريخ قبل المتابعة')
    apply(refund.quantities, previous)
  }
  if (totalRefunded !== args.refundedMinor) throw new Error('إجمالي الإشعارات لا يطابق سجل المستخلص — راجع التاريخ')
  const after = new Map(previous)
  apply(args.selected, after)
  return args.selected.map(row => {
    const issued = capacity.get(row.boqItemId)!, prior = previous.get(row.boqItemId) ?? 0, end = after.get(row.boqItemId)!
    return { boqItemId: row.boqItemId, issuedQty: issued / 1000, alreadyReturnedQty: prior / 1000, requestedQty: (end - prior) / 1000, remainingQty: (issued - end) / 1000 }
  })
}
