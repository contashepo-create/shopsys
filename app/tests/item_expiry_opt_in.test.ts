import { describe, expect, it } from 'vitest'
import { draftFromCategory, type Category } from '../src/core/items.ts'

describe('تتبع صلاحية الأصناف اختياري', () => {
  it('لا يفعّله تلقائياً حتى عندما يدعم القسم الدفعات والصلاحية', () => {
    const category = { id: 1, nameAr: 'أغذية', parentId: null, features: ['expiry_batches'] } as Category
    const draft = draftFromCategory(category, 'SKU-1')
    expect(draft.trackExpiry).toBe(false)
  })
})
