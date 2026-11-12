import type { BoqItem } from './contracting.ts'
import type { ProjectExtract } from '../data/repo.ts'
import type { JournalEntry } from './ledger.ts'
import { FinancialDataReviewError } from './financialDataReview.ts'
import { isValidExpiryDate } from './batches.ts'
import { normalizeMovementQty } from './pos.ts'
import { roundNonNegativeRatio } from './money.ts'
import { quantityExtractBasis } from './projectExtractQuantity.ts'
import { assertProjectExtractOriginalIntegrity, assertProjectExtractRefundIntegrity } from './projectExtractRefundIntegrity.ts'

export interface ProjectNetQuantityRow {
  boqItemId: number
  issuedQty: number
  returnedQty: number
  netQty: number
  issuedMinor: number
  returnedMinor: number
  netMinor: number
}
export interface ProjectNetQuantityEvent {
  journalEntryId: number
  date: string
  extractNumber: string
  kind: 'extract' | 'credit'
  grossMinor: number
}
export interface ProjectNetQuantityReport { rows: ProjectNetQuantityRow[]; events: ProjectNetQuantityEvent[] }

/**
 * عرض للقراءة فقط. ترتيب الأحداث هو ترتيب تسجيل القيود لا ترتيب التواريخ
 * التي قد يكون المستخدم أدخلها بأثر رجعي؛ لا يعيد فتح الختامي أو يعدل الحصر.
 * لا يستنتج كميات من مستخلص إجمالي أو نسب أو إشعارات قديمة بلا دليل.
 */
export function projectNetQuantityHistory(items: readonly BoqItem[], extracts: readonly ProjectExtract[], journal: ReadonlyMap<number, JournalEntry>): ProjectNetQuantityReport {
  const fail = (): never => { throw new FinancialDataReviewError('تاريخ كميات المستخلصات', 'الكميات أو تواريخ المستندات أو قيودها غير مثبتة بالكامل') }
  if (new Set(items.map(item => item.id)).size !== items.length || new Set(extracts.map(extract => extract.id)).size !== extracts.length) return fail()
  const itemById = new Map(items.map(item => [item.id, item]))
  const history = [...extracts].sort((a, b) => a.id - b.id)
  const issuedHistory: ProjectExtract[] = []
  const totals = new Map(items.map(item => [item.id, { boqItemId: item.id, issuedMilli: 0, returnedMilli: 0, issuedMinor: 0, returnedMinor: 0 }]))
  const events: ProjectNetQuantityEvent[] = []
  const eventIds = new Set<number>()
  const addEvent = (journalEntryId: number, date: string, extractNumber: string, kind: 'extract' | 'credit', grossMinor: number) => {
    const entry = journal.get(journalEntryId)
    if (!Number.isSafeInteger(journalEntryId) || journalEntryId <= 0 || eventIds.has(journalEntryId) || !isValidExpiryDate(date) || entry?.date !== date) return fail()
    eventIds.add(journalEntryId)
    events.push({ journalEntryId, date, extractNumber, kind, grossMinor })
  }
  try {
    for (const extract of history) assertProjectExtractOriginalIntegrity(extract, journal)
    assertProjectExtractRefundIntegrity(history, journal)
    for (const extract of history) {
      if (!extract.lines?.length || ((extract.refundedMinor ?? 0) > 0 && extract.quantityCreditVersion == null)) return fail()
      const date = extract.date?.slice(0, 10)
      addEvent(extract.journalEntryId, date, extract.extractNumber, 'extract', extract.totals.grossMinor)
      let sum = 0
      const lines = new Map<number, { issuedMilli: number; returnedMilli: number; value: number; refundedValue: number }>()
      for (const line of extract.lines) {
        const item = itemById.get(line.boqItemId)
        if (!item || lines.has(line.boqItemId) || line.previousQtyEstimated || line.prevExecutedQty == null || line.newExecutedQty == null || line.contractQty !== item.qty || line.unitPriceMinor !== item.unitPriceMinor || line.unit !== item.unit) return fail()
        const basis = quantityExtractBasis(item, issuedHistory)
        if (basis.estimated) return fail()
        const previous = Math.round(normalizeMovementQty(line.prevExecutedQty, true) * 1000)
        const next = Math.round(normalizeMovementQty(line.newExecutedQty, true) * 1000)
        if (previous !== Math.round(basis.previousQty * 1000) || next <= previous || !Number.isSafeInteger(line.lineValueMinor) || line.lineValueMinor < 0) return fail()
        const cumulativeValue = (BigInt(next) * BigInt(item.unitPriceMinor) + 500n) / 1000n
        if (cumulativeValue > BigInt(Number.MAX_SAFE_INTEGER) || Number(cumulativeValue) - basis.previouslyBilledMinor !== line.lineValueMinor) return fail()
        const value = line.lineValueMinor, row = totals.get(item.id)!
        row.issuedMilli += next - previous
        row.issuedMinor += value
        if (![row.issuedMilli, row.issuedMinor].every(Number.isSafeInteger)) return fail()
        sum += value
        if (!Number.isSafeInteger(sum)) return fail()
        lines.set(item.id, { issuedMilli: next - previous, returnedMilli: 0, value, refundedValue: 0 })
      }
      if (sum !== extract.totals.grossMinor) return fail()
      // هذه النسخة تراجع تسلسل الإصدار التاريخي كما كان، دون معاملته كصافي بعد الإشعار.
      issuedHistory.push({ ...extract, refundedMinor: 0 })
      let previousId = extract.journalEntryId, previousDate = date
      for (const refund of extract.refunds ?? []) {
        if (!refund.quantities?.length || refund.grossMinor == null || refund.journalEntryId <= previousId || refund.date < previousDate) return fail()
        addEvent(refund.journalEntryId, refund.date, extract.extractNumber, 'credit', refund.grossMinor)
        let gross = 0
        for (const quantity of refund.quantities) {
          const line = lines.get(quantity.boqItemId), row = totals.get(quantity.boqItemId)
          if (!line || !row) return fail()
          const amount = Math.round(normalizeMovementQty(quantity.qty) * 1000)
          line.returnedMilli += amount
          if (!Number.isSafeInteger(line.returnedMilli) || line.returnedMilli > line.issuedMilli) return fail()
          const cumulative = roundNonNegativeRatio(line.value, line.returnedMilli, line.issuedMilli)
          const delta = cumulative - line.refundedValue
          line.refundedValue = cumulative
          row.returnedMilli += amount
          row.returnedMinor += delta
          gross += delta
          if (![row.returnedMilli, row.returnedMinor, gross].every(Number.isSafeInteger)) return fail()
        }
        if (gross !== refund.grossMinor) return fail()
        previousId = refund.journalEntryId
        previousDate = refund.date
      }
    }
    for (const item of items) if (quantityExtractBasis(item, issuedHistory).estimated) return fail()
  } catch { return fail() }
  const rows = [...totals.values()].map(row => {
    if (row.returnedMilli > row.issuedMilli || row.returnedMinor > row.issuedMinor) return fail()
    return { boqItemId: row.boqItemId, issuedQty: row.issuedMilli / 1000, returnedQty: row.returnedMilli / 1000, netQty: (row.issuedMilli - row.returnedMilli) / 1000, issuedMinor: row.issuedMinor, returnedMinor: row.returnedMinor, netMinor: row.issuedMinor - row.returnedMinor }
  })
  return { rows, events: events.sort((a, b) => a.journalEntryId - b.journalEntryId) }
}
