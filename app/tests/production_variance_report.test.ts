import { describe, expect, it } from 'vitest'
import { productionVarianceReport, productionVarianceReasonLabel, PRODUCTION_VARIANCE_REASONS } from '../src/core/recipes.ts'

describe('تقرير فرق وزن/هالك التصنيع المجمَّع (سد فجوة النشاط #2: تحويل السبب من نص حر لحقل مصنَّف)', () => {
  const items = [{ id: 1, nameAr: 'علف دواجن نامي' }]

  it('يتجاهل أوامر الإنتاج بلا فرق (varianceQty صفر أو غير موجود)', () => {
    const rows = productionVarianceReport(
      [
        { date: '2026-01-05T00:00:00.000Z', productItemId: 1, varianceQty: 0, varianceReasonCode: null },
        { date: '2026-01-06T00:00:00.000Z', productItemId: 1, varianceQty: null, varianceReasonCode: null },
      ],
      items,
    )
    expect(rows).toEqual([])
  })

  it('يجمع الفرق شهرياً لكل منتج مع تفصيل الأسباب وعددها', () => {
    const rows = productionVarianceReport(
      [
        { date: '2026-01-05T00:00:00.000Z', productItemId: 1, varianceQty: 3, varianceReasonCode: 'moisture_loss' },
        { date: '2026-01-20T00:00:00.000Z', productItemId: 1, varianceQty: 2, varianceReasonCode: 'moisture_loss' },
        { date: '2026-01-25T00:00:00.000Z', productItemId: 1, varianceQty: 1, varianceReasonCode: 'spillage' },
      ],
      items,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ period: '2026-01', productItemId: 1, productNameAr: 'علف دواجن نامي', ordersCount: 3, totalVarianceQty: 6 })
    expect(rows[0].byReason.find((r) => r.code === 'moisture_loss')).toMatchObject({ count: 2, totalQty: 5 })
    expect(rows[0].byReason.find((r) => r.code === 'spillage')).toMatchObject({ count: 1, totalQty: 1 })
  })

  it('يفصل الفترات المختلفة في صفوف منفصلة ويرتبها الأحدث أولاً', () => {
    const rows = productionVarianceReport(
      [
        { date: '2026-01-05T00:00:00.000Z', productItemId: 1, varianceQty: 1, varianceReasonCode: 'other' },
        { date: '2026-02-05T00:00:00.000Z', productItemId: 1, varianceQty: 1, varianceReasonCode: 'other' },
      ],
      items,
    )
    expect(rows.map((r) => r.period)).toEqual(['2026-02', '2026-01'])
  })

  it('productionVarianceReasonLabel يترجم الكود لنص عربي ويقع على fallback لغير معروف', () => {
    expect(productionVarianceReasonLabel('moisture_loss')).toBe('فقد رطوبة أثناء الطحن/الخلط')
    expect(productionVarianceReasonLabel('unknown_code')).toBe('unknown_code')
    expect(productionVarianceReasonLabel(null)).toBe('—')
    expect(PRODUCTION_VARIANCE_REASONS.length).toBeGreaterThanOrEqual(5)
  })
})
