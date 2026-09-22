import { describe, expect, it } from 'vitest'
import { remainingRefundableMinor, validateTerminalTransaction, type PaymentTerminalTransaction } from '../src/core/paymentTerminalTransactions.ts'
const charge: PaymentTerminalTransaction = { id: 'p1', idempotencyKey: 'k1', kind: 'charge', terminalId: 't1', branchId: 'b1', userId: 7, documentId: 'inv1', amountMinor: 10000, providerReference: 'R100', occurredAt: '2026-09-22T09:00:00Z', cardLast4: '1234' }
describe('عمليات ماكينة الدفع', () => {
 it('يثبت الماكينة والفرع والمستخدم والمستند', () => expect(validateTerminalTransaction(charge)).toEqual([]))
 it('يقبل رداً جزئياً مرتبطاً بالأصل', () => expect(validateTerminalTransaction({ ...charge, id: 'r1', idempotencyKey: 'k2', kind: 'refund', amountMinor: 2000, originalTransactionId: 'p1' }, charge)).toEqual([]))
 it('يرفض رداً من ماكينة أخرى أو أكبر من الأصل', () => expect(validateTerminalTransaction({ ...charge, id: 'r1', kind: 'refund', terminalId: 't2', amountMinor: 11000, originalTransactionId: 'p1' }, charge)).toContain('الرد أو الإلغاء يخالف ماكينة أو مبلغ العملية الأصلية'))
 it('لا يسمح بتخزين أكثر من آخر أربعة أرقام', () => expect(validateTerminalTransaction({ ...charge, cardLast4: '4111111111111111' })).toContain('آخر أربعة أرقام من البطاقة غير صالحة'))
 it('يحسب المتبقي بعد عدة ردود وإلغاءات تراكمياً', () => expect(remainingRefundableMinor(charge, [{ ...charge, id: 'r1', kind: 'refund', amountMinor: 2000, originalTransactionId: charge.id }, { ...charge, id: 'v1', kind: 'void', amountMinor: 1000, originalTransactionId: charge.id }])).toBe(7000))
})
