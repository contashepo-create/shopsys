import type { PaymentTerminalTransaction } from './paymentTerminalTransactions.ts'
export interface ProviderStatementRow { providerReference: string; amountMinor: number; occurredAt?: string }
export interface ProviderMatch { providerReference: string; status: 'matched' | 'missing_local' | 'amount_mismatch' | 'duplicate_statement'; statementAmountMinor: number; localAmountMinor?: number }
export function reconcileProviderStatement(terminalId: string, rows: ProviderStatementRow[], transactions: PaymentTerminalTransaction[]): ProviderMatch[] {
  const local = transactions.filter((row) => row.terminalId === terminalId)
  const seen = new Set<string>()
  return rows.map((row) => {
    if (!row.providerReference.trim() || !Number.isSafeInteger(row.amountMinor)) throw new Error('صف كشف مزود الدفع غير صالح')
    if (seen.has(row.providerReference)) return { providerReference: row.providerReference, status: 'duplicate_statement', statementAmountMinor: row.amountMinor }
    seen.add(row.providerReference)
    const transaction = local.find((item) => item.providerReference === row.providerReference)
    if (!transaction) return { providerReference: row.providerReference, status: 'missing_local', statementAmountMinor: row.amountMinor }
    const signedLocal = transaction.kind === 'charge' ? transaction.amountMinor : -transaction.amountMinor
    return { providerReference: row.providerReference, status: signedLocal === row.amountMinor ? 'matched' : 'amount_mismatch', statementAmountMinor: row.amountMinor, localAmountMinor: signedLocal }
  })
}
