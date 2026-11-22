import { describe, expect, it } from 'vitest'
import { calculatePayrollProjectAmounts, parsePayrollProjectPercentage, payrollProjectExpenseBasis, suggestPayrollProjectPercentages, validateManualPayrollPercentages } from '../src/core/payrollProjectAllocation.ts'

const active = (...ids: number[]) => ids.map(id => ({ id, status: 'active' as const }))

describe('اقتراح نسب الرواتب على المشاريع المشاركة فقط', () => {
  it('يقترح 50٪ لكل مشروع من اثنين، مستقلاً عن ترتيب الإدخال', () => {
    expect(suggestPayrollProjectPercentages(active(20, 10))).toEqual([{ projectId: 10, basisPoints: 5000 }, { projectId: 20, basisPoints: 5000 }])
  })
  it('يوزع أكثر من مشروعين بالتساوي بدقة النسبة ويضمن مجموع 100٪', () => {
    expect(suggestPayrollProjectPercentages(active(3, 2, 1))).toEqual([{ projectId: 1, basisPoints: 3334 }, { projectId: 2, basisPoints: 3333 }, { projectId: 3, basisPoints: 3333 }])
    for (const n of [4, 6, 7, 99, 10000]) {
      const shares = suggestPayrollProjectPercentages(active(...Array.from({ length: n }, (_, index) => index + 1)))
      expect(shares.reduce((sum, share) => sum + share.basisPoints, 0)).toBe(10000)
      expect(shares[0].basisPoints - shares.at(-1)!.basisPoints).toBeLessThanOrEqual(1)
    }
  })
  it('لا يخترع مشروعاً ويقترح 100٪ للمشروع الوحيد', () => {
    expect(suggestPayrollProjectPercentages([])).toEqual([])
    expect(suggestPayrollProjectPercentages(active(1))).toEqual([{ projectId: 1, basisPoints: 10000 }])
  })
  it('يرفض المشاريع المكتملة والمعرفات التالفة أو المكررة', () => {
    expect(() => suggestPayrollProjectPercentages([{ id: 1, status: 'completed' }, ...active(2)])).toThrow(/غير قائم/)
    for (const ids of [[1, 1], [0, 2], [-1, 2], [1.5, 2], [Number.MAX_SAFE_INTEGER + 1, 2]]) {
      expect(() => suggestPayrollProjectPercentages(active(...ids))).toThrow()
    }
  })
})

describe('التحقق من نسب يعدلها المستخدم', () => {
  it('يقبل تعديلاً ويبين الجزء غير الموزع دون ترحيله', () => {
    expect(validateManualPayrollPercentages(active(1, 2), [{ projectId: 1, basisPoints: 2500 }, { projectId: 2, basisPoints: 5000 }])).toEqual({ unallocatedBasisPoints: 2500 })
    expect(validateManualPayrollPercentages(active(1), [{ projectId: 1, basisPoints: 0 }])).toEqual({ unallocatedBasisPoints: 10000 })
    expect(validateManualPayrollPercentages([], [])).toEqual({ unallocatedBasisPoints: 10000 })
  })
  it('يرفض تجاوز 100٪ أو النسب التالفة والمشاريع المفقودة أو الدخيلة', () => {
    const projects = active(1, 2)
    expect(() => validateManualPayrollPercentages(projects, [{ projectId: 1, basisPoints: 5001 }, { projectId: 2, basisPoints: 5000 }])).toThrow(/يتجاوز/)
    for (const value of [-1, 10001, 0.5, NaN, Infinity]) expect(() => validateManualPayrollPercentages(projects, [{ projectId: 1, basisPoints: value }])).toThrow()
    expect(() => validateManualPayrollPercentages(projects, [{ projectId: 1, basisPoints: 0 }])).toThrow(/لكل مشروع/)
    expect(() => validateManualPayrollPercentages(projects, [{ projectId: 1, basisPoints: 0 }, { projectId: 1, basisPoints: 0 }])).toThrow(/مكرر/)
    expect(() => validateManualPayrollPercentages(projects, [{ projectId: 3, basisPoints: 0 }])).toThrow(/غير مشارك/)
  })
  it('يفسر الإدخال العربي والإنجليزي ويرفض الإفراط بالدقة والفواصل الغامضة', () => {
    for (const [input, expected] of [['٥٠', 5000], ['٣٣٫٣٤', 3334], ['33,33', 3333], ['100.00', 10000], ['0', 0], ['۰٫۰۱', 1]] as const) expect(parsePayrollProjectPercentage(input)).toBe(expected)
    for (const input of ['', '-1', '101', '1.001', '1,000', '1,2,3', '1e2', '∞', '١٬٠٠٠', '50%']) expect(() => parsePayrollProjectPercentage(input)).toThrow()
  })
})

describe('معاينة نصيب الموظف من مصروف 5102', () => {
  it('تستخدم الصافي والسلفة المستردة فقط وتتحقق من الحدود', () => {
    expect(payrollProjectExpenseBasis(7000, 2000)).toBe(9000)
    for (const [net, advance] of [[-1, 0], [1, 0.2], [NaN, 1], [Number.MAX_SAFE_INTEGER, 1]]) expect(() => payrollProjectExpenseBasis(net, advance)).toThrow()
  })
  it('توزع الكسور بثبات دون فقد أو زيادة حتى لأكبر مبلغ صحيح آمن', () => {
    const projects = active(1, 2, 3)
    const shares = suggestPayrollProjectPercentages(projects)
    for (const cost of [0, 1, 2, 100, 1000007, Number.MAX_SAFE_INTEGER]) {
      const result = calculatePayrollProjectAmounts(projects, shares, cost)
      expect(result.shares.reduce((sum, row) => sum + row.amountMinor, result.unallocatedMinor)).toBe(cost)
      expect(result.unallocatedMinor).toBe(0)
    }
    expect(calculatePayrollProjectAmounts(projects, shares, 2).shares.map(row => row.amountMinor)).toEqual([1, 1, 0])
    expect(calculatePayrollProjectAmounts(projects, [...shares].reverse(), 2).shares.map(row => [row.projectId, row.amountMinor])).toEqual([[3, 0], [2, 1], [1, 1]])
  })
  it('يُظهر غير الموزع ويعطيه حق التقريب بلا افتراض وجهته', () => {
    const projects = active(1, 2)
    const shares = [{ projectId: 1, basisPoints: 2500 }, { projectId: 2, basisPoints: 2500 }]
    expect(calculatePayrollProjectAmounts(projects, shares, 3)).toEqual({ shares: [{ ...shares[0], amountMinor: 1 }, { ...shares[1], amountMinor: 1 }], unallocatedBasisPoints: 5000, unallocatedMinor: 1 })
    expect(calculatePayrollProjectAmounts([], [], 12)).toEqual({ shares: [], unallocatedBasisPoints: 10000, unallocatedMinor: 12 })
    expect(() => calculatePayrollProjectAmounts(projects, shares, -1)).toThrow()
    expect(() => calculatePayrollProjectAmounts(projects, shares, Number.MAX_SAFE_INTEGER + 1)).toThrow()
  })
})
