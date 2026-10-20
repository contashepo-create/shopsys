import { describe, expect, it } from 'vitest'
import { purchaseReceivingVarianceReport } from '../src/core/purchases.ts'

describe('تقرير فرق وزن استلام المشتريات مجمَّعاً حسب المورد والفترة (سد فجوة النشاط #2)', () => {
  const suppliers = [{ id: 1, nameAr: 'مورد الحبوب الذهبية' }]

  it('يتجاهل الفواتير بلا أي سطر له وزن مرسَل مُدخَل', () => {
    const rows = purchaseReceivingVarianceReport(
      [{ date: '2026-01-05', supplierId: 1, lines: [{ itemId: 1, qty: 100 }] }],
      suppliers,
    )
    expect(rows).toEqual([])
  })

  it('يجمع عدة فواتير لنفس المورد في نفس الشهر مع أسوأ نسبة فرق وعدد المرات المتجاوزة للعتبة', () => {
    const rows = purchaseReceivingVarianceReport(
      [
        { date: '2026-01-05', supplierId: 1, lines: [{ itemId: 1, qty: 950, shippedQty: 1000 }] }, // 5%
        { date: '2026-01-20', supplierId: 1, lines: [{ itemId: 1, qty: 990, shippedQty: 1000 }] }, // 1%
      ],
      suppliers,
      2,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ period: '2026-01', supplierId: 1, supplierNameAr: 'مورد الحبوب الذهبية', invoicesCount: 2, maxDiffPercent: 5, exceedsThresholdCount: 1 })
    expect(rows[0].totalDiffQty).toBe(60)
  })

  it('يفصل الموردين والفترات المختلفة في صفوف مستقلة', () => {
    const rows = purchaseReceivingVarianceReport(
      [
        { date: '2026-01-05', supplierId: 1, lines: [{ itemId: 1, qty: 950, shippedQty: 1000 }] },
        { date: '2026-02-05', supplierId: 1, lines: [{ itemId: 1, qty: 950, shippedQty: 1000 }] },
      ],
      suppliers,
    )
    expect(rows.map((r) => r.period)).toEqual(['2026-02', '2026-01'])
  })
})
