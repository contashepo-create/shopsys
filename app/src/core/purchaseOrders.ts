/**
 * أوامر الشراء (Purchase Orders) — طلب المالك.
 *
 * أمر الشراء **التزام تجاري لا قيد محاسبي**: لا يمسّ المخزون ولا الدفتر، وإنما
 * يوثّق ما طُلب من المورد بكمياته وأسعاره، ثم تُعبَّأ منه فاتورة الشراء
 * («تعبئة من») فيُرحَّل الأثر المحاسبي عند الفاتورة وحدها.
 */
import type { Minor } from './money.ts'

export type PurchaseOrderStatus = 'draft' | 'sent' | 'partial' | 'closed' | 'cancelled'

export const PURCHASE_ORDER_STATUS_AR: Record<PurchaseOrderStatus, string> = {
  draft: 'مسودة',
  sent: 'مُرسل للمورد',
  partial: 'مستلم جزئياً',
  closed: 'مكتمل',
  cancelled: 'ملغى',
}

export interface PurchaseOrderLine {
  itemId: number
  nameAr: string
  qty: number
  /** الكمية المستلمة فعلاً عبر فواتير الشراء */
  receivedQty: number
  unitAr: string
  unitPriceMinor: Minor
  /** نسبة ضريبة البند؛ 0 = بلا ضريبة */
  vatPercent: number
  notes: string
}

export interface PurchaseOrder {
  id: number
  orderNumber: string // PO-0001
  supplierId: number | null
  supplierName: string
  date: string // YYYY-MM-DD
  expectedDate: string
  warehouseId: number | null
  status: PurchaseOrderStatus
  lines: PurchaseOrderLine[]
  notes: string
  /** فواتير الشراء التي عُبِّئت من هذا الأمر */
  invoiceIds: number[]
  createdAt: string
}

export const poLineNetMinor = (line: PurchaseOrderLine): Minor => Math.round(line.qty * line.unitPriceMinor)
export const poLineTaxMinor = (line: PurchaseOrderLine): Minor => Math.round(poLineNetMinor(line) * (line.vatPercent || 0) / 100)
export const poLineTotalMinor = (line: PurchaseOrderLine): Minor => poLineNetMinor(line) + poLineTaxMinor(line)

export function purchaseOrderTotals(lines: PurchaseOrderLine[]): { netMinor: Minor; taxMinor: Minor; totalMinor: Minor; qty: number } {
  return lines.reduce(
    (sum, line) => ({
      netMinor: sum.netMinor + poLineNetMinor(line),
      taxMinor: sum.taxMinor + poLineTaxMinor(line),
      totalMinor: sum.totalMinor + poLineTotalMinor(line),
      qty: sum.qty + line.qty,
    }),
    { netMinor: 0, taxMinor: 0, totalMinor: 0, qty: 0 },
  )
}

/** ما تبقّى من الأمر بعد ما استُلم — أساس «تعبئة من» في الفاتورة */
export const poRemainingQty = (line: PurchaseOrderLine): number => Math.max(0, line.qty - (line.receivedQty || 0))
export const poIsFulfilled = (order: PurchaseOrder): boolean => order.lines.every((line) => poRemainingQty(line) <= 0)

export function validatePurchaseOrder(input: { supplierName: string; date: string; lines: PurchaseOrderLine[] }): string[] {
  const errors: string[] = []
  if (!input.supplierName.trim()) errors.push('اسم المورد مطلوب')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) errors.push('تاريخ الأمر غير صحيح')
  if (!input.lines.length) errors.push('أضف بنداً واحداً على الأقل')
  input.lines.forEach((line, index) => {
    if (!line.itemId && !line.nameAr.trim()) errors.push(`السطر ${index + 1}: بلا صنف`)
    if (!(line.qty > 0)) errors.push(`السطر ${index + 1}: الكمية يجب أن تكون أكبر من صفر`)
    if (line.unitPriceMinor < 0) errors.push(`السطر ${index + 1}: سعر سالب`)
    if (line.vatPercent < 0 || line.vatPercent > 100) errors.push(`السطر ${index + 1}: نسبة ضريبة غير منطقية`)
  })
  return errors
}

/** حالة الأمر محسوبة من المستلم — لا تُكتب يدوياً إلا للإلغاء */
export function derivePurchaseOrderStatus(order: PurchaseOrder): PurchaseOrderStatus {
  if (order.status === 'cancelled') return 'cancelled'
  const received = order.lines.reduce((sum, line) => sum + (line.receivedQty || 0), 0)
  if (received <= 0) return order.status === 'sent' ? 'sent' : order.status
  return poIsFulfilled(order) ? 'closed' : 'partial'
}
