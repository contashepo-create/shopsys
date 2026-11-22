import type { JournalEntry, JournalLine } from './ledger.ts'
import { validateFiscalYear, type FiscalYear } from './fiscal.ts'

// JSON persist drops undefined object properties. Compare keys independently of
// serialization order, but never ignore unknown persisted accounting evidence.
function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, i) => sameValue(value, b[i]))
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  const x = a as Record<string, unknown>, y = b as Record<string, unknown>
  const keys = Object.keys(x).filter(key => x[key] !== undefined).sort()
  const other = Object.keys(y).filter(key => y[key] !== undefined).sort()
  return keys.length === other.length && keys.every((key, i) => key === other[i] && sameValue(x[key], y[key]))
}

function withoutReversalMarker(entry: JournalEntry): Record<string, unknown> {
  const value = { ...entry } as Record<string, unknown>
  delete value.reversedByEntryId
  if (typeof value.date === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value.date)) value.date = value.date.slice(0, 10)
  return value
}

function opposite(a: JournalLine, b: JournalLine): boolean {
  return !!a && !!b && typeof a.accountCode === 'string' && a.accountCode.length > 0 && a.accountCode === b.accountCode
    && Number.isSafeInteger(a.debit) && Number.isSafeInteger(a.credit) && a.debit >= 0 && a.credit >= 0
    && a.debit === b.credit && a.credit === b.debit
    && (a.costCenterId ?? null) === (b.costCenterId ?? null) && (a.partyKind ?? null) === (b.partyKind ?? null)
    && (a.partyId ?? null) === (b.partyId ?? null) && (a.relatedBranchId ?? null) === (b.relatedBranchId ?? null)
}

/**
 * Before replacing a known ledger, preserve the entire existing prefix and all
 * persisted evidence. This is deliberately conservative: older backups and
 * interleaved concurrent histories must be reviewed rather than silently merged.
 * It does not establish freshness across devices or a transaction with settings.
 */
export function assertJournalHistoryPreserved(current: readonly JournalEntry[], incoming: unknown): void {
  if (!Array.isArray(current)) throw new Error('دفتر اليومية المحلي غير صالح — راجع البيانات قبل الاستعادة')
  if (!current.length && incoming == null) return // نسخ قديمة لم تحفظ اليومية
  if (!Array.isArray(incoming)) throw new Error('النسخة لا تتضمن دفتر اليومية المحلي أو تحتوي دفتراً غير صالح — لم تُستعد البيانات')
  const next = incoming as JournalEntry[]
  if (next.length < current.length) throw new Error('النسخة تسقط قيوداً محلية — راجع الدفتر قبل الاستعادة')
  // يجب أن يبقى مرجع القيد فريداً في الإضافات أيضاً، حتى لو كان
  // الدفتر المحلي فارغاً؛ وإلا قد تشير المستندات إلى قيدين مختلفين.
  const incomingIds = new Set<number>()
  for (const entry of next) {
    if (!entry || typeof entry !== 'object' || !Number.isSafeInteger(entry.id) || entry.id <= 0 || incomingIds.has(entry.id)) throw new Error('دفتر اليومية الوارد يحتوي معرف قيد غير صالح أو مكرراً — راجع الدفتر')
    incomingIds.add(entry.id)
  }
  const seen = new Set<number>()
  for (let i = 0; i < current.length; i++) {
    const old = current[i], row = next[i]
    if (!old || !row || !Number.isSafeInteger(old.id) || old.id <= 0 || seen.has(old.id) || old.id !== row.id) throw new Error('النسخة تسقط قيوداً محلية أو تغير ترتيبها — راجع الدفتر قبل الاستعادة')
    seen.add(old.id)
    if (!sameValue(withoutReversalMarker(old), withoutReversalMarker(row))) throw new Error(`النسخة تغيّر بيانات القيد المحلي #${old.id} — راجع الدفتر قبل الاستعادة`)
    if ((old.reversedByEntryId ?? null) === (row.reversedByEntryId ?? null)) {
      if (old.reversedByEntryId == null && next.slice(current.length).some(entry => entry && (entry.reversesEntryId === old.id || (entry.sourceType === 'reversal' && entry.sourceId === old.id)))) throw new Error(`النسخة تحمل عكساً غير مرتبط بعلامة القيد #${old.id} — راجع الدفتر`)
      continue
    }
    if (old.reversedByEntryId != null || !Number.isSafeInteger(row.reversedByEntryId) || (row.reversedByEntryId as number) <= 0) throw new Error(`النسخة تغيّر علامة عكس القيد #${old.id} — راجع الدفتر`)
    const matches = next.filter(entry => entry && entry.id === row.reversedByEntryId)
    const claims = next.filter(entry => entry && (entry.reversesEntryId === old.id || (entry.sourceType === 'reversal' && entry.sourceId === old.id)))
    const reversal = matches[0]
    if (matches.length !== 1 || claims.length !== 1 || claims[0] !== reversal || next.indexOf(reversal) < current.length || reversal.sourceType !== 'reversal' || reversal.sourceId !== old.id || reversal.reversesEntryId !== old.id || reversal.reversedByEntryId != null || (reversal.branchId ?? null) !== (old.branchId ?? null) || !Array.isArray(old.lines) || !Array.isArray(reversal.lines) || old.lines.length !== reversal.lines.length || !(old.lines.length >= 2 || (old.memoOnly === true && old.lines.length === 0)) || !old.lines.every((line: JournalLine, index: number) => opposite(line, reversal.lines[index]))) {
      throw new Error(`النسخة تحمل عكساً غير مثبت للقيد #${old.id} — راجع الدفتر`)
    }
  }
}

