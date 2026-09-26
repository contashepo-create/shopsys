import { describe, expect, it } from 'vitest'
import { calculateTerminalSettlement, netSettlementTransactions, validateSettlementTransactions } from '../src/core/paymentTerminalSettlement.ts'
describe('تسوية ماكينة الدفع', () => {
 it('تفصل البنك والعمولة وضريبتها دون فرق', () => expect(calculateTerminalSettlement({ grossMinor: 10000, feeMinor: 200, feeTaxMinor: 28, depositedMinor: 9772 })).toEqual({ grossMinor: 10000, feeMinor: 200, feeTaxMinor: 28, depositedMinor: 9772, differenceMinor: 0, balanced: true }))
 it('تكشف فرق كشف البنك', () => expect(calculateTerminalSettlement({ grossMinor: 10000, feeMinor: 200, feeTaxMinor: 28, depositedMinor: 9700 }).differenceMinor).toBe(-72))
 it('ترفض رسوماً تتجاوز التحصيل', () => expect(() => calculateTerminalSettlement({ grossMinor: 100, feeMinor: 101, feeTaxMinor: 0, depositedMinor: 0 })).toThrow('تتجاوز'))
 it('تمنع إدراج العملية مرتين', () => expect(validateSettlementTransactions(['p1', 'p1'])).toContain('عملية دفع مكررة داخل التسوية'))
 it('تحسب صافي العمليات المحددة ولا تثق بإجمالي الواجهة', () => expect(netSettlementTransactions([{ kind: 'charge', amountMinor: 1000 }, { kind: 'refund', amountMinor: 250 }])).toBe(750))
})
