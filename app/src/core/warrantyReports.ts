/**
 * تقارير الضمان — ShopSys (سد فجوة فورية #4 — النشاط #6: أجهزة كهربائية)
 * ─────────────────────────────────────────────────────────────────────
 * منطق خالص بلا واجهة:
 * 1) «معدل إقران الضمان الممتد» (Attach Rate نمط BestBuy/Lightspeed):
 *    نسبة قطع السيريال المباعة في فترة ما والمرفق بها ضمان ممتد.
 * 2) «معدل تكرار مطالبات الضمان» لكل صنف: عدد تذاكر الصيانة لكل قطعة
 *    سيريال مباعة ضمن مدة ضمانها، مجمّعة بالصنف — يكشف الأصناف ذات معدل
 *    أعطال/مطالبات أعلى من الطبيعي (مؤشر جودة مورد/موديل).
 */
import type { SerialUnit } from './serials.ts'
import { warrantyEndDate } from './serials.ts'
import type { MaintenanceTicket } from '../data/repo.ts'

export interface WarrantyAttachRateRow {
  itemId: number
  soldCount: number
  extendedCount: number
  attachRatePercent: number // extendedCount / soldCount × 100 — مقربة لمنزلة واحدة
}

export interface WarrantyAttachRateSummary {
  rows: WarrantyAttachRateRow[]
  totalSold: number
  totalExtended: number
  overallAttachRatePercent: number
}

/**
 * يحسب معدل إقران الضمان الممتد بين تاريخين (شاملين)، عاماً ولكل صنف.
 * from/to بصيغة YYYY-MM-DD؛ يُقاس بتاريخ البيع (soldAt) لا تاريخ الاستلام.
 */
export function warrantyAttachRate(
  serials: readonly SerialUnit[],
  from: string,
  to: string,
): WarrantyAttachRateSummary {
  const byItem = new Map<number, { sold: number; extended: number }>()
  let totalSold = 0
  let totalExtended = 0
  for (const u of serials) {
    if (u.status !== 'sold' || !u.soldAt) continue
    const day = u.soldAt.slice(0, 10)
    if (day < from || day > to) continue
    const bucket = byItem.get(u.itemId) ?? { sold: 0, extended: 0 }
    bucket.sold += 1
    totalSold += 1
    if (u.extendedWarrantyMonths && u.extendedWarrantyMonths > 0) {
      bucket.extended += 1
      totalExtended += 1
    }
    byItem.set(u.itemId, bucket)
  }
  const rows: WarrantyAttachRateRow[] = [...byItem.entries()]
    .map(([itemId, { sold, extended }]) => ({
      itemId,
      soldCount: sold,
      extendedCount: extended,
      attachRatePercent: sold > 0 ? Math.round((extended / sold) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.soldCount - a.soldCount)
  return {
    rows,
    totalSold,
    totalExtended,
    overallAttachRatePercent: totalSold > 0 ? Math.round((totalExtended / totalSold) * 1000) / 10 : 0,
  }
}

export interface WarrantyClaimRow {
  itemId: number
  soldUnderWarranty: number // قطع بيعت وما زالت ضمن مدة الضمان أو انتهت لاحقاً (مقام المقارنة)
  claimsCount: number // عدد تذاكر الصيانة التي رُبطت بسيريال من هذا الصنف أثناء ضمانه
  claimRatePercent: number // claimsCount / soldUnderWarranty × 100
}

/**
 * يربط تذاكر الصيانة بسيريالاتها المباعة، ويحسب معدل تكرار المطالبات لكل
 * صنف: من كل القطع المباعة لهذا الصنف، كم قطعة منها فُتحت لها تذكرة صيانة
 * واحدة (أو أكثر) أثناء سريان ضمانها. مؤشر جودة — لا يُحسب ضد قطع بلا ضمان.
 */
export function warrantyClaimRateByItem(
  serials: readonly SerialUnit[],
  tickets: readonly MaintenanceTicket[],
): WarrantyClaimRow[] {
  const bySerial = new Map(serials.map((u) => [u.serial.trim().toUpperCase(), u]))
  const claimedSerials = new Set<string>() // سيريال واحد لا يُحتسب أكثر من مرة حتى لو تكررت تذاكره
  for (const t of tickets) {
    const raw = t.deviceSerial?.trim().toUpperCase()
    if (!raw) continue
    const unit = bySerial.get(raw)
    if (!unit || unit.status !== 'sold' || !unit.soldAt) continue
    const totalMonths = unit.warrantyMonths + (unit.extendedWarrantyMonths ?? 0)
    const until = warrantyEndDate(unit.soldAt, totalMonths)
    if (t.date.slice(0, 10) <= until) claimedSerials.add(raw)
  }
  const byItem = new Map<number, { sold: number; claims: number }>()
  for (const u of serials) {
    if (u.status !== 'sold' || !u.soldAt) continue
    const bucket = byItem.get(u.itemId) ?? { sold: 0, claims: 0 }
    bucket.sold += 1
    if (claimedSerials.has(u.serial.trim().toUpperCase())) bucket.claims += 1
    byItem.set(u.itemId, bucket)
  }
  return [...byItem.entries()]
    .map(([itemId, { sold, claims }]) => ({
      itemId,
      soldUnderWarranty: sold,
      claimsCount: claims,
      claimRatePercent: sold > 0 ? Math.round((claims / sold) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.claimRatePercent - a.claimRatePercent)
}
