import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { ShopsysDatabase } from '../desktop/sqlite/storage.ts'
import { DesktopStateStorage, newJournalEntries } from '../src/data/persistentStorage.ts'
import type { DesktopDatabaseBridge } from '../src/data/desktopBridge.ts'

const snapshot = (state: object) => JSON.stringify({ state })
const entry = { id: 1, entryNumber: 1, date: '2024-01-01', description: 'مقدمة', sourceType: 'client_advance', sourceId: 1, lines: [{ accountCode: '1101', debit: 100, credit: 0 }, { accountCode: '2109', debit: 0, credit: 100 }], createdBy: 'م', createdAt: '2024-01-01', reversedByEntryId: null, reversesEntryId: null }
const base = { projects: [{ id: 1 }], clientAdvances: [{ id: 1, projectId: 1, amountMinor: 1000, recoveredMinor: 0, journalEntryId: 2 }], projectExtracts: [], journal: [] as typeof entry[], roleOverrides: {} }

function bridge(db: ShopsysDatabase): DesktopDatabaseBridge {
  return {
    getSnapshot: async name => db.getSnapshot(name),
    saveSnapshot: async input => db.saveSnapshot(input),
    deleteSnapshot: async input => db.deleteSnapshot(input),
    enqueueOutbox: async () => ({ created: true }), claimOutbox: async () => [],
    completeOutbox: async () => ({ updated: true }), integrityCheck: async () => ({ ok: true, message: 'ok' }), schemaVersion: async () => 1,
  }
}

it('يرفض تعارض صلاحية متزامن مع مقدمة عبر كاتبين وSQLite حقيقي، دون إحياء كتابة النافذة القديمة', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'shopsys-project-conflict-'))
  const path = join(dir, 'db.sqlite')
  let db = await ShopsysDatabase.open(path)
  try {
    const first = new DesktopStateStorage(bridge(db), null)
    const second = new DesktopStateStorage(bridge(db), null)
    await first.setItem('shopsys-data', snapshot(base))
    await second.getItem('shopsys-data')
    const issued = { ...base, clientAdvances: [{ ...base.clientAdvances[0], recoveredMinor: 50 }], projectExtracts: [{ id: 1, projectId: 1, advanceRecoveryMinor: 50 }], journal: [entry] }
    await first.setItem('shopsys-data', snapshot(issued))
    await expect(second.setItem('shopsys-data', snapshot({ ...base, roleOverrides: { accountant: [] } }))).rejects.toThrow(/تعارض/)
    expect(db.getSnapshot('shopsys-data').revision).toBe(2)
    expect(JSON.parse(db.getSnapshot('shopsys-data').payloadJson!).state).toEqual(issued)
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM journal').get()).toEqual({ n: 1 })
    // تؤكد القراءة التالية الحالة المثبتة وتزيل علامة فشل القراءة لهذا الاختبار.
    expect(JSON.parse((await second.getItem('shopsys-data'))!).state).toEqual(issued)
    db.close()
    db = await ShopsysDatabase.open(path)
    expect(JSON.parse(db.getSnapshot('shopsys-data').payloadJson!).state).toEqual(issued)
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM journal').get()).toEqual({ n: 1 })
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }) }
})

it('فشل كتابة مجموعة المقدمة داخل معاملة SQLite يعيد اللقطة والقيد والصفوف للحالة السابقة', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'shopsys-project-rollback-'))
  const db = await ShopsysDatabase.open(join(dir, 'db.sqlite'))
  try {
    db.saveSnapshot({ storeName: 'shopsys-data', expectedRevision: 0, payloadJson: snapshot(base) })
    db.raw.exec("CREATE TRIGGER fail_project_advance BEFORE UPDATE ON c_clientAdvances BEGIN SELECT RAISE(ABORT, 'injected failure'); END")
    const changed = { ...base, clientAdvances: [{ ...base.clientAdvances[0], recoveredMinor: 50 }], journal: [entry] }
    expect(() => db.saveSnapshot({ storeName: 'shopsys-data', expectedRevision: 1, payloadJson: snapshot(changed), journalEntries: [entry] })).toThrow(/injected failure/)
    expect(db.getSnapshot('shopsys-data')).toMatchObject({ revision: 1, payloadJson: snapshot(base) })
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM journal').get()).toEqual({ n: 0 })
    const row = db.raw.prepare('SELECT payload_json FROM c_clientAdvances WHERE payload_id = 1').get() as { payload_json: string }
    expect(JSON.parse(row.payload_json)).toEqual(base.clientAdvances[0])
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }) }
})

