import { describe, expect, it } from 'vitest'
import { markdownSuggestions, type StockBatch } from '../src/core/batches.ts'

const batch = (id: number, itemId: number, expiryDate: string, qty = 10): StockBatch =>
  ({ id, itemId, expiryDate, qty, purchaseId: 1, receivedAt: '2026-09-01T00:00:00.000Z', lotNumber: `LOT-${id}` })

describe('اقتراح تسعير تصاعدي قرب الانتهاء (سد فجوة مستقبلية: تسعير ديناميكي)', () => {
  it('يقترح خصماً أعلى كلما قرب الانتهاء ولا يقترح شيئاً للمنتهي فعلاً', () => {
    const today = '2026-09-20'
    const batches = [
      batch(1, 1, '2026-09-21'), // غداً — خصم مرتفع
      batch(2, 2, '2026-09-26'), // بعد 6 أيام — خصم أقل
      batch(3, 3, '2026-09-10'), // منتهٍ فعلاً — لا يُقترح له خصم (مرشح إتلاف)
    ]
    const items = [
      { id: 1, nameAr: 'لبن', priceMinor: 1000 },
      { id: 2, nameAr: 'جبن', priceMinor: 2000 },
      { id: 3, nameAr: 'زبادي', priceMinor: 500 },
    ]
    const rows = markdownSuggestions(batches, items, today, 7)
    expect(rows.map((r) => r.itemId).sort()).toEqual([1, 2])
    const soonRow = rows.find((r) => r.itemId === 1)!
    const laterRow = rows.find((r) => r.itemId === 2)!
    expect(soonRow.suggestedDiscountPercent).toBeGreaterThan(laterRow.suggestedDiscountPercent)
    expect(soonRow.suggestedPriceMinor).toBeLessThan(soonRow.currentPriceMinor)
  })

  it('مصفوفة فارغة بلا دفعات قريبة الانتهاء', () => {
    expect(markdownSuggestions([], [], '2026-09-20', 7)).toEqual([])
  })
})
