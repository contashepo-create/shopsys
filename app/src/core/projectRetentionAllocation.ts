import { FinancialDataReviewError } from './financialDataReview.ts'

/** توزيع التحصيل الكامل فقط؛ لا يستنتج توزيعاً لتحصيل سابق. */
export interface RetentionExtractAllocation { extractId: number; journalEntryId: number; amountMinor: number }
interface RetentionExtract {
  id: number
  journalEntryId: number
  totals: { retentionMinor: number }
  quantityCreditVersion?: number
  refunds?: readonly { journalEntryId: number; retentionMinor?: number }[]
}

/**
 * يحدد حصة كل مستخلص في التحصيل الكامل عند تسلسل قيد معين.
 * يجب على المستدعي فحص الأصل والقيود والإشعارات وتسلسلها أولاً؛
 * هذه ليست تسوية لمحتجز محصل أو إثباتاً لعكس أو تخصيص جزئي.
 */
export function fullRetentionAllocations(extracts: readonly RetentionExtract[], beforeEntryId: number): RetentionExtractAllocation[] {
  const fail = (): never => { throw new FinancialDataReviewError('توزيع تحصيل المحتجز', 'تعذر إثبات محتجز المستخلصات عند التحصيل') }
  if (!Array.isArray(extracts) || !Number.isSafeInteger(beforeEntryId) || beforeEntryId <= 0) return fail()
  const ids = new Set<number>(), entries = new Set<number>()
  for (const extract of extracts) {
    if (!extract || typeof extract !== 'object' || !Number.isSafeInteger(extract.id) || extract.id <= 0 || ids.has(extract.id) || !Number.isSafeInteger(extract.journalEntryId) || extract.journalEntryId <= 0 || entries.has(extract.journalEntryId)) return fail()
    ids.add(extract.id); entries.add(extract.journalEntryId)
  }
  const result: RetentionExtractAllocation[] = []
  let allocated = 0
  for (const extract of extracts) {
    if (extract.journalEntryId >= beforeEntryId) continue
    const held = extract.totals?.retentionMinor
    if (!Number.isSafeInteger(held) || held < 0 || (extract.quantityCreditVersion != null && extract.quantityCreditVersion !== 1 && extract.quantityCreditVersion !== 2)) return fail()
    let credited = 0
    if (extract.quantityCreditVersion === 2) {
      if (!Array.isArray(extract.refunds) || extract.refunds.length === 0) return fail()
      let previousEntryId = extract.journalEntryId
      for (const refund of extract.refunds) {
        if (!refund || !Number.isSafeInteger(refund.journalEntryId) || refund.journalEntryId <= previousEntryId || entries.has(refund.journalEntryId) || !Number.isSafeInteger(refund.retentionMinor) || refund.retentionMinor! < 0) return fail()
        entries.add(refund.journalEntryId); previousEntryId = refund.journalEntryId
        if (refund.journalEntryId < beforeEntryId) credited += refund.retentionMinor!
        if (!Number.isSafeInteger(credited)) return fail()
      }
    }
    const remaining = held - credited
    if (!Number.isSafeInteger(remaining) || remaining < 0) return fail()
    allocated += remaining
    if (!Number.isSafeInteger(allocated)) return fail()
    if (remaining) result.push({ extractId: extract.id, journalEntryId: extract.journalEntryId, amountMinor: remaining })
  }
  return result.sort((a, b) => a.journalEntryId - b.journalEntryId)
}

interface RecordedRetentionRelease {
  journalEntryId: number
  amountMinor: number
  allocationEvidence?: { version: number; allocations: readonly RetentionExtractAllocation[] }
}

/**
 * تخطيط FIFO لدفعة محتجز مع إعادة تشغيل أدلة التحصيل السابقة دون تعديلها.
 * لا يرحّل جزئياً ولا يثبت القيد أو التاريخ أو الخزينة أو الماكينة؛ يجب فحصها
 * قبل استدعائه. لا يستنتج توزيع تحصيل سابق مجهول ولا يحل الإشعار بعد التحصيل.
 */
export function planRetentionAllocations(extracts: readonly RetentionExtract[], releases: readonly RecordedRetentionRelease[], beforeEntryId: number, amountMinor: number): RetentionExtractAllocation[] {
  const fail = (): never => { throw new FinancialDataReviewError('توزيع تحصيل المحتجز', 'التحصيلات أو حصص المستخلصات غير مثبتة') }
  if (!Array.isArray(extracts) || !Array.isArray(releases) || !Number.isSafeInteger(beforeEntryId) || beforeEntryId <= 0 || !Number.isSafeInteger(amountMinor) || amountMinor <= 0) return fail()
  // لا يستولي قيد تحصيل على هوية قيد مستخلص أو إشعار آخر.
  const documentEntries = new Set<number>()
  for (const extract of extracts) {
    if (!extract || typeof extract !== 'object') return fail()
    if (Number.isSafeInteger(extract.journalEntryId)) documentEntries.add(extract.journalEntryId)
    if (Array.isArray(extract.refunds)) for (const refund of extract.refunds) if (refund && Number.isSafeInteger(refund.journalEntryId)) documentEntries.add(refund.journalEntryId)
  }
  if (documentEntries.has(beforeEntryId)) return fail()
  const consumed = new Map<number, number>()
  const availableAt = (entryId: number): RetentionExtractAllocation[] => {
    const rows = fullRetentionAllocations(extracts, entryId)
    const present = new Set(rows.map(row => row.extractId))
    for (const [id, amount] of consumed) if (amount > 0 && !present.has(id)) return fail()
    return rows.map(row => {
      const amount = row.amountMinor - (consumed.get(row.extractId) ?? 0)
      if (!Number.isSafeInteger(amount) || amount < 0) return fail()
      return { ...row, amountMinor: amount }
    }).filter(row => row.amountMinor > 0)
  }
  const allocate = (entryId: number, amount: number): RetentionExtractAllocation[] => {
    let left = amount
    const result: RetentionExtractAllocation[] = []
    for (const row of availableAt(entryId)) {
      if (!left) break
      const take = Math.min(left, row.amountMinor)
      if (take) { result.push({ ...row, amountMinor: take }); left -= take }
    }
    if (left) return fail()
    return result
  }
  let previousId = 0
  for (const release of releases) {
    if (!release || typeof release !== 'object' || !Number.isSafeInteger(release.journalEntryId) || release.journalEntryId <= previousId || release.journalEntryId >= beforeEntryId || documentEntries.has(release.journalEntryId) || !Number.isSafeInteger(release.amountMinor) || release.amountMinor <= 0 || !release.allocationEvidence || release.allocationEvidence.version !== 1 || !Array.isArray(release.allocationEvidence.allocations)) return fail()
    const expected = allocate(release.journalEntryId, release.amountMinor), actual = release.allocationEvidence.allocations
    if (actual.length !== expected.length || expected.some((row, index) => row.extractId !== actual[index]?.extractId || row.journalEntryId !== actual[index]?.journalEntryId || row.amountMinor !== actual[index]?.amountMinor)) return fail()
    for (const row of expected) {
      const value = (consumed.get(row.extractId) ?? 0) + row.amountMinor
      if (!Number.isSafeInteger(value)) return fail()
      consumed.set(row.extractId, value)
    }
    previousId = release.journalEntryId
  }
  return allocate(beforeEntryId, amountMinor)
}
