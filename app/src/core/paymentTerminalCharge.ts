import type { PaymentTerminal } from './paymentTerminals.ts'
import { validateTerminalTransaction, type PaymentTerminalTransaction, type TerminalDocumentType } from './paymentTerminalTransactions.ts'

export interface TerminalChargeInput {
  terminal: PaymentTerminal
  documentType: TerminalDocumentType
  documentId: string | number
  amountMinor: number
  providerReference: string
  occurredAt: string
  userId: number
  cardLast4?: string
  id?: string
}

/** مصنع موحد لحركة القبض؛ التحقق من الصلاحية/التكرار مسؤولية Repository داخل نفس المعاملة. */
export function buildTerminalCharge(input: TerminalChargeInput): PaymentTerminalTransaction {
  const transaction: PaymentTerminalTransaction = {
    id: input.id ?? crypto.randomUUID(),
    idempotencyKey: `${input.documentType}:${input.documentId}:terminal:${input.terminal.id}`,
    kind: 'charge',
    terminalId: input.terminal.id,
    branchId: input.terminal.branchId,
    userId: input.userId,
    documentType: input.documentType,
    documentId: String(input.documentId),
    amountMinor: input.amountMinor,
    providerReference: input.providerReference.trim(),
    occurredAt: input.occurredAt,
    cardLast4: input.cardLast4,
  }
  const errors = validateTerminalTransaction(transaction)
  if (errors.length) throw new Error(errors.join(' — '))
  return transaction
}
