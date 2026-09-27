export interface DocumentTotals { subtotalMinor: number; discountMinor: number; chargeMinor: number; taxMinor: number; grandTotalMinor: number; paidMinor: number; dueMinor: number }
const valid = (value: number) => Number.isSafeInteger(value) && value >= 0
export function calculateDocumentTotals(input: Omit<DocumentTotals, 'grandTotalMinor' | 'dueMinor'>): DocumentTotals {
  for (const [name, value] of Object.entries(input)) if (!valid(value)) throw new Error(`قيمة ${name} غير صالحة`)
  if (input.discountMinor > input.subtotalMinor + input.chargeMinor + input.taxMinor) throw new Error('الخصم يتجاوز قيمة المستند')
  const grandTotalMinor = input.subtotalMinor - input.discountMinor + input.chargeMinor + input.taxMinor
  if (input.paidMinor > grandTotalMinor) throw new Error('المدفوع يتجاوز إجمالي المستند')
  return { ...input, grandTotalMinor, dueMinor: grandTotalMinor - input.paidMinor }
}
export function assertDocumentTotals(stored: DocumentTotals): void {
  const calculated = calculateDocumentTotals(stored)
  if (calculated.grandTotalMinor !== stored.grandTotalMinor || calculated.dueMinor !== stored.dueMinor) throw new Error('إجماليات المستند غير متوازنة')
}
