import { describe, expect, it } from 'vitest'
import { summarizeTerminalReconciliation, summarizeTerminalTransactions, terminalReportCsv } from '../src/core/paymentTerminalReport.ts'
import type { PaymentTerminalTransaction } from '../src/core/paymentTerminalTransactions.ts'
const make = (id: string, kind: PaymentTerminalTransaction['kind'], amountMinor: number, userId = 1, occurredAt = '2026-09-22T10:00:00Z'): PaymentTerminalTransaction => ({ id, idempotencyKey: `k-${id}`, kind, terminalId: 't1', branchId: 'b1', userId, documentId: 'd1', amountMinor, providerReference: `r-${id}`, occurredAt, ...(kind === 'charge' ? {} : { originalTransactionId: 'p1' }) })
describe('تقرير ماكينة الدفع', () => {
 it('يجمع التحصيل والرد والإلغاء وصافيها', () => expect(summarizeTerminalTransactions([make('p1', 'charge', 1000), make('r1', 'refund', 200), make('v1', 'void', 100)])[0]).toMatchObject({ chargeMinor: 1000, refundMinor: 200, voidMinor: 100, netMinor: 700, transactionCount: 3 }))
 it('يفصل المستخدمين على الماكينة نفسها', () => expect(summarizeTerminalTransactions([make('p1', 'charge', 1000), make('p2', 'charge', 500, 2)])).toHaveLength(2))
 it('يرشح الفترة', () => expect(summarizeTerminalTransactions([make('p1', 'charge', 1000, 1, '2026-09-20T10:00:00Z')], '2026-09-21')).toEqual([]))
 it('يعيد نتيجة فارغة بلا عمليات', () => expect(summarizeTerminalTransactions([])).toEqual([]))
 it('يصدر CSV عربي بوحدات minor مع BOM', () => { const csv = terminalReportCsv(summarizeTerminalTransactions([make('p1', 'charge', 1000)])); expect(csv.startsWith('\uFEFF')).toBe(true); expect(csv).toContain('"1000"') })
 it('يفصل المسوى عن المعلق ويحمل الرد بالسالب', () => { const txs = [make('p1', 'charge', 1000), make('r1', 'refund', 200)]; const settlements = [{ id: 's1', terminalId: 't1', bankAccountCode: '1102', transactionIds: ['p1'], settledAt: '2026-09-22T12:00:00Z', userId: 1, grossMinor: 1000, feeMinor: 0, feeTaxMinor: 0, depositedMinor: 1000, differenceMinor: 0, journalEntryId: 1 }]; expect(summarizeTerminalReconciliation(txs, settlements)[0]).toMatchObject({ settledCount: 1, unsettledCount: 1, unsettledNetMinor: -200 }) })
})
