/** حصر كميات مستخلصات المشاريع. الكميات حتى أجزاء الألف والقيم بوحدة العملة الصغرى. */
import type { BoqItem, ExtractLineComputed } from './contracting.ts'
import { normalizeMovementQty } from './pos.ts'

export interface QuantityExtractInput { boqItemId: number; cumulativeQty: number; expectedPreviousQty?: number; expectedPreviouslyBilledMinor?: number; expectedContractQty?: number; expectedUnitPriceMinor?: number; expectedUnit?: string }
export interface QuantityHistoryLine {
  boqItemId: number
  prevProgressPercent: number
  newProgressPercent: number
  lineValueMinor: number
  prevExecutedQty?: number
  newExecutedQty?: number
  previousQtyEstimated?: boolean
}
export interface QuantityHistoryExtract { id: number; lines?: QuantityHistoryLine[]; refundedMinor?: number }
export interface QuantityBasis { previousQty: number; previousPercent: number; previouslyBilledMinor: number; estimated: boolean }

type QuantityBoq = Pick<BoqItem, 'id' | 'code' | 'descriptionAr' | 'qty' | 'unitPriceMinor' | 'unit'>

/** لا تُقدَّم كمية النسبة التاريخية كحصر مؤكد. */
export function quantityExtractBasis(item: QuantityBoq, extracts: readonly QuantityHistoryExtract[]): QuantityBasis {
  normalizeMovementQty(item.qty)
  let previousPercent = 0, previousQty = 0, previouslyBilledMinor = 0, estimated = false
  for (const extract of [...extracts].sort((a, b) => a.id - b.id)) {
    if (!extract.lines?.length) throw new Error('يوجد مستخلص إجمالي سابق بلا توزيع بنود — راجع الحصر قبل استخدام الكميات')
    if ((extract.refundedMinor ?? 0) > 0) throw new Error('يوجد مرتجع مستخلص سابق — راجع الحصر قبل استخدام الكميات')
    const found = extract.lines.filter(line => line.boqItemId === item.id)
    if (found.length > 1) throw new Error('بند مكرر في المستخلص السابق — راجع الحصر')
    if (!found.length) continue
    const line = found[0]
    if (!Number.isFinite(line.prevProgressPercent) || !Number.isFinite(line.newProgressPercent) || line.prevProgressPercent < 0 || line.newProgressPercent < line.prevProgressPercent || line.newProgressPercent > 100 || Math.abs(line.prevProgressPercent - previousPercent) > 1e-7 || !Number.isSafeInteger(line.lineValueMinor) || line.lineValueMinor < 0) throw new Error('تسلسل المستخلصات السابقة غير متطابق — راجع الحصر')
    previouslyBilledMinor += line.lineValueMinor
    if (!Number.isSafeInteger(previouslyBilledMinor)) throw new Error('قيمة المستخلصات السابقة غير صالحة')
    previousPercent = line.newProgressPercent
    if ((line.newExecutedQty == null) !== (line.prevExecutedQty == null)) throw new Error('دليل كميات سابق غير مكتمل — راجع الحصر')
    if (line.newExecutedQty == null) {
      previousQty = Math.round(item.qty * previousPercent * 10) / 1000
      estimated = previousPercent > 0
    } else {
      const storedPrevious = normalizeMovementQty(line.prevExecutedQty!, true)
      const nextQty = normalizeMovementQty(line.newExecutedQty, true)
      if (Math.round(storedPrevious * 1000) !== Math.round(previousQty * 1000) || nextQty < storedPrevious) throw new Error('تسلسل كميات المستخلصات السابقة غير متطابق — راجع الحصر')
      previousQty = nextQty
      if (previousQty > item.qty || Math.abs(previousQty / item.qty * 100 - previousPercent) > 1e-7) throw new Error('دليل كمية المستخلص السابق لا يطابق نسبته — راجع الحصر')
      estimated = !!line.previousQtyEstimated || estimated
    }
  }
  return { previousQty, previousPercent, previouslyBilledMinor, estimated }
}

