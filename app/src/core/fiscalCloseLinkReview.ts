import { closingMechanismIds, isValidFiscalDate, type FiscalYear } from './fiscal.ts'
import type { JournalEntry } from './ledger.ts'

/**
 * فحص تحفظي للروابط التي تؤثر على قيد إقفال السنة، لا تدقيق شامل لليومية.
 * يستدعى بعد الفحص البنيوي؛ الأصل والعاكس يجب أن يكونا ظاهرين حتى نهاية السنة.
 */
export function fiscalCloseLinkIssues(journal: readonly JournalEntry[], year: Pick<FiscalYear, 'startDate' | 'endDate'>): number[] {
  const visible = journal.filter(entry => entry.date <= year.endDate)
  const byId = new Map(visible.map(entry => [entry.id, entry]))
  const mechanism = closingMechanismIds(visible)
  const claims = new Map<number, number>()
  for (const entry of visible) if (entry.reversesEntryId != null) claims.set(entry.reversesEntryId, (claims.get(entry.reversesEntryId) ?? 0) + 1)
  const issues: number[] = []
  for (const entry of visible) {
    const falseClosingLink = entry.sourceType !== 'reversal' && entry.reversesEntryId != null && mechanism.has(entry.reversesEntryId)
    if (entry.date < year.startDate || (entry.sourceType !== 'reversal' && !falseClosingLink)) continue
    const original = entry.reversesEntryId == null ? undefined : byId.get(entry.reversesEntryId)
    const invalid = entry.sourceType !== 'reversal' || !original || original.id >= entry.id || original.date > entry.date || claims.get(original.id) !== 1
      || !Array.isArray(original.lines) || !Array.isArray(entry.lines) || original.lines.length !== entry.lines.length
      || entry.lines.some((line, index) => {
        const old = original.lines[index]
        return !line || !old || line.accountCode !== old.accountCode || line.debit !== old.credit || line.credit !== old.debit
          || (line.costCenterId ?? null) !== (old.costCenterId ?? null) || (line.partyKind ?? null) !== (old.partyKind ?? null)
          || (line.partyId ?? null) !== (old.partyId ?? null) || (line.relatedBranchId ?? null) !== (old.relatedBranchId ?? null)
      })
    if (invalid) issues.push(entry.id)
  }
  return issues
}

/** يتحقق من مطالبة مخفية بأصل ظاهر دون إظهار تفاصيل القيد المخفي. */
export function hasHiddenFiscalReversalClaims(journal: readonly JournalEntry[], visible: readonly JournalEntry[], year: Pick<FiscalYear, 'startDate' | 'endDate'>): boolean {
  // تستند هوية الصفوف إلى مراجع اليومية نفسها التي تحتفظ بها تصفية الفرع.
  // أي عكس مخفي يدّعي أصلاً ظاهراً يستدعي مراجعة، حتى لو كان إسناده
  // الصريح يمنع إظهاره. لا نعيد إسناده ولا نكشف رقم القيد أو الفرع.
  const visibleRows = new Set(visible)
  const visibleIds = new Set(visible.filter(entry => entry && typeof entry === 'object').map(entry => entry.id))
  return journal.some(entry => {
    if (!entry || entry.sourceType !== 'reversal' || visibleRows.has(entry) || entry.reversesEntryId == null || !visibleIds.has(entry.reversesEntryId)) return false
    if (typeof entry.date !== 'string' || !isValidFiscalDate(entry.date)) return true
    return entry.date >= year.startDate && entry.date <= year.endDate
  })
}

/**
 * قد تُخفي تصفية الفرع عكساً بلا فرع عندما يتعذر الوصول إلى أصله. يمنع
 * هذا الفحص الإقفال ولا يكشف تفاصيل فرع آخر أو ينسب القيد تخميناً.
 */
export function hasAmbiguousUnassignedFiscalReversals(journal: readonly JournalEntry[], year: Pick<FiscalYear, 'startDate' | 'endDate'>): boolean {
  const byId = new Map<number, JournalEntry[]>()
  for (const entry of journal) {
    if (!entry || typeof entry !== 'object') continue
    const list = byId.get(entry.id) ?? []
    list.push(entry); byId.set(entry.id, list)
  }
  const resolved = new Set<number>()
  for (const entry of journal) {
    if (!entry || entry.sourceType !== 'reversal' || entry.branchId != null) continue
    if (typeof entry.date !== 'string' || !isValidFiscalDate(entry.date)) return true
    if (entry.date < year.startDate || entry.date > year.endDate) continue
    const seen = new Set<number>()
    let current = entry
    while (current.sourceType === 'reversal' && current.branchId == null) {
      if (resolved.has(current.id)) break
      if (seen.has(current.id) || (byId.get(current.id)?.length ?? 0) !== 1 || !Number.isSafeInteger(current.reversesEntryId)) return true
      seen.add(current.id)
      const parents = byId.get(current.reversesEntryId!) ?? []
      if (parents.length !== 1) return true
      const parent = parents[0]
      if (typeof parent.date !== 'string' || !isValidFiscalDate(parent.date) || parent.date > current.date || parent.id >= current.id) return true
      current = parent
    }
    for (const id of seen) resolved.add(id)
  }
  return false
}
