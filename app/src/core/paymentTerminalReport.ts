import type { PaymentTerminalTransaction } from './paymentTerminalTransactions.ts'
import type { PaymentTerminalSettlement } from './paymentTerminalSettlement.ts'
export interface TerminalReportRow { terminalId: string; branchId: string; userId: number; chargeMinor: number; refundMinor: number; voidMinor: number; netMinor: number; transactionCount: number }
export interface TerminalActivityRow { documentType: string; chargeMinor: number; refundMinor: number; voidMinor: number; netMinor: number; transactionCount: number }
export interface TerminalReconciliationRow { terminalId: string; unsettledCount: number; unsettledNetMinor: number; settledCount: number }
export function summarizeTerminalReconciliation(transactions: PaymentTerminalTransaction[], settlements: PaymentTerminalSettlement[]): TerminalReconciliationRow[] {
  const settled = new Set(settlements.flatMap((row) => row.transactionIds)); const rows = new Map<string, TerminalReconciliationRow>()
  for (const transaction of transactions) {
    const row = rows.get(transaction.terminalId) ?? { terminalId: transaction.terminalId, unsettledCount: 0, unsettledNetMinor: 0, settledCount: 0 }
    if (settled.has(transaction.id)) row.settledCount++
    else { row.unsettledCount++; row.unsettledNetMinor += transaction.kind === 'charge' ? transaction.amountMinor : -transaction.amountMinor }
    rows.set(transaction.terminalId, row)
  }
  return [...rows.values()].sort((a, b) => a.terminalId.localeCompare(b.terminalId))
}
export function summarizeTerminalActivities(transactions: PaymentTerminalTransaction[]): TerminalActivityRow[] {
  const rows = new Map<string, TerminalActivityRow>()
  for (const transaction of transactions) {
    const documentType = transaction.documentType ?? 'sale'
    const row = rows.get(documentType) ?? { documentType, chargeMinor: 0, refundMinor: 0, voidMinor: 0, netMinor: 0, transactionCount: 0 }
    row.transactionCount++
    if (transaction.kind === 'charge') row.chargeMinor += transaction.amountMinor
    else if (transaction.kind === 'refund') row.refundMinor += transaction.amountMinor
    else row.voidMinor += transaction.amountMinor
    row.netMinor = row.chargeMinor - row.refundMinor - row.voidMinor
    rows.set(documentType, row)
  }
  return [...rows.values()].sort((a, b) => a.documentType.localeCompare(b.documentType))
}
const csvCell = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`
export function terminalReportCsv(rows: TerminalReportRow[]): string {
  const header = ['معرف الماكينة', 'معرف الفرع', 'معرف المستخدم', 'التحصيل minor', 'الرد minor', 'الإلغاء minor', 'الصافي minor', 'عدد العمليات']
  const body = rows.map((row) => [row.terminalId, row.branchId, row.userId, row.chargeMinor, row.refundMinor, row.voidMinor, row.netMinor, row.transactionCount].map(csvCell).join(','))
  return `\uFEFF${[header.map(csvCell).join(','), ...body].join('\r\n')}`
}

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
