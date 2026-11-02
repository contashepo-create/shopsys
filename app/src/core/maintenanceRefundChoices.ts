import type { RefundableServiceItem } from './serviceRefund.ts'
import type { StockBatch } from './batches.ts'

interface MaintenanceRefundTicket {
  totals: { laborMinor: number } | null
  services?: { nameAr: string; qty: number; unitPriceMinor: number }[]
  parts: { itemId: number; nameAr: string; qty: number; unitPriceMinor: number; unitCostMinor: number }[]
  partExpiryBatches?: StockBatch[]
  returnedParts?: { itemId: number; qty: number; batches?: { batchId: number; qty: number }[] }[]
}

/** يعرض الدفعات المسجلة فقط، ولا ينسب رداً قديماً بلا سجل إلى دفعة مجهولة. */
export function maintenanceRefundChoices(ticket: MaintenanceRefundTicket): { items: RefundableServiceItem[]; partKeys: string[]; parts: Record<string, { itemId: number; batchId?: number }> } {
  const items: RefundableServiceItem[] = []
  const parts: Record<string, { itemId: number; batchId?: number }> = {}
  if (ticket.totals && ticket.totals.laborMinor > 0) items.push({ key: 'labor', label: 'أجر الفني (المصنعية)', valueMinor: ticket.totals.laborMinor })
  for (const [index, service] of (ticket.services ?? []).entries()) items.push({ key: `svc:${index}`, label: service.nameAr, valueMinor: Math.round(service.qty * service.unitPriceMinor), qty: service.qty })
  for (const [index, part] of ticket.parts.entries()) {
    const prior = (ticket.returnedParts ?? []).filter(row => row.itemId === part.itemId)
    const remaining = part.qty - prior.reduce((sum, row) => sum + row.qty, 0)
    if (remaining <= 0) continue
    const snapshots = (ticket.partExpiryBatches ?? []).filter(row => row.itemId === part.itemId)
    const canIdentify = snapshots.length > 1 && prior.every(row => row.batches?.length)
    if (canIdentify) {
      for (const snapshot of snapshots) {
        const used = prior.flatMap(row => row.batches ?? []).filter(row => row.batchId === snapshot.id).reduce((sum, row) => sum + row.qty, 0)
        const available = Math.round((snapshot.qty - used) * 1000) / 1000
        if (available <= 0) continue
        const key = `part:${index}:batch:${snapshot.id}`
        items.push({ key, label: `قطعة: ${part.nameAr} — دفعة ${snapshot.lotNumber || snapshot.id} · صلاحية ${snapshot.expiryDate ?? 'غير محددة'}`, valueMinor: Math.round(available * part.unitPriceMinor), qty: available, restockCostMinor: Math.round(available * part.unitCostMinor) })
        parts[key] = { itemId: part.itemId, batchId: snapshot.id }
      }
    } else {
      const key = `part:${index}`
      items.push({ key, label: `قطعة: ${part.nameAr}`, valueMinor: Math.round(remaining * part.unitPriceMinor), qty: remaining, restockCostMinor: Math.round(remaining * part.unitCostMinor) })
      parts[key] = { itemId: part.itemId }
    }
  }
  return { items, parts, partKeys: Object.keys(parts) }
}

