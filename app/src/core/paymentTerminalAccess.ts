export type TerminalOperation = 'charge' | 'refund' | 'void' | 'settle' | 'view_totals'
export interface PaymentTerminalGrant { terminalId: string; operations: TerminalOperation[]; maxAmountMinor?: number }
export interface PaymentTerminalAccess { defaultTerminalId?: string; grants: PaymentTerminalGrant[] }
export function validateTerminalAccess(access: PaymentTerminalAccess, validTerminalIds: Set<string>): string[] {
  const errors: string[] = []; const ids = new Set<string>()
  for (const grant of access.grants) {
    if (!validTerminalIds.has(grant.terminalId)) errors.push('ماكينة دفع غير موجودة')
    if (ids.has(grant.terminalId)) errors.push('صلاحيات ماكينة دفع مكررة')
    ids.add(grant.terminalId)
    if (!grant.operations.length || new Set(grant.operations).size !== grant.operations.length) errors.push('عمليات ماكينة الدفع فارغة أو مكررة')
    if (grant.maxAmountMinor !== undefined && (!Number.isSafeInteger(grant.maxAmountMinor) || grant.maxAmountMinor < 0)) errors.push('حد ماكينة الدفع غير صالح')
  }
  if (access.defaultTerminalId && !ids.has(access.defaultTerminalId)) errors.push('ماكينة الدفع الافتراضية غير ممنوحة')
  return errors
}
export function assertTerminalOperation(access: PaymentTerminalAccess, terminalId: string, operation: TerminalOperation, amountMinor = 0): void {
  const grant = access.grants.find((row) => row.terminalId === terminalId)
  if (!grant?.operations.includes(operation)) throw new Error('لا تملك صلاحية العملية على ماكينة الدفع')
  if (grant.maxAmountMinor !== undefined && amountMinor > grant.maxAmountMinor) throw new Error('المبلغ يتجاوز حد ماكينة الدفع للمستخدم')
}