it('يُسجل قيد العكس وعلامته على الأصل في معاملة SQLite واحدة ويبقيهما بعد إعادة الفتح', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'shopsys-journal-reversal-'))
  const path = join(dir, 'db.sqlite')
  let db = await ShopsysDatabase.open(path)
  try {
    const storage = new DesktopStateStorage(bridge(db), null)
    const original = { ...base, journal: [entry] }
    await storage.setItem('shopsys-data', snapshot(original))
    const reversal = { ...entry, id: 2, entryNumber: 2, description: 'عكس المقدمة', sourceType: 'reversal', sourceId: 1, reversesEntryId: 1, lines: entry.lines.map(line => ({ ...line, debit: line.credit, credit: line.debit })) }
    const reversed = { ...original, journal: [{ ...entry, reversedByEntryId: 2 }, reversal] }
    expect(newJournalEntries(snapshot(reversed), snapshot(original)).map(row => row.id)).toEqual([1, 2])
    await storage.setItem('shopsys-data', snapshot(reversed))
    expect(db.raw.prepare('SELECT id, reversed_by_entry_id, reverses_entry_id FROM journal ORDER BY id').all()).toEqual([
      { id: 1, reversed_by_entry_id: 2, reverses_entry_id: null },
      { id: 2, reversed_by_entry_id: null, reverses_entry_id: 1 },
    ])
    db.close()
    db = await ShopsysDatabase.open(path)
    expect(JSON.parse(db.getSnapshot('shopsys-data').payloadJson!).state.journal).toEqual(reversed.journal)
    expect(db.raw.prepare('SELECT reversed_by_entry_id FROM journal WHERE id = 1').get()).toEqual({ reversed_by_entry_id: 2 })
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }) }
})

it('يرفض علامة بلا قيد عاكس فريد ولا ينشئها في اللقطة أو SQLite', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'shopsys-journal-orphan-'))
  const db = await ShopsysDatabase.open(join(dir, 'db.sqlite'))
  try {
    const storage = new DesktopStateStorage(bridge(db), null)
    const original = { ...base, journal: [entry] }
    await storage.setItem('shopsys-data', snapshot(original))
    const orphan = { ...original, journal: [{ ...entry, reversedByEntryId: 9 }] }
    await expect(storage.setItem('shopsys-data', snapshot(orphan))).rejects.toThrow(/بلا قيد عاكس/)
    expect(db.getSnapshot('shopsys-data')).toMatchObject({ revision: 1, payloadJson: snapshot(original) })
    expect(db.raw.prepare('SELECT reversed_by_entry_id FROM journal WHERE id = 1').get()).toEqual({ reversed_by_entry_id: null })
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }) }
})

it('يرفض اختلاف أصل القيد في SQLite ويتراجع عن تسجيل اللقطة والعكس', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'shopsys-journal-mismatch-'))
  const db = await ShopsysDatabase.open(join(dir, 'db.sqlite'))
  try {
    const storage = new DesktopStateStorage(bridge(db), null)
    const original = { ...base, journal: [entry] }
    await storage.setItem('shopsys-data', snapshot(original))
    db.raw.prepare('UPDATE journal SET description = ? WHERE id = 1').run('تلف تاريخي')
    const reversal = { ...entry, id: 2, entryNumber: 2, sourceType: 'reversal', reversesEntryId: 1, lines: entry.lines.map(line => ({ ...line, debit: line.credit, credit: line.debit })) }
    const reversed = { ...original, journal: [{ ...entry, reversedByEntryId: 2 }, reversal] }
    await expect(storage.setItem('shopsys-data', snapshot(reversed))).rejects.toThrow(/لا يطابق هوية القيد/)
    expect(db.getSnapshot('shopsys-data')).toMatchObject({ revision: 1, payloadJson: snapshot(original) })
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM journal').get()).toEqual({ n: 1 })
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }) }
})

