import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { assertJournalHistoryPreserved } from '../src/core/ledgerHistoryGuard.ts'
import { DesktopStateStorage, newJournalEntries } from '../src/data/persistentStorage.ts'
import { ShopsysDatabase } from '../desktop/sqlite/storage.ts'
import type { DesktopDatabaseBridge } from '../src/data/desktopBridge.ts'
import type { JournalEntry } from '../src/core/ledger.ts'

const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
const beforeEntry: JournalEntry = { id: 1, entryNumber: 1, date: '2025-01-01', description: 'قيد أقدم مستقل', sourceType: 'manual', sourceId: null, lines: [{ accountCode: '1101', debit: 20000, credit: 0 }, { accountCode: '3101', debit: 0, credit: 20000 }], createdBy: 'م', createdAt: '2025-01-01', reversedByEntryId: null, reversesEntryId: null }
const snap = () => {
 const s = S()
 return JSON.stringify({ state: { projects: s.projects, projectExtracts: s.projectExtracts, clientAdvances: s.clientAdvances, retentionReleases: s.retentionReleases, boqItems: s.boqItems, journal: s.journal } })
}
function bridge(db: ShopsysDatabase): DesktopDatabaseBridge {
 return { getSnapshot: async name => db.getSnapshot(name), saveSnapshot: async input => db.saveSnapshot(input), deleteSnapshot: async input => db.deleteSnapshot(input), enqueueOutbox: async () => ({ created: true }), claimOutbox: async () => [], completeOutbox: async () => ({ updated: true }), integrityCheck: async () => ({ ok: true, message: 'ok' }), schemaVersion: async () => 1 }
}
beforeEach(() => {
 const setup = { ...app.setup, completed: true, countryCode: 'EG', activityId: 'contracting' as const, modules: ['contracting'] as never[] }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
 useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: null, branches: [], projects: [], customers: [], boqItems: [], projectExtracts: [], retentionReleases: [], projectSurveys: [], projectExtractDrafts: [], projectCloseouts: [], clientAdvances: [], journal: [beforeEntry], sales: [], saleReturns: [], vouchers: [], clientSettlements: [], changeOrders: [], approvalRequests: [], paymentTerminalTransactions: [], paymentTerminals: [], treasuries: [{ code: '1101', nameAr: 'الخزينة', kind: 'cash', isDefault: true }] })
})
afterEach(() => { useRawDataStore.setState(original); useAppStore.setState(app) })

