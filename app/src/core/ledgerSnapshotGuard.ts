import { assertJournalIntegrity, normalizeJournalDates, validateSourceReference } from './ledgerGuard.ts'
import { todayLocalIso } from './time.ts'
import { STANDARD_COA, type JournalEntry, type SourceType } from './ledger.ts'
import { fullCoa } from './treasury.ts'
import { SOURCE_REFERENCE_COLLECTIONS, SOURCE_REFERENCE_COLLECTION_OPTIONS } from './sourceTypes.ts'

type Snapshot = Record<string, unknown>
type BranchYear = { id: number; branchId?: number | null; status: 'open' | 'closed'; nameAr: string; startDate: string; endDate: string }

function rowsOf(snapshot: Snapshot, key: string): Record<string, unknown>[] {
  const rows = snapshot[key]
  if (!Array.isArray(rows)) throw new Error(`مجموعة مستندات المصدر «${key}» غير موجودة في اللقطة`)
  return rows.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object')
}

function indexOf(rows: readonly Record<string, unknown>[]): ReadonlyMap<number, number | null | undefined> {
  return new Map(rows
    .filter((row) => Number.isSafeInteger(row.id))
    .map((row) => [row.id as number, Number.isSafeInteger(row.branchId) ? row.branchId as number : undefined] as const))
}

/** Validate a complete cloud/backup journal before atomically replacing local state. */
export function assertJournalSnapshotSafe(
  snapshot: Snapshot,
  fiscalYears: readonly BranchYear[] = [],
  nowDate = todayLocalIso(),
  previousJournal?: readonly JournalEntry[],
): void {
  const incoming = snapshot.journal
  if (incoming == null) return
  if (!Array.isArray(incoming)) throw new Error('دفتر اليومية في اللقطة ليس قائمة صالحة')
  const journal = normalizeJournalDates(incoming as JournalEntry[]) as JournalEntry[]
  snapshot.journal = journal

  const treasuries = rowsOf(snapshot, 'treasuries') as unknown as Parameters<typeof fullCoa>[1]
  const customAccounts = Array.isArray(snapshot.customAccounts) ? snapshot.customAccounts as Record<string, unknown>[] : []
  const coa = [
    ...fullCoa(STANDARD_COA, treasuries),
    ...customAccounts.map((account) => ({
      code: String(account.code ?? ''),
      nameAr: String(account.nameAr ?? ''),
      rootType: account.rootType,
      parentCode: account.parentCode == null ? null : String(account.parentCode),
      isPostable: true,
    } as never)),
  ]

  const sourceDocumentIndexes: Partial<Record<SourceType, ReadonlyMap<number, number | null | undefined>>> = {}
  for (const [sourceType, collection] of Object.entries(SOURCE_REFERENCE_COLLECTIONS) as [SourceType, string][]) {
    if (!journal.some((entry) => entry.sourceType === sourceType && entry.sourceId != null)) continue
    sourceDocumentIndexes[sourceType] = indexOf(rowsOf(snapshot, collection))
  }
  // Modern payroll journals use runId shared by payslips, while older journals
  // point to payrollRuns.id; support both representations during restore/pull.
  const payrollIndex = new Map(sourceDocumentIndexes.payroll)
  const slips = Array.isArray(snapshot.payrollSlips) ? snapshot.payrollSlips as Record<string, unknown>[] : []
  for (const slip of slips) {
    if (Number.isSafeInteger(slip.runId)) payrollIndex.set(slip.runId as number, undefined)
  }
  sourceDocumentIndexes.payroll = payrollIndex

  const sourceCollectionIndexes: Record<string, ReadonlyMap<number, number | null | undefined>> = {}
  for (const entry of journal) {
    const collection = entry.sourceCollection
    if (!collection || sourceCollectionIndexes[collection]) continue
    if (collection === 'fiscalYears') {
      sourceCollectionIndexes[collection] = new Map(fiscalYears.map((year) => [year.id, year.branchId] as const))
    } else {
      sourceCollectionIndexes[collection] = indexOf(rowsOf(snapshot, collection))
    }
  }

  // Mixed source types were made explicit for new writes from 2026-10-24.
  // Preserve legacy snapshots without a creation stamp, but reject newly stamped
  // entries that omit their discriminator rather than silently guessing a table.
  const mixedTypes = new Set(Object.keys(SOURCE_REFERENCE_COLLECTION_OPTIONS))
  const missingDiscriminators = journal.filter((entry) => mixedTypes.has(entry.sourceType)
    && entry.sourceId != null
    && !entry.sourceCollection
    && typeof entry.createdAt === 'string'
    && entry.createdAt.slice(0, 10) >= '2026-10-24'
    && entry.createdAt.slice(0, 10) <= nowDate)
  if (missingDiscriminators.length) {
    throw new Error(`قيود حديثة بلا مجموعة مصدر صريحة: ${missingDiscriminators.map((entry) => `#${entry.entryNumber ?? entry.id} (${entry.sourceType})`).join('، ')}`)
  }

  const baseline = previousJournal ?? []
  // A restore/first pull has no trusted local ledger to establish which historic
  // rows belong to already-closed periods. Validate structure/references, but do
  // not reinterpret those historic dates as new postings; a non-empty local
  // baseline still enforces closed periods for appended entries.
  const integrityYears = baseline.length
    ? fiscalYears.map((year) => ({ ...year, branchId: year.branchId == null ? undefined : year.branchId }))
    : []
  const context = { coa, fiscalYears: integrityYears, sourceDocumentIndexes, sourceCollectionIndexes, requireSourceCollection: false }
  assertJournalIntegrity(baseline, journal, context)
  // Check the reference itself even for unchanged historical entries; the normal
  // append-only validator intentionally skips their full revalidation on pull.
  for (const entry of journal) {
    const referenceErrors = validateSourceReference(entry, sourceDocumentIndexes, sourceCollectionIndexes, false)
    if (referenceErrors.length) throw new Error(referenceErrors.join(' — '))
  }
}
