import { describe, expect, it } from 'vitest'
import { computeRecipeNutrition } from '../src/core/recipes.ts'

describe('محرك تركيب الأعلاف الغذائي المبسط الاختياري (سد فجوة مستقبلية من تقرير النشاط #2)', () => {
  it('يحسب المتوسط المرجح لنسبة البروتين والطاقة حسب وزن كل خامة', () => {
    const nutrition = new Map([
      [1, { proteinPercent: 9, energyKcalPerKg: 3300 }], // ذرة
      [2, { proteinPercent: 44, energyKcalPerKg: 2230 }], // كسب صويا
    ])
    const result = computeRecipeNutrition(
      [
        { itemId: 1, qty: 700 },
        { itemId: 2, qty: 300 },
      ],
      nutrition,
    )
    expect(result.totalQty).toBe(1000)
    // (700×9 + 300×44) / 1000 = 19.5
    expect(result.proteinPercent).toBe(19.5)
    expect(result.missingDataItemIds).toEqual([])
  })

  it('يستبعد الخامات بلا بيانات غذائية ويرصدها في missingDataItemIds بدل افتراض صفر', () => {
    const nutrition = new Map([[1, { proteinPercent: 9, energyKcalPerKg: 3300 }]])
    const result = computeRecipeNutrition(
      [
        { itemId: 1, qty: 500 },
        { itemId: 2, qty: 500 }, // بلا بيانات
      ],
      nutrition,
    )
    expect(result.proteinPercent).toBe(9) // من الخامة 1 فقط
    expect(result.missingDataItemIds).toEqual([2])
  })

  it('يُرجع null لكل من البروتين والطاقة إن لم تتوفر أي بيانات غذائية إطلاقاً', () => {
    const result = computeRecipeNutrition([{ itemId: 1, qty: 100 }], new Map())
    expect(result.proteinPercent).toBeNull()
    expect(result.energyKcalPerKg).toBeNull()
    expect(result.missingDataItemIds).toEqual([1])
  })
})
