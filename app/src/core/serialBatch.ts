import type { StockBatch, FefoPlan } from './batches.ts'
import { normalizeSerial, type SerialUnit } from './serials.ts'

/** الهوية الثابتة لدفعة، بمعزل عن كمية رصيدها ورقمها الذي قد يعاد استخدامه بعد النفاد. */
export function sameSerialBatch(a: StockBatch, b: StockBatch): boolean {
  return a.itemId === b.itemId && a.purchaseId === b.purchaseId && a.warehouseId === b.warehouseId && a.lotNumber === b.lotNumber && a.expiryDate === b.expiryDate && a.receivedAt === b.receivedAt
}

/** خطط صرف الوحدات المعينة فقط، ولا تستخدم FEFO كبديل عن إثبات هوية السيريال. */
export function planSerialBatches(units: readonly SerialUnit[], batches: readonly StockBatch[], itemId: number, serials: readonly string[], today: string): FefoPlan {
  const counts = new Map<number, number>()
  for (const serial of serials) {
    const found = units.filter(unit => normalizeSerial(unit.serial) === normalizeSerial(serial))
    const unit = found[0]
    if (found.length !== 1 || unit.serial !== serial || unit.itemId !== itemId || unit.status !== 'in_stock' || unit.saleId != null || unit.maintenanceTicketId != null || !unit.expiryBatch || !Number.isSafeInteger(unit.batchId)) throw new Error(`ربط السيريال ${serial} بدفعة الصلاحية غير مثبت — يلزم المراجعة`)
    const matching = batches.filter(batch => sameSerialBatch(batch, unit.expiryBatch!))
    if (matching.length !== 1 || matching[0].id !== unit.batchId || matching[0].purchaseId !== unit.purchaseId) throw new Error(`دفعة صلاحية السيريال ${serial} غير متاحة أو متعارضة — يلزم المراجعة`)
    counts.set(matching[0].id, (counts.get(matching[0].id) ?? 0) + 1)
  }
  const allocations = [...counts].map(([batchId, qty]) => {
    const matches = batches.filter(batch => batch.id === batchId)
    const batch = matches[0]
    if (matches.length !== 1 || !Number.isSafeInteger(batch.qty) || batch.qty < qty || units.filter(unit => unit.status === 'in_stock' && unit.expiryBatch && sameSerialBatch(unit.expiryBatch, batch)).length > batch.qty) throw new Error('رصيد دفعة صلاحية السيريال غير كافٍ أو متعارض — يلزم المراجعة')
    return { batchId, qty, expiryDate: batch.expiryDate, expired: batch.expiryDate != null && batch.expiryDate < today.slice(0, 10) }
  })
  return { allocations, untrackedQty: 0, touchesExpired: allocations.some(row => row.expired) }
}
