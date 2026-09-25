import { describe, expect, it } from 'vitest'
import { buildProductionEntry } from '../src/core/recipes.ts'

describe('استحقاق مصروفات التصنيع', () => {
  it('يحمّل المنتج ولا يخصم خزينة وقت التصنيع', () => {
    const lines = buildProductionEntry(10_000, 0, '1101', [
      { id: 'bags', label: 'أكياس تعبئة', accountCode: '5103', amountMinor: 2_000, payableAccountCode: '2117' },
      { id: 'labor', label: 'عمالة أسبوعية', accountCode: '5102', amountMinor: 3_000, payableAccountCode: '2104' },
    ])
    expect(lines.find((line) => line.accountCode === '1101')).toBeUndefined()
    expect(lines.find((line) => line.accountCode === '2117')?.credit).toBe(2_000)
    expect(lines.find((line) => line.accountCode === '2104')?.credit).toBe(3_000)
    expect(lines.find((line) => line.accountCode === '1103' && line.debit > 0)?.debit).toBe(15_000)
  })
})
