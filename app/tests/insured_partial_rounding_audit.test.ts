import { expect, it } from 'vitest'
import { insuredPartialAmounts } from '../src/core/insurance.ts'
it('يوزع كل البواقي دون قيم سالبة عند رد وحدات متتابعة مهما صغرت مبالغ الضرائب والتغطية', () => {
 for (let qty = 2; qty <= 7; qty++) for (let total = qty; total <= 16; total++) for (let tax = 0; tax <= total; tax++) for (let provider = 0; provider <= total; provider++) {
  const basis = { itemId: 1, qty, warehouseId: null, revenueMinor: total - tax, taxMinor: tax, providerMinor: provider, costMinor: total + 1 }
  const rows = Array.from({ length: qty }, (_, i) => insuredPartialAmounts(basis, i, 1))
  expect(rows.every(row => Object.values(row).every(v => Number.isSafeInteger(v) && v >= 0) && row.revenue + row.tax === row.total && row.provider + row.patient === row.total)).toBe(true)
  const sum = (key: keyof typeof rows[number]) => rows.reduce((a, row) => a + row[key], 0)
  expect([sum('revenue'), sum('tax'), sum('provider'), sum('patient'), sum('cost')]).toEqual([total - tax, tax, provider, total - provider, total + 1])
 }
})