it('إعادة محاولة SQLite لا تؤكد حمولة أو مراجعة مختلفة بنفس المفتاح', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'shopsys-idempotency-'))
  const db = await ShopsysDatabase.open(join(dir, 'db.sqlite'))
  try {
    const request = { storeName: 'shopsys-data', expectedRevision: 0, payloadJson: snapshot(base), idempotencyKey: 'attempt-1' }
    expect(db.saveSnapshot(request).revision).toBe(1)
    expect(db.saveSnapshot(request)).toMatchObject({ revision: 1, replayed: true })
    expect(() => db.saveSnapshot({ ...request, payloadJson: snapshot({ ...base, projects: [] }) })).toThrow(/لا يطابق الحمولة/)
    expect(() => db.saveSnapshot({ ...request, expectedRevision: 99 })).toThrow(/لا يطابق الحمولة/)
    expect(db.getSnapshot('shopsys-data')).toMatchObject({ revision: 1, payloadJson: request.payloadJson })
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }) }
})

it('فشل إدراج العكس يتراجع عن تعديل علامة الأصل واللقطة', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'shopsys-reversal-rollback-'))
  const db = await ShopsysDatabase.open(join(dir, 'db.sqlite'))
  try {
    const storage = new DesktopStateStorage(bridge(db), null)
    const original = { ...base, journal: [entry] }
    await storage.setItem('shopsys-data', snapshot(original))
    db.raw.exec("CREATE TRIGGER fail_reversal BEFORE INSERT ON journal WHEN NEW.id = 2 BEGIN SELECT RAISE(ABORT, 'reversal failure'); END")
    const reversal = { ...entry, id: 2, entryNumber: 2, sourceType: 'reversal', reversesEntryId: 1, lines: entry.lines.map(line => ({ ...line, debit: line.credit, credit: line.debit })) }
    const reversed = { ...original, journal: [{ ...entry, reversedByEntryId: 2 }, reversal] }
    await expect(storage.setItem('shopsys-data', snapshot(reversed))).rejects.toThrow(/reversal failure/)
    expect(db.getSnapshot('shopsys-data')).toMatchObject({ revision: 1, payloadJson: snapshot(original) })
    expect(db.raw.prepare('SELECT id, reversed_by_entry_id FROM journal').all()).toEqual([{ id: 1, reversed_by_entry_id: null }])
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }) }
})

it('ضياع رد SQLite بعد الحفظ ثم إعادة إرسال نفس الطلب لا يكرر القيد', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'shopsys-save-ack-'))
  const db = await ShopsysDatabase.open(join(dir, 'db.sqlite'))
  try {
    const adapter = bridge(db)
    const actualSave = adapter.saveSnapshot
    let loseResponse = true
    adapter.saveSnapshot = async input => {
      const result = await actualSave(input)
      if (loseResponse) { loseResponse = false; throw new Error('lost response') }
      return result
    }
    const storage = new DesktopStateStorage(adapter, null)
    const value = snapshot({ ...base, journal: [entry] })
    await expect(storage.setItem('shopsys-data', value)).rejects.toThrow(/lost response/)
    expect(db.getSnapshot('shopsys-data').revision).toBe(1)
    await expect(storage.setItem('shopsys-data', value)).resolves.toBeUndefined()
    expect(db.getSnapshot('shopsys-data').revision).toBe(1)
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM journal').get()).toEqual({ n: 1 })
    await expect(storage.drain('shopsys-data')).resolves.toBeUndefined()
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }) }
})

