import { describe, expect, it } from 'vitest'
import { suggestReorderLines } from '../src/core/purchaseOrders.ts'

describe('اقتراح أمر شراء تلقائي من حد الطلب (سد فجوة مشتركة: بقالة وأعلاف)', () => {
  it('يرشح الأصناف النشطة تحت حد الطلب فقط ويقترح كمية لإعادة التعبئة لضعف الحد', () => {
    const rows = suggestReorderLines([
      { id: 1, nameAr: 'أرز', baseUnit: 'كيس', stockQty: 2, minQty: 10, costMinor: 500, isActive: true },
      { id: 2, nameAr: 'سكر', baseUnit: 'كيس', stockQty: 50, minQty: 10, costMinor: 400, isActive: true }, // فوق الحد
      { id: 3, nameAr: 'خدمة توصيل', baseUnit: 'خدمة', stockQty: 0, minQty: 5, costMinor: 0, isActive: true, isService: true }, // خدمة
      { id: 4, nameAr: 'صنف معطل', baseUnit: 'قطعة', stockQty: 0, minQty: 5, costMinor: 100, isActive: false }, // معطل
      { id: 5, nameAr: 'بلا حد طلب', baseUnit: 'قطعة', stockQty: 0, minQty: 0, costMinor: 100, isActive: true }, // minQty=0 مستبعد
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ itemId: 1, nameAr: 'أرز', stockQty: 2, minQty: 10, suggestedQty: 18 })
  })

  it('يرتب الأشد نقصاً (أقل نسبة من حده) أولاً', () => {
    const rows = suggestReorderLines([
      { id: 1, nameAr: 'صنف أ', baseUnit: 'قطعة', stockQty: 8, minQty: 10, costMinor: 100, isActive: true },
      { id: 2, nameAr: 'صنف ب', baseUnit: 'قطعة', stockQty: 1, minQty: 10, costMinor: 100, isActive: true },
    ])
    expect(rows.map((r) => r.itemId)).toEqual([2, 1])
  })

  it('مصفوفة فارغة إن لم يوجد نقص', () => {
    expect(suggestReorderLines([{ id: 1, nameAr: 'صنف', baseUnit: 'قطعة', stockQty: 100, minQty: 10, costMinor: 100, isActive: true }])).toEqual([])
  })
})
