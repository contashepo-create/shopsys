import type { PaymentTerminalTransaction } from './paymentTerminalTransactions.ts'
export interface TerminalReportRow { terminalId: string; branchId: string; userId: number; chargeMinor: number; refundMinor: number; voidMinor: number; netMinor: number; transactionCount: number }
export function summarizeTerminalTransactions(transactions: PaymentTerminalTransaction[], from?: string, to?: string): TerminalReportRow[] {
  const rows = new Map<string, TerminalReportRow>()
  for (const transaction of transactions) {
    if (from && transaction.occurredAt < from) continue
    if (to && transaction.occurredAt > to) continue
    const key = `${transaction.terminalId}:${transaction.branchId}:${transaction.userId}`
    const row = rows.get(key) ?? { terminalId: transaction.terminalId, branchId: transaction.branchId, userId: transaction.userId, chargeMinor: 0, refundMinor: 0, voidMinor: 0, netMinor: 0, transactionCount: 0 }
    row.transactionCount++
    if (transaction.kind === 'charge') row.chargeMinor += transaction.amountMinor
    else if (transaction.kind === 'refund') row.refundMinor += transaction.amountMinor
    else row.voidMinor += transaction.amountMinor
    row.netMinor = row.chargeMinor - row.refundMinor - row.voidMinor
    rows.set(key, row)
  }
  return [...rows.values()].sort((a, b) => a.terminalId.localeCompare(b.terminalId) || a.userId - b.userId)
}