it('يرفض عكساً مرتبطاً لا يعكس الحساب والمبلغ وأبعاد الطرف ومركز التكلفة أو الفرع', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'shopsys-reversal-proof-'))
  const db = await ShopsysDatabase.open(join(dir, 'db.sqlite'))
  try {
    const storage = new DesktopStateStorage(bridge(db), null)
    const originalEntry = { ...entry, branchId: 1, lines: [
      { ...entry.lines[0], costCenterId: 7, partyKind: 'customer', partyId: 8, relatedBranchId: 2 }, entry.lines[1],
    ] }
    const original = { ...base, journal: [originalEntry] }
    await storage.setItem('shopsys-data', snapshot(original))
    const reversal = { ...originalEntry, id: 2, entryNumber: 2, sourceType: 'reversal', sourceId: 1, reversesEntryId: 1, lines: originalEntry.lines.map(line => ({ ...line, debit: line.credit, credit: line.debit })) }
    const line = reversal.lines[0]
    const bad = [
      { ...reversal, sourceId: 8 }, { ...reversal, sourceType: 'manual' }, { ...reversal, branchId: 2 }, { ...reversal, branchId: undefined },
      { ...reversal, lines: [{ ...line, accountCode: '1102' }, reversal.lines[1]] },
      { ...reversal, lines: [{ ...line, credit: 99 }, reversal.lines[1]] },
      { ...reversal, lines: [{ ...line, costCenterId: 9 }, reversal.lines[1]] },
      { ...reversal, lines: [{ ...line, partyId: 9 }, reversal.lines[1]] },
      { ...reversal, lines: [{ ...line, relatedBranchId: 3 }, reversal.lines[1]] },
    ]
    for (const malformed of bad) {
      const changed = { ...original, journal: [{ ...originalEntry, reversedByEntryId: 2 }, malformed] }
      await expect(storage.setItem('shopsys-data', snapshot(changed))).rejects.toThrow(/قيد العكس لا يطابق/)
      expect(db.getSnapshot('shopsys-data')).toMatchObject({ revision: 1, payloadJson: snapshot(original) })
      expect(db.raw.prepare('SELECT id, reversed_by_entry_id FROM journal').all()).toEqual([{ id: 1, reversed_by_entry_id: null }])
    }
    const duplicate = { ...original, journal: [{ ...originalEntry, reversedByEntryId: 2 }, reversal, { ...reversal, id: 3 }] }
    await expect(storage.setItem('shopsys-data', snapshot(duplicate))).rejects.toThrow(/وفريد/)
    await storage.setItem('shopsys-data', snapshot({ ...original, journal: [{ ...originalEntry, reversedByEntryId: 2 }, reversal] }))
    expect(db.raw.prepare('SELECT id, reversed_by_entry_id, reverses_entry_id FROM journal ORDER BY id').all()).toEqual([{ id: 1, reversed_by_entry_id: 2, reverses_entry_id: null }, { id: 2, reversed_by_entry_id: null, reverses_entry_id: 1 }])
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }) }
})
it('يرفض عكس قيد بلا فرع بقيد ينسبه إلى فرع، قبل حفظ لقطة SQLite', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'shopsys-reversal-unassigned-'))
  const db = await ShopsysDatabase.open(join(dir, 'db.sqlite'))
  try {
    const storage = new DesktopStateStorage(bridge(db), null)
    const original = { ...base, journal: [entry] }
    await storage.setItem('shopsys-data', snapshot(original))
    const reversal = { ...entry, id: 2, entryNumber: 2, branchId: 1, sourceType: 'reversal', sourceId: 1, reversesEntryId: 1, lines: entry.lines.map(line => ({ ...line, debit: line.credit, credit: line.debit })) }
    await expect(storage.setItem('shopsys-data', snapshot({ ...original, journal: [{ ...entry, reversedByEntryId: 2 }, reversal] }))).rejects.toThrow(/قيد العكس لا يطابق/)
    expect(db.getSnapshot('shopsys-data')).toMatchObject({ revision: 1, payloadJson: snapshot(original) })
    expect(db.raw.prepare('SELECT id, reversed_by_entry_id FROM journal').all()).toEqual([{ id: 1, reversed_by_entry_id: null }])
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }) }
})
it('يرفض كاتبين يضيفان قيوداً مختلفة بالتزامن عند تعارض SQLite ويحافظ على القيود المحفوظة', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'shopsys-ledger-concurrent-'))
  const path = join(dir, 'db.sqlite')
  let db = await ShopsysDatabase.open(path)
  try {
    const first = new DesktopStateStorage(bridge(db), null), second = new DesktopStateStorage(bridge(db), null)
    const original = { ...base, journal: [entry] }
    await first.setItem('shopsys-data', snapshot(original)); await second.getItem('shopsys-data')
    const firstEntry = { ...entry, id: 2, entryNumber: 2, description: 'أول' }
    const secondEntry = { ...entry, id: 3, entryNumber: 3, description: 'ثان' }
    const committed = { ...original, journal: [entry, firstEntry] }
    await first.setItem('shopsys-data', snapshot(committed))
    await expect(second.setItem('shopsys-data', snapshot({ ...original, journal: [entry, secondEntry] }))).rejects.toThrow(/تعارض تاريخ اليومية/)
    expect(db.getSnapshot('shopsys-data')).toMatchObject({ revision: 2, payloadJson: snapshot(committed) })
    expect(db.raw.prepare('SELECT id FROM journal ORDER BY id').all()).toEqual([{ id: 1 }, { id: 2 }])
    await second.getItem('shopsys-data')
    db.close(); db = await ShopsysDatabase.open(path)
    expect(JSON.parse(db.getSnapshot('shopsys-data').payloadJson!).state).toEqual(committed)
    expect(db.raw.prepare('SELECT id FROM journal ORDER BY id').all()).toEqual([{ id: 1 }, { id: 2 }])
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }) }
})
it('يرفض الحفظ المباشر غير المتعارض إسقاط اليومية أو تغيير قيد قديم أو تكرار معرفه', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'shopsys-ledger-direct-'))
  const path = join(dir, 'db.sqlite')
  let db = await ShopsysDatabase.open(path)
  try {
    const storage = new DesktopStateStorage(bridge(db), null)
    const original = { ...base, journal: [entry] }
    await storage.setItem('shopsys-data', snapshot(original))
    const candidates = [{ ...original, journal: [] }, { ...original, journal: [{ ...entry, description: 'معدل' }] }, { ...original, journal: [entry, { ...entry, description: 'مكرر' }] }, { ...original, journal: null }]
    for (const altered of candidates) {
      await expect(storage.setItem('shopsys-data', snapshot(altered))).rejects.toThrow(/دفتر|قيد|قيود/)
      expect(db.getSnapshot('shopsys-data')).toMatchObject({ revision: 1, payloadJson: snapshot(original) })
      expect(db.raw.prepare('SELECT id, description FROM journal').all()).toEqual([{ id: 1, description: entry.description }])
    }
    const added = { ...entry, id: 2, entryNumber: 2, description: 'إضافة' }
    const valid = { ...original, journal: [entry, added] }
    await storage.setItem('shopsys-data', snapshot(valid))
    db.close(); db = await ShopsysDatabase.open(path)
    expect(JSON.parse(db.getSnapshot('shopsys-data').payloadJson!).state).toEqual(valid)
    expect(db.raw.prepare('SELECT id FROM journal ORDER BY id').all()).toEqual([{ id: 1 }, { id: 2 }])
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }) }
})
it('لا يختلق حارس الحفظ إصلاحاً لدفتر تاريخي تالف لم يتغير، لكنه يمنع تغييره', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'shopsys-ledger-legacy-'))
  const db = await ShopsysDatabase.open(join(dir, 'db.sqlite'))
  try {
    const historical = { ...base, journal: [entry, entry], preferences: { mode: 'light' } }
    db.saveSnapshot({ storeName: 'shopsys-data', expectedRevision: 0, payloadJson: snapshot(historical) })
    const storage = new DesktopStateStorage(bridge(db), null)
    const changed = { ...historical, preferences: { mode: 'dark' } }
    await storage.setItem('shopsys-data', snapshot(changed))
    await expect(storage.setItem('shopsys-data', snapshot({ ...changed, journal: [entry] }))).rejects.toThrow(/معرف|قيود/)
    expect(db.getSnapshot('shopsys-data')).toMatchObject({ revision: 2, payloadJson: snapshot(changed) })
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }) }
})
