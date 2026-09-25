import { describe, expect, it } from 'vitest'
import { buildTerminalRefund } from '../src/core/paymentTerminalRefund.ts'
import type { PaymentTerminalTransaction } from '../src/core/paymentTerminalTransactions.ts'
const original: PaymentTerminalTransaction = { id: 'c', idempotencyKey: 'k', kind: 'charge', terminalId: 't', branchId: 'b', userId: 1, documentType: 'laundry', documentId: '1', amountMinor: 1000, providerReference: 'C1', occurredAt: '2026-09-22T10:00:00Z' }
describe('رد الماكينة الموحد', () => {
 it('يربط الرد بالأصل ويحافظ على نوع المستند', () => expect(buildTerminalRefund(original, [original], { documentId: '1:r', amountMinor: 400, providerReference: 'R1', occurredAt: '2026-09-22T11:00:00Z', userId: 2 })).toMatchObject({ kind: 'refund', originalTransactionId: 'c', documentType: 'laundry', amountMinor: 400 }))
 it('يرفض تجاوز المتبقي بعد رد سابق', () => { const prior = { ...original, id: 'r', kind: 'refund' as const, amountMinor: 700, originalTransactionId: 'c' }; expect(() => buildTerminalRefund(original, [original, prior], { documentId: 'x', amountMinor: 301, providerReference: 'R2', occurredAt: '2026-09-22T12:00:00Z', userId: 2 })).toThrow('يتجاوز') })
})
