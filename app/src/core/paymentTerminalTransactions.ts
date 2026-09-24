export type TerminalTransactionKind = 'charge' | 'refund' | 'void'
/** نوع المصدر يمنع تصادم المعرّفات بين فاتورة 1 ونقلة 1 ومستخلص 1. */
export type TerminalDocumentType = 'sale' | 'sale_return' | 'restaurant_order' | 'logistics_trip' | 'project_extract' | 'client_collection' | 'installment' | 'rental' | 'clinic' | 'lab' | 'insurance_claim' | 'maintenance' | 'laundry' | 'wallet_service' | 'car_sale' | 'external_commission' | 'other'
export interface PaymentTerminalTransaction { id: string; idempotencyKey: string; kind: TerminalTransactionKind; terminalId: string; branchId: string; userId: number; documentType?: TerminalDocumentType; documentId: string; amountMinor: number; providerReference: string; occurredAt: string; originalTransactionId?: string; cardLast4?: string }
export function terminalDocumentKey(transaction: Pick<PaymentTerminalTransaction, 'documentType' | 'documentId'>): string {
  return `${transaction.documentType ?? 'sale'}:${transaction.documentId}`
}
export function remainingRefundableMinor(original: PaymentTerminalTransaction, transactions: PaymentTerminalTransaction[]): number {
  const consumed = transactions.filter((row) => row.originalTransactionId === original.id && (row.kind === 'refund' || row.kind === 'void')).reduce((sum, row) => sum + row.amountMinor, 0)
  return Math.max(0, original.amountMinor - consumed)
}

export function validateTerminalTransaction(transaction: PaymentTerminalTransaction, original?: PaymentTerminalTransaction): string[] {
  const errors: string[] = []
  if (!transaction.id.trim() || !transaction.idempotencyKey.trim()) errors.push('معرف العملية ومفتاح منع التكرار مطلوبان')
  if (!transaction.terminalId.trim() || !transaction.documentId.trim()) errors.push('الماكينة والمستند مطلوبان')
  // branchId الفارغ يعني وضع الفرع الواحد، أما عند تعدد الفروع فيفرضه
  // Repository بمطابقة الماكينة والعملية قبل الحفظ.
  if (!Number.isSafeInteger(transaction.amountMinor) || transaction.amountMinor <= 0) errors.push('مبلغ عملية الدفع غير صالح')
  if (!transaction.providerReference.trim()) errors.push('مرجع مزود الدفع مطلوب')
  if (!Number.isFinite(Date.parse(transaction.occurredAt))) errors.push('وقت عملية الدفع غير صالح')
  if (transaction.cardLast4 && !/^\d{4}$/.test(transaction.cardLast4)) errors.push('آخر أربعة أرقام من البطاقة غير صالحة')
  if (transaction.kind !== 'charge') {
    if (!original || transaction.originalTransactionId !== original.id || original.kind !== 'charge') errors.push('الرد أو الإلغاء يجب أن يرتبط بعملية تحصيل أصلية')
    else if (transaction.terminalId !== original.terminalId || transaction.amountMinor > original.amountMinor) errors.push('الرد أو الإلغاء يخالف ماكينة أو مبلغ العملية الأصلية')
  }
  return errors
}
