import { describe, expect, it } from 'vitest'
import { purchaseWeightDiscrepancy } from '../src/core/purchases.ts'

describe('فرق وزن/كمية استلام فاتورة الشراء (سد فجوة النشاط #2: تجارة الأعلاف والحبوب)', () => {
  it('يحسب الفرق والنسبة المئوية فقط للسطور التي أُدخل لها وزن مرسَل', () => {
    const rows = purchaseWeightDiscrepancy([
      { itemId: 1, nameAr: 'ذرة صفراء', shippedQty: 1000, receivedQty: 980 }, // نقص 2% بالضبط
      { itemId: 2, nameAr: 'صويا', shippedQty: 500, receivedQty: 500 }, // بلا فرق
      { itemId: 3, nameAr: 'دريس', shippedQty: 0, receivedQty: 200 }, // لم يُدخل وزن مرسَل — يُستبعد
    ])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ itemId: 1, diffQty: 20, diffPercent: 2, exceedsThreshold: false })
    expect(rows[1]).toMatchObject({ itemId: 2, diffQty: 0, diffPercent: 0, exceedsThreshold: false })
  })

  it('يعلّم السطر exceedsThreshold عند تجاوز النسبة المسموحة', () => {
    const rows = purchaseWeightDiscrepancy(
      [{ itemId: 1, nameAr: 'ذرة', shippedQty: 1000, receivedQty: 950 }], // نقص 5%
      2,
    )
    expect(rows[0].exceedsThreshold).toBe(true)
    expect(rows[0].diffPercent).toBe(5)
  })

  it('يتعامل مع حالة الزيادة عند الاستلام (رقم سالب)', () => {
    const rows = purchaseWeightDiscrepancy([{ itemId: 1, nameAr: 'ذرة', shippedQty: 1000, receivedQty: 1010 }])
    expect(rows[0].diffQty).toBe(-10)
    expect(rows[0].diffPercent).toBe(1)
  })
})
