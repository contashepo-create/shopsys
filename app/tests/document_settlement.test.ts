import { describe, expect, it } from 'vitest'
import { settlementSummary, validateSettlements } from '../src/core/documentSettlement.ts'
const row = { id: 'pay-1', documentId: 'inv-1', amountMinor: 400, settledAt: '2026-09-22T00:00:00Z', method: 'cash' as const, voided: false }
describe('تسويات المستند', () => {
 it('يحسب السداد الجزئي', () => expect(settlementSummary(1000, [row])).toEqual({ paidMinor: 400, dueMinor: 600, status: 'partial' }))
 it('يستبعد التسوية الملغاة دون حذف أثرها', () => expect(settlementSummary(1000, [{ ...row, voided: true }]).status).toBe('unpaid'))
 it('يرفض تكرار المعرف وتجاوز الإجمالي', () => expect(validateSettlements('inv-1', 500, [row, { ...row, id: 'pay-1', amountMinor: 200 }])).toEqual(expect.arrayContaining(['معرف تسوية فارغ أو مكرر', 'التسويات تتجاوز إجمالي المستند'])))
 it('يرفض ربط تسوية بمستند آخر', () => expect(validateSettlements('inv-2', 1000, [row])).toContain('التسوية تخص مستنداً آخر'))
})
