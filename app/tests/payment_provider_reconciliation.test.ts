import { describe, expect, it } from 'vitest'
import { reconcileProviderStatement } from '../src/core/paymentProviderReconciliation.ts'
import type { PaymentTerminalTransaction } from '../src/core/paymentTerminalTransactions.ts'
const tx: PaymentTerminalTransaction = { id: 'p1', idempotencyKey: 'k1', kind: 'charge', terminalId: 't1', branchId: 'b1', userId: 1, documentId: 'd1', amountMinor: 1000, providerReference: 'R1', occurredAt: '2026-09-22T00:00:00Z' }
describe('مطابقة كشف مزود الدفع', () => {
 it('يطابق المرجع والمبلغ', () => expect(reconcileProviderStatement('t1', [{ providerReference: 'R1', amountMinor: 1000 }], [tx])[0].status).toBe('matched'))
 it('يكشف المرجع المفقود محلياً', () => expect(reconcileProviderStatement('t1', [{ providerReference: 'R2', amountMinor: 1000 }], [tx])[0].status).toBe('missing_local'))
 it('يكشف اختلاف المبلغ', () => expect(reconcileProviderStatement('t1', [{ providerReference: 'R1', amountMinor: 900 }], [tx])[0]).toMatchObject({ status: 'amount_mismatch', localAmountMinor: 1000 }))
 it('يكشف تكرار المرجع في الكشف', () => expect(reconcileProviderStatement('t1', [{ providerReference: 'R1', amountMinor: 1000 }, { providerReference: 'R1', amountMinor: 1000 }], [tx])[1].status).toBe('duplicate_statement'))
 it('يقارن الرد بقيمة سالبة', () => expect(reconcileProviderStatement('t1', [{ providerReference: 'RR', amountMinor: -200 }], [{ ...tx, id: 'r1', kind: 'refund', providerReference: 'RR', amountMinor: 200 }])[0].status).toBe('matched'))
})
