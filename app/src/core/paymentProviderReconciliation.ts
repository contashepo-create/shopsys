import type { PaymentTerminalTransaction } from './paymentTerminalTransactions.ts'
export interface ProviderStatementRow { providerReference: string; amountMinor: number; occurredAt?: string }
export interface ProviderMatch { providerReference: string; status: 'matched' | 'missing_local' | 'missing_statement' | 'amount_mismatch' | 'duplicate_statement'; statementAmountMinor?: number; localAmountMinor?: number }
function parseCsvLine(line: string): string[] {
  const cells: string[] = []; let cell = ''; let quoted = false
  for (let index = 0; index < line.length; index++) { const char = line[index]; if (char === '"') { if (quoted && line[index + 1] === '"') { cell += '"'; index++ } else quoted = !quoted } else if (char === ',' && !quoted) { cells.push(cell.trim()); cell = '' } else cell += char }
  if (quoted) throw new Error('علامة اقتباس غير مغلقة في كشف المزود')
  cells.push(cell.trim()); return cells
}
export function parseProviderStatementCsv(csv: string): ProviderStatementRow[] {
  const lines = csv.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim())
  if (!lines.length) return []
  const headers = parseCsvLine(lines[0])
  const refIndex = headers.indexOf('providerReference'); const amountIndex = headers.indexOf('amountMinor'); const dateIndex = headers.indexOf('occurredAt')
  if (refIndex < 0 || amountIndex < 0) throw new Error('كشف المزود يجب أن يحتوي providerReference وamountMinor')
  return lines.slice(1).map((line, index) => {
    const cells = parseCsvLine(line)
    const amountMinor = Number(cells[amountIndex]); const providerReference = cells[refIndex] ?? ''
    if (!providerReference || !Number.isSafeInteger(amountMinor)) throw new Error(`صف كشف المزود ${index + 2} غير صالح`)
    return { providerReference, amountMinor, ...(dateIndex >= 0 && cells[dateIndex] ? { occurredAt: cells[dateIndex] } : {}) }
  })
}

export interface ReconciliationSummary { matchedCount: number; exceptionCount: number; statementNetMinor: number; localNetMinor: number; differenceMinor: number; canClose: boolean }
export function summarizeReconciliation(matches: readonly ProviderMatch[]): ReconciliationSummary {
  const matchedCount = matches.filter((row) => row.status === 'matched').length
  const exceptionCount = matches.length - matchedCount
  const statementNetMinor = matches.reduce((sum, row) => sum + (row.status === 'duplicate_statement' ? 0 : row.statementAmountMinor ?? 0), 0)
  const localNetMinor = matches.reduce((sum, row) => sum + (row.localAmountMinor ?? 0), 0)
  return { matchedCount, exceptionCount, statementNetMinor, localNetMinor, differenceMinor: statementNetMinor - localNetMinor, canClose: exceptionCount === 0 && statementNetMinor === localNetMinor }
}

export function reconcileProviderStatement(terminalId: string, rows: ProviderStatementRow[], transactions: PaymentTerminalTransaction[]): ProviderMatch[] {
  const local = transactions.filter((row) => row.terminalId === terminalId)
  const seen = new Set<string>()
  const matches: ProviderMatch[] = rows.map((row) => {
    if (!row.providerReference.trim() || !Number.isSafeInteger(row.amountMinor)) throw new Error('صف كشف مزود الدفع غير صالح')
    if (seen.has(row.providerReference)) return { providerReference: row.providerReference, status: 'duplicate_statement', statementAmountMinor: row.amountMinor }
    seen.add(row.providerReference)
    const transaction = local.find((item) => item.providerReference === row.providerReference)
    if (!transaction) return { providerReference: row.providerReference, status: 'missing_local', statementAmountMinor: row.amountMinor }
    const signedLocal = transaction.kind === 'charge' ? transaction.amountMinor : -transaction.amountMinor
    return { providerReference: row.providerReference, status: signedLocal === row.amountMinor ? 'matched' : 'amount_mismatch', statementAmountMinor: row.amountMinor, localAmountMinor: signedLocal }
  })
  for (const transaction of local) if (!seen.has(transaction.providerReference)) matches.push({ providerReference: transaction.providerReference, status: 'missing_statement', localAmountMinor: transaction.kind === 'charge' ? transaction.amountMinor : -transaction.amountMinor })
  return matches
}
