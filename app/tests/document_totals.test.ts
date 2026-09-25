import { describe, expect, it } from 'vitest'
import { assertDocumentTotals, calculateDocumentTotals } from '../src/core/documentTotals.ts'
describe('إجماليات المستند', () => {
 it('يحسب الإجمالي والمستحق بوحدات minor', () => expect(calculateDocumentTotals({ subtotalMinor: 10000, discountMinor: 500, chargeMinor: 300, taxMinor: 1372, paidMinor: 4000 })).toEqual({ subtotalMinor: 10000, discountMinor: 500, chargeMinor: 300, taxMinor: 1372, paidMinor: 4000, grandTotalMinor: 11172, dueMinor: 7172 }))
 it('يرفض المدفوع الزائد', () => expect(() => calculateDocumentTotals({ subtotalMinor: 100, discountMinor: 0, chargeMinor: 0, taxMinor: 0, paidMinor: 101 })).toThrow('المدفوع'))
 it('يرفض قيمة غير صحيحة', () => expect(() => calculateDocumentTotals({ subtotalMinor: 1.5, discountMinor: 0, chargeMinor: 0, taxMinor: 0, paidMinor: 0 })).toThrow('غير صالحة'))
 it('يكشف العبث بالإجماليات المخزنة', () => expect(() => assertDocumentTotals({ subtotalMinor: 100, discountMinor: 0, chargeMinor: 0, taxMinor: 0, paidMinor: 0, grandTotalMinor: 99, dueMinor: 99 })).toThrow('غير متوازنة'))
})