/** تحسب القيمة من الرصيد التراكمي ناقص ما قُيّد سابقاً لتجنب فروق التقريب المتكررة. */
export function computeQuantityExtractLines(lines: readonly QuantityExtractInput[], items: readonly QuantityBoq[], history: readonly QuantityHistoryExtract[], acceptEstimatedPrior = false): { computed: ExtractLineComputed[]; grossMinor: number } {
  if (!lines.length) throw new Error('أدخل كمية لبند واحد على الأقل')
  if (new Set(lines.map(line => line.boqItemId)).size !== lines.length) throw new Error('لا تكرر بند الحصر في المستخلص')
  const computed = lines.map(line => {
    const matches = items.filter(item => item.id === line.boqItemId)
    if (matches.length !== 1) throw new Error('بند الحصر غير موجود أو غير فريد في المشروع')
    const item = matches[0], basis = quantityExtractBasis(item, history)
    if ((line.expectedPreviousQty != null && line.expectedPreviousQty !== basis.previousQty) || (line.expectedPreviouslyBilledMinor != null && line.expectedPreviouslyBilledMinor !== basis.previouslyBilledMinor) || (line.expectedContractQty != null && line.expectedContractQty !== item.qty) || (line.expectedUnitPriceMinor != null && line.expectedUnitPriceMinor !== item.unitPriceMinor) || (line.expectedUnit != null && line.expectedUnit !== item.unit)) throw new Error('تغير حصر البند أو العقد منذ المعاينة — أعد فتح المستخلص وراجع القيم')
    if (basis.estimated && !acceptEstimatedPrior) throw new Error(`الكمية السابقة للبند ${item.code} تقديرية من نسبة قديمة — راجعها وأكدها قبل المتابعة`)
    const cumulativeQty = normalizeMovementQty(line.cumulativeQty, true)
    const currentMilli = Math.round(cumulativeQty * 1000), previousMilli = Math.round(basis.previousQty * 1000), contractMilli = Math.round(item.qty * 1000)
    if (currentMilli < previousMilli) throw new Error(`الكمية التراكمية للبند ${item.code} أقل من السابق — استخدم مسار تصحيح`)
    if (currentMilli > contractMilli) throw new Error(`الكمية التراكمية للبند ${item.code} تتجاوز كمية العقد — راجع أمر التغيير`)
    if (!Number.isSafeInteger(item.unitPriceMinor) || item.unitPriceMinor < 0) throw new Error('سعر وحدة البند غير صالح')
    const cumulativeMinorBig = (BigInt(currentMilli) * BigInt(item.unitPriceMinor) + 500n) / 1000n
    if (cumulativeMinorBig > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('قيمة البند غير آمنة')
    const cumulativeMinor = Number(cumulativeMinorBig)
    const slice = currentMilli === previousMilli ? 0 : cumulativeMinor - basis.previouslyBilledMinor
    if (slice < 0) throw new Error('القيمة السابقة أعلى من قيمة الحصر التراكمي — راجع التاريخ')
    return {
      boqItemId: item.id, code: item.code, descriptionAr: item.descriptionAr,
      boqTotalMinor: Math.round(item.qty * item.unitPriceMinor), prevProgressPercent: basis.previousPercent,
      newProgressPercent: cumulativeQty / item.qty * 100, lineValueMinor: slice,
      prevExecutedQty: basis.previousQty, newExecutedQty: cumulativeQty, previousQtyEstimated: basis.estimated,
    }
  }).filter(line => Math.round(line.newExecutedQty * 1000) > Math.round(line.prevExecutedQty * 1000))
  const grossMinor = computed.reduce((sum, line) => sum + line.lineValueMinor, 0)
  if (!Number.isSafeInteger(grossMinor) || grossMinor <= 0) throw new Error('قيمة المستخلص صفر أو غير صالحة — راجع الكميات')
  return { computed, grossMinor }
}
