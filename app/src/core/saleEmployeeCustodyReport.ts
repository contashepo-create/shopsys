/** عهدة الموظف المسجلة على فاتورة البيع، لا تثبت هوية من قبض النقد من العميل. */
import type { EmployeeAdvance, SaleInvoice } from '../data/repo.ts'
import { assertBalanced, buildReversalLines, type JournalEntry, type JournalLine } from './ledger.ts'
import { inPeriod, type Period } from './reports.ts'
export interface SaleEmployeeCustodyRow { date: string; sequence: number; document: string; kind: 'allocation' | 'reversal'; employeeId: number; employeeName: string; amountMinor: number }
export interface SaleEmployeeCustodyResult { rows: SaleEmployeeCustodyRow[]; warnings: string[] }
const lineKey = (line: JournalLine) => JSON.stringify([line.accountCode, line.debit, line.credit, line.costCenterId ?? null, line.partyKind ?? null, line.partyId ?? null, line.relatedBranchId ?? null])
const sameLines = (left: JournalLine[], right: JournalLine[]) => left.length === right.length && JSON.stringify(left.map(lineKey).sort()) === JSON.stringify(right.map(lineKey).sort())

/** أصل العهدة وعكس التعديل بتاريخ كل قيد، لا رصيدها بعد السداد أو استقطاع الرواتب. */
export function saleEmployeeCustodyReport(sales: readonly SaleInvoice[], advances: readonly EmployeeAdvance[], journal: readonly JournalEntry[], employees: readonly { id: number; nameAr: string }[], period: Period): SaleEmployeeCustodyResult {
  const rows: SaleEmployeeCustodyRow[] = [], warnings: string[] = []
  for (const sale of sales) {
    const fail = () => { warnings.push(`تعذر إثبات عهدة الموظف للفاتورة ${sale.invoiceNumber}؛ لم تُدرج.`) }
    if ((sale.editHistory != null && !Array.isArray(sale.editHistory)) || (sale.paymentAllocations != null && !Array.isArray(sale.paymentAllocations))) { fail(); continue }
    const history = sale.editHistory ?? []
    if (typeof sale.date !== 'string' || history.some(edit => !edit || typeof edit.at !== 'string' || !Number.isSafeInteger(edit.previousEntryId) || !Number.isSafeInteger(edit.reversalEntryId))) { fail(); continue }
    if (!inPeriod(sale.date, period) && !history.some(edit => inPeriod(edit.at, period))) continue
    const ids = [...history.map(edit => edit.previousEntryId), sale.journalEntryId]
    const entryMatches = ids.map(id => journal.filter(entry => entry.id === id)), entries = entryMatches.map(matches => matches[0])
    const records = advances.filter(advance => ids.includes(advance.journalEntryId))
    const allocations = sale.paymentAllocations ?? []
    const staff = allocations.filter(row => row.accountCode === '1107' || row.employeeId != null)
    const apparent = entries.some(entry => entry?.lines?.some(line => line.accountCode === '1107' && line.debit > 0))
    if (!staff.length && !records.length && (!apparent || sale.partyKind != null)) continue
    if (sales.filter(row => row.id === sale.id).length !== 1 || sale.projectBilling === 'documentation' || sale.partyKind != null || new Set(ids).size !== ids.length || entryMatches.some(matches => matches.length !== 1)) { fail(); continue }
    let valid = true
    const reverseEntries: JournalEntry[] = []
    try {
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]
        if (entry.sourceType !== 'sale' || entry.sourceId !== sale.id || entry.memoOnly || entry.reversesEntryId != null || !Array.isArray(entry.lines) || (i === 0 && entry.date !== sale.date.slice(0, 10))) throw new Error('sale')
        assertBalanced(entry.lines)
        if (i === history.length) { if (entry.reversedByEntryId != null) throw new Error('current'); continue }
        const edit = history[i], matches = journal.filter(row => row.id === edit.reversalEntryId), reverse = matches[0]
        if (matches.length !== 1 || entry.reversedByEntryId !== reverse.id || reverse.sourceType !== 'reversal' || reverse.sourceId !== entry.id || reverse.reversesEntryId !== entry.id || reverse.reversedByEntryId != null || reverse.memoOnly || reverse.date !== edit.at.slice(0, 10) || reverse.date < entry.date || entries[i + 1].date !== reverse.date) throw new Error('reversal')
        assertBalanced(reverse.lines)
        if (!sameLines(reverse.lines, buildReversalLines(entry.lines))) throw new Error('lines')
        reverseEntries.push(reverse)
      }
    } catch { fail(); continue }
    const paid = allocations.reduce((sum, row) => sum + row.amountMinor, 0)
    if (!Number.isSafeInteger(paid) || paid !== sale.paidMinor || !Number.isSafeInteger(sale.totals?.totalMinor) || paid > sale.totals.totalMinor || allocations.some(row => !Number.isSafeInteger(row.amountMinor) || row.amountMinor <= 0) || staff.some(row => row.accountCode !== '1107' || !Number.isSafeInteger(row.employeeId) || employees.filter(employee => employee.id === row.employeeId).length !== 1) || new Set(staff.map(row => row.employeeId)).size !== staff.length) valid = false
    const stages: { employeeId: number; employeeName: string; amountMinor: number }[][] = entries.map(() => [])
    for (const advance of records) {
      const person = employees.filter(employee => employee.id === advance.employeeId)
      if (advances.filter(row => row.id === advance.id).length !== 1 || advance.source !== 'sale_collection' || advance.custodyFileId != null || person.length !== 1 || !Number.isSafeInteger(advance.amountMinor) || !Number.isSafeInteger(advance.recoveredMinor) || advance.recoveredMinor < 0 || advance.recoveredMinor > advance.amountMinor || typeof advance.date !== 'string' || (advance.saleCollectionEditHistory != null && !Array.isArray(advance.saleCollectionEditHistory))) { valid = false; continue }
      const chain = advance.saleCollectionEditHistory ?? []
      const values = new Array<number>(entries.length).fill(0)
      if (!history.length) {
        if (chain.length || advance.saleCollectionRetired || advance.journalEntryId !== ids[0] || advance.date.slice(0, 10) !== sale.date.slice(0, 10) || advance.amountMinor <= 0) { valid = false; continue }
        values[0] = advance.amountMinor
      } else {
        if (!chain.length) { valid = false; continue }
        let previousIndex = -2, previousNext: number | undefined
        for (const item of chain) {
          if (!item) { valid = false; break }
          const index = history.findIndex(edit => edit.previousEntryId === item.previousEntryId)
          if (index < 0 || (previousIndex !== -2 && index !== previousIndex + 1) || item.reversalEntryId !== history[index].reversalEntryId || item.at !== history[index].at || !Number.isSafeInteger(item.previousAmountMinor) || !Number.isSafeInteger(item.nextAmountMinor) || item.previousAmountMinor! < 0 || item.nextAmountMinor! < 0 || (item.previousAmountMinor === 0 && item.nextAmountMinor === 0) || (previousNext != null && previousNext !== item.previousAmountMinor)) { valid = false; break }
          if (previousIndex === -2 && ((index > 0 && item.previousAmountMinor !== 0) || (index === 0 && item.previousAmountMinor === 0 && advance.date.slice(0, 10) !== entries[1].date))) { valid = false; break }
          values[index] = item.previousAmountMinor!
          values[index + 1] = item.nextAmountMinor!
          previousIndex = index
          previousNext = item.nextAmountMinor
        }
        if (previousIndex < 0) { valid = false; continue }
        const first = chain[0], firstIndex = history.findIndex(edit => edit.previousEntryId === first.previousEntryId)
        const creationDate = first.previousAmountMinor === 0 ? entries[firstIndex + 1].date : entries[0].date
        if (advance.date.slice(0, 10) !== creationDate) valid = false
        if (advance.saleCollectionRetired) {
          const retired = advance.saleCollectionRetired, last = chain[chain.length - 1]
          if (advance.amountMinor !== 0 || advance.recoveredMinor !== 0 || previousNext !== 0 || advance.journalEntryId !== ids[previousIndex] || retired.previousAmountMinor !== last.previousAmountMinor || retired.reversalEntryId !== history[previousIndex].reversalEntryId || retired.replacementEntryId !== ids[previousIndex + 1] || retired.at !== history[previousIndex].at) valid = false
        } else if (previousIndex !== history.length - 1 || advance.journalEntryId !== sale.journalEntryId || previousNext !== advance.amountMinor || advance.amountMinor <= 0) valid = false
      }
      for (let i = 0; i < values.length; i++) if (values[i] > 0) stages[i].push({ employeeId: advance.employeeId, employeeName: person[0].nameAr, amountMinor: values[i] })
    }
    const key = (employeeId: number | undefined, amount: number) => `${employeeId}:${amount}`
    if (JSON.stringify(stages.at(-1)!.map(row => key(row.employeeId, row.amountMinor)).sort()) !== JSON.stringify(staff.map(row => key(row.employeeId, row.amountMinor)).sort())) valid = false
    for (let i = 0; i < entries.length; i++) {
      const stage = stages[i], lines = entries[i].lines.filter(line => line.accountCode === '1107')
      const stamp = entries[i].saleCollectionAllocations
      if (stamp !== undefined && (!Array.isArray(stamp) || stamp.some(row => !row || !Number.isSafeInteger(row.employeeId) || !Number.isSafeInteger(row.amountMinor) || row.amountMinor <= 0) || JSON.stringify(stamp.map(row => key(row.employeeId, row.amountMinor)).sort()) !== JSON.stringify(stage.map(row => key(row.employeeId, row.amountMinor)).sort()))) valid = false
      if (new Set(stage.map(row => row.employeeId)).size !== stage.length || lines.some(line => line.credit !== 0) || JSON.stringify(lines.map(line => line.debit).sort((a, b) => a - b)) !== JSON.stringify(stage.map(row => row.amountMinor).sort((a, b) => a - b))) valid = false
    }
    if (!valid) { fail(); continue }
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i], reverse = reverseEntries[i]
      for (const record of stages[i]) {
        if (inPeriod(entry.date, period)) rows.push({ ...record, date: entry.date, sequence: entry.id, document: sale.invoiceNumber, kind: 'allocation' })
        if (reverse && inPeriod(reverse.date, period)) rows.push({ ...record, date: reverse.date, sequence: reverse.id, document: sale.invoiceNumber, kind: 'reversal' })
      }
    }
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.sequence - b.sequence || a.employeeId - b.employeeId)
  return { rows, warnings }
}
