export interface TerminalSettlementInput { grossMinor: number; feeMinor: number; feeTaxMinor: number; depositedMinor: number }
export interface PaymentTerminalSettlement extends TerminalSettlementInput { id: string; terminalId: string; bankAccountCode: string; transactionIds: string[]; settledAt: string; userId: number; differenceMinor: number; journalEntryId: number }
export interface TerminalSettlementBreakdown extends TerminalSettlementInput { differenceMinor: number; balanced: boolean }
export function calculateTerminalSettlement(input: TerminalSettlementInput): TerminalSettlementBreakdown {
  // تحقق الحقول المالية الأربعة صراحةً، لا كل ما يحمله الكائن: تمرير سجل التسوية
  // كاملاً (بمعرّفه وتاريخه) كان يرمي «قيمة id غير صالحة» فيُعطّل التسوية كلها.
  for (const name of ['grossMinor', 'feeMinor', 'feeTaxMinor', 'depositedMinor'] as const) {
    const value = input[name]
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`قيمة ${name} في التسوية غير صالحة`)
  }
  const expectedDeposit = input.grossMinor - input.feeMinor - input.feeTaxMinor
  if (expectedDeposit < 0) throw new Error('رسوم التسوية تتجاوز إجمالي التحصيل')
  const differenceMinor = input.depositedMinor - expectedDeposit
  return { ...input, differenceMinor, balanced: differenceMinor === 0 }
}
export function netSettlementTransactions(transactions: { kind: 'charge' | 'refund' | 'void'; amountMinor: number }[]): number {
  return transactions.reduce((sum, row) => sum + (row.kind === 'charge' ? row.amountMinor : -row.amountMinor), 0)
}
export function validateSettlementTransactions(transactionIds: string[]): string[] {
  const errors: string[] = []
  if (!transactionIds.length) errors.push('تسوية الماكينة بلا عمليات')
  if (new Set(transactionIds).size !== transactionIds.length) errors.push('عملية دفع مكررة داخل التسوية')
  if (transactionIds.some((id) => !id.trim())) errors.push('معرف عملية تسوية فارغ')
  return errors
}
