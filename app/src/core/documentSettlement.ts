export interface DocumentSettlement { id: string; documentId: string; amountMinor: number; settledAt: string; method: 'cash' | 'bank' | 'cheque' | 'credit' | 'offset'; reference?: string; voided: boolean }
export function validateSettlements(documentId: string, grandTotalMinor: number, settlements: DocumentSettlement[]): string[] {
  const errors: string[] = []; const ids = new Set<string>(); let paid = 0
  if (!Number.isSafeInteger(grandTotalMinor) || grandTotalMinor < 0) errors.push('إجمالي التسوية غير صالح')
  for (const settlement of settlements) {
    if (!settlement.id.trim() || ids.has(settlement.id)) errors.push('معرف تسوية فارغ أو مكرر')
    ids.add(settlement.id)
    if (settlement.documentId !== documentId) errors.push('التسوية تخص مستنداً آخر')
    if (!Number.isSafeInteger(settlement.amountMinor) || settlement.amountMinor <= 0) errors.push('قيمة التسوية غير صالحة')
    if (!Number.isFinite(Date.parse(settlement.settledAt))) errors.push('تاريخ التسوية غير صالح')
    if (!settlement.voided && Number.isSafeInteger(settlement.amountMinor)) paid += settlement.amountMinor
  }
  if (paid > grandTotalMinor) errors.push('التسويات تتجاوز إجمالي المستند')
  return errors
}
export function settlementSummary(grandTotalMinor: number, settlements: DocumentSettlement[]): { paidMinor: number; dueMinor: number; status: 'unpaid' | 'partial' | 'paid' } {
  const paidMinor = settlements.filter((row) => !row.voided).reduce((sum, row) => sum + row.amountMinor, 0)
  if (paidMinor > grandTotalMinor) throw new Error('التسويات تتجاوز إجمالي المستند')
  return { paidMinor, dueMinor: grandTotalMinor - paidMinor, status: paidMinor === 0 ? 'unpaid' : paidMinor === grandTotalMinor ? 'paid' : 'partial' }
}
