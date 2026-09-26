import { describe, expect, it } from 'vitest'
import { applyFefo, planFefo, type StockBatch } from '../src/core/batches.ts'

describe('دفعات خامات التصنيع حسب المخزن', () => {
  const batches: StockBatch[] = [
    { id: 1, itemId: 10, warehouseId: 1, lotNumber: 'WH1-OLD', expiryDate: '2026-10-01', qty: 5, purchaseId: 1, receivedAt: '2026-01-01' },
    { id: 2, itemId: 10, warehouseId: 2, lotNumber: 'WH2-NEW', expiryDate: '2026-11-01', qty: 5, purchaseId: 2, receivedAt: '2026-01-02' },
  ]
  it('لا يستهلك دفعة خام من مخزن آخر رغم أن صلاحيتها أقرب', () => {
    const plan = planFefo(batches, 10, 3, '2026-09-24', 2)
    expect(plan.allocations).toEqual([{ batchId: 2, qty: 3, expiryDate: '2026-11-01', expired: false }])
    const updated = applyFefo(batches, plan)
    expect(updated.find(batch => batch.id === 1)?.qty).toBe(5)
    expect(updated.find(batch => batch.id === 2)?.qty).toBe(2)
  })
  it('يرفض المنتهي داخل مخزن الصرف المحدد', () => {
    const plan = planFefo([{ ...batches[1], expiryDate: '2026-09-01' }], 10, 1, '2026-09-24', 2)
    expect(plan.touchesExpired).toBe(true)
  })
})