/** إعدادات النسخة تُستبدل منفصلةً عن اليومية: لا تُسقط أو تغيّر الفترات المحلية بصمت. */
export function assertFiscalYearsPreserved(current: readonly FiscalYear[], incoming: unknown): void {
  if (!Array.isArray(current)) throw new Error('السنوات المالية المحلية غير صالحة — راجع الإعدادات قبل الاستعادة')
  if (incoming === undefined && current.length === 0) return // نسخة قديمة بلا تقويم
  if (!Array.isArray(incoming)) throw new Error('النسخة تسقط السنوات المالية المحلية أو تحتوي تقويماً غير صالح')
  const seen = new Set<number>()
  for (const value of incoming) {
    const year = value as FiscalYear
    if (!year || typeof year !== 'object' || !Number.isSafeInteger(year.id) || year.id <= 0 || seen.has(year.id) || typeof year.nameAr !== 'string' || typeof year.startDate !== 'string' || typeof year.endDate !== 'string' || (year.branchId != null && (!Number.isSafeInteger(year.branchId) || year.branchId <= 0)) || (year.status !== 'open' && year.status !== 'closed') || validateFiscalYear(year, []).length > 0) throw new Error('السنوات المالية في النسخة غير صالحة أو مكررة — راجع الإعدادات')
    seen.add(year.id)
  }
  for (let i = 0; i < incoming.length; i++) for (let j = i + 1; j < incoming.length; j++) {
    const a = incoming[i] as FiscalYear, b = incoming[j] as FiscalYear
    if ((a.branchId ?? null) !== (b.branchId ?? null)) continue
    if (a.startDate <= b.endDate && b.startDate <= a.endDate) throw new Error('السنوات المالية في النسخة متداخلة — راجع الإعدادات')
    if (a.status === 'open' && b.status === 'open') throw new Error('توجد سنوات مالية مفتوحة متعددة للفرع في النسخة — راجع الإعدادات')
  }
  for (const year of current) {
    const matches = incoming.filter(row => row && row.id === year.id)
    if (matches.length !== 1 || !sameValue(year, matches[0])) throw new Error(`النسخة تسقط أو تغيّر السنة المالية المحلية #${year.id} — راجع الإقفال والإعدادات قبل الاستعادة`)
  }
}
