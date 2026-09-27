import { describe, expect, it } from 'vitest'
import { buildSaleEntryWithAllocations, type CartTotals } from '../src/core/pos.ts'

const totals: CartTotals = { grossMinor: 10_000, discountMinor: 0, netMinor: 10_000, taxBaseMinor: 10_000, taxMinor: 0, totalMinor: 10_000, cogsMinor: 4_000 }

describe('التحصيل المختلط لفاتورة البيع', () => {
  it('يوزع الخزينة والماكينة والباقي على العميل', () => {
    const lines = buildSaleEntryWithAllocations(totals, [{ accountCode: '1101', amountMinor: 3000 }, { accountCode: '1102', amountMinor: 5000, note: 'ماكينة' }])
    expect(lines.find((line) => line.accountCode === '1101')?.debit).toBe(3000)
    expect(lines.find((line) => line.accountCode === '1102')?.debit).toBe(5000)
    expect(lines.find((line) => line.accountCode === '1104')?.debit).toBe(2000)
    expect(lines.reduce((sum, line) => sum + line.debit - line.credit, 0)).toBe(0)
  })
  it('يرفض تجاوز إجمالي الفاتورة', () => expect(() => buildSaleEntryWithAllocations(totals, [{ accountCode: '1101', amountMinor: 10_001 }])).toThrow())
})
