import { remainingRefundableMinor, validateTerminalTransaction, type PaymentTerminalTransaction } from './paymentTerminalTransactions.ts'
export function buildTerminalRefund(original: PaymentTerminalTransaction, transactions: PaymentTerminalTransaction[], input: { documentId: string | number; amountMinor: number; providerReference: string; occurredAt: string; userId: number }): PaymentTerminalTransaction {
  if (input.amountMinor > remainingRefundableMinor(original, transactions)) throw new Error('إجمالي ردود الماكينة يتجاوز المتبقي من التحصيل')
  const row: PaymentTerminalTransaction = { id: crypto.randomUUID(), idempotencyKey: `refund:${original.id}:${input.documentId}`, kind: 'refund', terminalId: original.terminalId, branchId: original.branchId, userId: input.userId, documentType: original.documentType, documentId: String(input.documentId), amountMinor: input.amountMinor, providerReference: input.providerReference.trim(), occurredAt: input.occurredAt, originalTransactionId: original.id, cardLast4: original.cardLast4 }
  const errors = validateTerminalTransaction(row, original); if (errors.length) throw new Error(errors.join(' — ')); return row
}
