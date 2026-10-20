import { describe, expect, it } from 'vitest'
import { abcAnalysis } from '../src/core/reports.ts'

const line = (itemId: number, nameAr: string, qty: number, unitPriceMinor: number, unitCostMinor: number) =>
  ({ itemId, nameAr, qty, unitPriceMinor, unitCostMinor, discountPercent: 0 }) as unknown as import('../src/core/pos.ts').CartLine

const totalsOf = (lines: ReturnType<typeof line>[]): import('../src/core/pos.ts').CartTotals => {
  const gross = lines.reduce((a, l: any) => a + l.unitPriceMinor * l.qty, 0)
  return { grossMinor: gross, discountMinor: 0, netMinor: gross, taxBaseMinor: gross, taxMinor: 0, totalMinor: gross, cogsMinor: 0 }
}

describe('تحليل ABC للأصناف (سد فجوة: لا تصنيف حسب مساهمة الإيراد)', () => {
  it('يصنف A/B/C حسب النسبة التراكمية للإيراد تنازلياً', () => {
    // صنف واحد يشكل 85% من الإيراد وحده ⇒ يظل A (أول صنف دائماً A)
    const lines = [line(1, 'مهيمن', 1, 8500, 0), line(2, 'متوسط', 1, 1000, 0), line(3, 'صغير', 1, 500, 0)]
    const sale = { id: 1, invoiceNumber: 'S-1', date: '2026-09-10', customerId: null, payment: 'cash' as const, lines, totals: totalsOf(lines) }
    const rows = abcAnalysis([sale], [], { from: '2026-09-01', to: '2026-09-30' })
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ itemId: 1, class: 'A', sharePercent: 85 })
    // 85% + 10% = 95% تراكمي ⇒ لا يزال ضمن B (cumBeforePercent=85 >= 80)
    expect(rows[1]).toMatchObject({ itemId: 2, class: 'B' })
    expect(rows[2]).toMatchObject({ itemId: 3, class: 'C' })
  })

  it('يطرح كميات وقيم المرتجعات من إجمالي الصنف', () => {
    const saleLines = [line(1, 'صنف', 10, 100, 0)]
    const sale = { id: 1, invoiceNumber: 'S-1', date: '2026-09-05', customerId: null, payment: 'cash' as const, lines: saleLines, totals: totalsOf(saleLines) }
    const returnLines = [line(1, 'صنف', 4, 100, 0)]
    const ret = { id: 1, date: '2026-09-06', saleId: 1, lines: returnLines, totals: totalsOf(returnLines) }
    const rows = abcAnalysis([sale], [ret], { from: '2026-09-01', to: '2026-09-30' })
    expect(rows[0].qty).toBe(6)
  })

  it('مصفوفة فارغة بلا مبيعات في الفترة', () => {
    expect(abcAnalysis([], [], { from: '2026-09-01', to: '2026-09-30' })).toEqual([])
  })
})
