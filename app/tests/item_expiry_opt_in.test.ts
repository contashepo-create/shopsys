import { describe, expect, it } from 'vitest'
import { draftFromCategory, type Category } from '../src/core/items.ts'

describe('تتبع صلاحية الأصناف اختياري', () => {
  it('يورث دعم الدفعات والصلاحية من القسم مع بقاء الاختيار الفردي ممكناً', () => {
    const category = { id: 1, nameAr: 'أغذية', parentId: null, features: ['expiry_batches'] } as Category
    const draft = draftFromCategory(category, 'SKU-1')
    expect(draft.trackExpiry).toBe(true)
    expect({ ...draft, trackExpiry: false }.trackExpiry).toBe(false)
  })
})
