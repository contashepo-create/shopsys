import type { BoqItem } from '../../core/contracting.ts'
import { normalizeMovementQty } from '../../core/pos.ts'
import { computeQuantityExtractLines, quantityExtractBasis, type QuantityExtractInput, type QuantityHistoryExtract } from '../../core/projectExtractQuantity.ts'

export type QuantityEntryMode = 'current' | 'cumulative'
export type QuantityDraft = Record<number, string>

/** تحويل إدخال المستخدم إلى كميات تراكمية؛ لا يُقص تجاوز أو يختفي إدخال خاطئ. */
export function quantityInputs(items: readonly BoqItem[], history: readonly QuantityHistoryExtract[], values: QuantityDraft, mode: QuantityEntryMode): QuantityExtractInput[] {
  const inputs: QuantityExtractInput[] = []
  for (const item of items) {
    const raw = values[item.id]?.trim()
    if (!raw) continue
    const entered = normalizeMovementQty(Number(raw), true)
    const basis = quantityExtractBasis(item, history)
    const milli = Math.round(entered * 1000) + (mode === 'current' ? Math.round(basis.previousQty * 1000) : 0)
    if (!Number.isSafeInteger(milli)) throw new Error('كمية الحصر غير صالحة')
    inputs.push({ boqItemId: item.id, cumulativeQty: milli / 1000, expectedPreviousQty: basis.previousQty, expectedPreviouslyBilledMinor: basis.previouslyBilledMinor, expectedContractQty: item.qty, expectedUnitPriceMinor: item.unitPriceMinor, expectedUnit: item.unit })
  }
  return inputs
}

export function quantityDraftPreview(items: readonly BoqItem[], history: readonly QuantityHistoryExtract[], values: QuantityDraft, mode: QuantityEntryMode, acceptEstimatedPrior: boolean) {
  try {
    const inputs = quantityInputs(items, history, values, mode)
    if (!inputs.length) return { inputs, computed: [], grossMinor: 0, error: '' }
    return { inputs, ...computeQuantityExtractLines(inputs, items, history, acceptEstimatedPrior), error: '' }
  } catch (error) {
    return { inputs: [], computed: [], grossMinor: 0, error: error instanceof Error ? error.message : 'تعذر حساب حصر الكميات' }
  }
}