it.each([false, true])('يحفظ تعديلين فعليين للختامي في SQLite ويستعيدهما مع فرع: %s', async (withBranch) => {
 if (withBranch) useRawDataStore.setState({ branches: [{ id: 1, nameAr: 'الرئيسي', isMain: true, active: true, warehouseId: 1, treasuryCode: '1101' }], activeBranchId: 1, journal: [{ ...beforeEntry, branchId: 1 }], treasuries: [{ code: '1101', nameAr: 'الخزينة', kind: 'cash', isDefault: true, branchId: 1 }] })
 const p = S().addProject({ nameAr: 'مشروع', clientName: '', contractValueMinor: 10000, retentionPercent: 0, startDate: '2025-01-01', notes: '' })
 const extract = S().addProjectExtract({ projectId: p.id, grossMinor: 10000, payment: 'cash', description: 'ختامي', vatPercent: 0, isFinal: true })
 expect(extract.id).toBe(1); expect(extract.journalEntryId).toBe(2)
 const dir = mkdtempSync(join(tmpdir(), 'shopsys-extract-edit-')), path = join(dir, 'data.sqlite')
 let db = await ShopsysDatabase.open(path)
 try {
  const storage = new DesktopStateStorage(bridge(db), null)
  let previous = snap()
  await storage.setItem('shopsys-data', previous)
  let previousJournal = S().journal
  for (const description of ['التعديل الأول', 'التعديل الثاني']) {
   const old = S().projectExtracts[0]
   const updated = S().editProjectExtract({ extractId: old.id, grossMinor: 10000, payment: 'cash', description, vatPercent: 0, reason: 'تصحيح' })
   const reversal = S().journal.find(row => row.id === updated.editReversalEntryId)!
   expect(reversal).toMatchObject({ sourceType: 'reversal', sourceId: old.journalEntryId, reversesEntryId: old.journalEntryId })
   expect(reversal.branchId ?? null).toBe(withBranch ? 1 : null)
   expect(updated.isFinal).toBe(true)
   expect(() => assertJournalHistoryPreserved(previousJournal, S().journal)).not.toThrow()
   const next = snap()
   expect(newJournalEntries(next, previous).map(row => row.id)).toEqual([old.journalEntryId, reversal.id, updated.journalEntryId])
   const broken = S().journal.map(row => row.id === reversal.id ? { ...row, sourceId: old.id } : row)
   expect(() => assertJournalHistoryPreserved(previousJournal, broken)).toThrow(/عكس/)
   const corrupted = JSON.parse(next) as { state: { journal: JournalEntry[] } }
   corrupted.state.journal = broken
   expect(() => newJournalEntries(JSON.stringify(corrupted), previous)).toThrow()
   await expect(storage.setItem('shopsys-data', JSON.stringify(corrupted))).rejects.toThrow()
   expect(db.getSnapshot('shopsys-data').payloadJson).toBe(previous)
   await storage.setItem('shopsys-data', next)
   previous = next; previousJournal = S().journal
  }
  expect(db.getSnapshot('shopsys-data')).toMatchObject({ revision: 3, payloadJson: previous })
  expect(db.raw.prepare('SELECT id, source_id, reversed_by_entry_id, reverses_entry_id FROM journal ORDER BY id').all()).toEqual([
   { id: 1, source_id: null, reversed_by_entry_id: null, reverses_entry_id: null },
   { id: 2, source_id: 1, reversed_by_entry_id: 3, reverses_entry_id: null },
   { id: 3, source_id: 2, reversed_by_entry_id: null, reverses_entry_id: 2 },
   { id: 4, source_id: 1, reversed_by_entry_id: 5, reverses_entry_id: null },
   { id: 5, source_id: 4, reversed_by_entry_id: null, reverses_entry_id: 4 },
   { id: 6, source_id: 1, reversed_by_entry_id: null, reverses_entry_id: null },
  ])
  db.close(); db = await ShopsysDatabase.open(path)
  expect(db.getSnapshot('shopsys-data').payloadJson).toBe(previous)
  expect(db.raw.prepare('SELECT COUNT(*) AS n FROM journal').get()).toEqual({ n: 6 })
 } finally { db.close(); rmSync(dir, { recursive: true, force: true }) }
})

it('يرفض تعديل قيد مستخلص قديم بلا فرع بعد تفعيل الفرع بدلاً من إسناد عكسه تخميناً', () => {
 const project = S().addProject({ nameAr: 'مشروع قديم', clientName: '', contractValueMinor: 10000, retentionPercent: 0, startDate: '2025-01-01', notes: '' })
 const extract = S().addProjectExtract({ projectId: project.id, grossMinor: 10000, payment: 'cash', description: 'قديم', vatPercent: 0, isFinal: true })
 useRawDataStore.setState({ branches: [{ id: 1, nameAr: 'الرئيسي', isMain: true, active: true, warehouseId: 1, treasuryCode: '1101' }], activeBranchId: 1 })
 const before = S()
 expect(() => S().editProjectExtract({ extractId: extract.id, grossMinor: 10000, payment: 'cash', description: 'تعديل', vatPercent: 0, reason: 'تصحيح' })).toThrow(/بلا فرع/)
 expect(S()).toBe(before)
})

it('لا يعيد كتابة عكس تاريخي محفوظ بمصدر المستخلص ولا يجيز استبدال دليله', () => {
 const old = { ...beforeEntry, id: 2, entryNumber: 2, sourceType: 'project_extract' as const, sourceId: 1, reversedByEntryId: 3 }
 const legacy = { ...beforeEntry, id: 3, entryNumber: 3, sourceType: 'reversal' as const, sourceId: 1, reversesEntryId: 2, lines: old.lines.map(line => ({ ...line, debit: line.credit, credit: line.debit })) }
 expect(() => assertJournalHistoryPreserved([old, legacy], [old, legacy])).not.toThrow()
 expect(() => assertJournalHistoryPreserved([old, legacy], [old, { ...legacy, sourceId: 2 }])).toThrow(/تغيّر/)
})
