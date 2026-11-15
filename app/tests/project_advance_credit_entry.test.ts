import { describe, expect, it } from 'vitest'
import { planProjectAdvanceCreditEntry } from '../src/core/projectAdvanceCreditEntry.ts'
import { assertBalanced } from '../src/core/ledger.ts'

const basis = { grossMinor: 4000, taxMinor: 600, retentionMinor: 400, amountMinor: 4200, restoredAdvanceMinor: 1200, mode: 'customer_credit' as const, treasuryCodes: new Set(['1101', '1121']) }
const amounts = (lines: ReturnType<typeof planProjectAdvanceCreditEntry>['lines']) => Object.fromEntries(lines.map(line => [line.accountCode, [line.debit, line.credit]]))
describe('قيد تجريبي لتوزيع إشعار المقدمة', () => {
  it('يفصل الإيراد والضريبة والمحتجز والمقدمة ونصيب العميل دون ترحيل', () => {
    const before = { ...basis, treasuryCodes: new Set(basis.treasuryCodes) }
    const result = planProjectAdvanceCreditEntry(basis)
    expect(result.settlementMinor).toBe(3000)
    expect(amounts(result.lines)).toEqual({ '4102': [4000, 0], '2102': [600, 0], '1105': [0, 400], '2109': [0, 1200], '1104': [0, 3000] })
    expect(() => assertBalanced(result.lines)).not.toThrow(); expect(basis).toEqual(before)
  })
  it('يفصل تسوية الخزينة عن المقدمة ولا يولد حركة ماكينة', () => {
    const result = planProjectAdvanceCreditEntry({ ...basis, mode: 'cash', treasury: '1121' })
    expect(result.settlementMinor).toBe(3000); expect(amounts(result.lines)['1121']).toEqual([0, 3000]); expect(amounts(result.lines)['1104']).toBeUndefined()
  })
  it('يحذف السطور الصفرية وعند رد كامل المستحق للمقدمة لا يختلق دفعاً أو ذمة', () => {
    const result = planProjectAdvanceCreditEntry({ ...basis, restoredAdvanceMinor: 4200, mode: 'cash' })
    expect(result.settlementMinor).toBe(0); expect(result.lines.some(row => row.accountCode === '1104' || row.accountCode === '1101')).toBe(false)
    expect(amounts(result.lines)['2109']).toEqual([0, 4200]); expect(() => assertBalanced(result.lines)).not.toThrow()
  })
  it('يرفض الكسر أو تجاوز المبلغ أو علاقات الأعمال والمحتجز التالفة والخزائن غير المثبتة', () => {
    for (const delta of [{ restoredAdvanceMinor: 4201 }, { taxMinor: 599 }, { retentionMinor: -1 }, { grossMinor: 1.5 }, { amountMinor: NaN }, { mode: 'cash', treasury: '1104' }, { mode: 'cash', treasury: '2109' }, { mode: 'cash', treasury: '9999' }]) {
      expect(() => planProjectAdvanceCreditEntry({ ...basis, ...delta } as typeof basis)).toThrow(/غير صالح/)
    }
  })
  it('يتزن لكل جزء صحيح من المقدمة بما في ذلك الصفر', () => {
    for (let grossMinor = 1; grossMinor <= 10; grossMinor++) for (let retentionMinor = 0; retentionMinor < grossMinor; retentionMinor++) for (let restoredAdvanceMinor = 0; restoredAdvanceMinor <= grossMinor - retentionMinor; restoredAdvanceMinor++) {
      const amountMinor = grossMinor - retentionMinor
      const result = planProjectAdvanceCreditEntry({ ...basis, grossMinor, taxMinor: 0, retentionMinor, amountMinor, restoredAdvanceMinor })
      expect(result.settlementMinor).toBe(amountMinor - restoredAdvanceMinor); expect(() => assertBalanced(result.lines)).not.toThrow()
    }
  })
})
