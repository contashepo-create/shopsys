import { describe, expect, it } from 'vitest'
import { draftFromCategory, priceFloorViolations, type Category } from '../src/core/items.ts'

describe('تتبع صلاحية الأصناف اختياري', () => {
  it('لا يفعّل الصلاحية تلقائياً حتى لو كان نشاط القسم يدعمها', () => {
    const category = { id: 1, nameAr: 'أغذية', parentId: null, features: ['expiry_batches'] } as Category
    const draft = draftFromCategory(category, 'SKU-1')
    expect(draft.trackExpiry).toBe(false)
    expect({ ...draft, trackExpiry: true }.trackExpiry).toBe(true)
  })

  it('ينبه عند البيع بأقل من التكلفة حتى دون ضبط حد سعر منفصل', () => {
    expect(priceFloorViolations([{ itemId: 1, unitPriceMinor: 90, discountPercent: 0 }], [{ id: 1, nameAr: 'صنف', costMinor: 100, minSalePriceMinor: 0 }])).toEqual(['صنف'])
  })
})
