import { describe, expect, it } from 'vitest'
import { demandForecast } from '../src/core/reports.ts'

const saleAt = (id: number, date: string, itemId: number, qty: number) =>
  ({ id, invoiceNumber: `S-${id}`, date, customerId: null, payment: 'cash' as const, lines: [{ itemId, nameAr: 'صنف', qty, unitPriceMinor: 100, unitCostMinor: 50, discountPercent: 0 }] as any, totals: { grossMinor: 0, discountMinor: 0, netMinor: 0, taxBaseMinor: 0, taxMinor: 0, totalMinor: 0, cogsMinor: 0 } })

describe('توقع الطلب الإحصائي (سد فجوة مستقبلية: تنبؤ ذكاء اصطناعي)', () => {
  it('يحسب متوسطاً أسبوعياً ويتوقع اتجاهاً صاعداً عند ازدياد المبيعات', () => {
    const today = '2026-09-29'
    const sales = [
      saleAt(1, '2026-08-05', 1, 2), // أسبوع قديم: مبيعات منخفضة
      saleAt(2, '2026-08-06', 1, 2),
      saleAt(3, '2026-09-23', 1, 10), // أسبوع حديث: مبيعات عالية
      saleAt(4, '2026-09-24', 1, 10),
    ]
    const rows = demandForecast(sales, today, 8)
    expect(rows).toHaveLength(1)
    expect(rows[0].itemId).toBe(1)
    expect(rows[0].trendPercent).toBeGreaterThan(0)
    expect(rows[0].forecastNextWeekQty).toBeGreaterThan(0)
  })

  it('يتجاهل الأصناف بلا مبيعات في فترة الرصد ويعيد مصفوفة فارغة', () => {
    expect(demandForecast([], '2026-09-29', 8)).toEqual([])
  })

  it('يرتب تنازلياً حسب الكمية المتوقعة', () => {
    const today = '2026-09-29'
    const sales = [saleAt(1, '2026-09-20', 1, 5), saleAt(2, '2026-09-20', 2, 50)]
    const rows = demandForecast(sales, today, 8)
    expect(rows[0].itemId).toBe(2)
  })
})
