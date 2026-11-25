import { afterEach, describe, expect, it } from 'vitest'
import { createCipheriv, randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { ShopsysDatabase, type JournalEntryDto } from '../desktop/sqlite/storage.ts'
import { assertBackupRestoreHistory, assertFileRestoreHistory } from '../desktop/fileRestoreHistory.ts'
import { cleanStagedProbeFiles, discardStagedBackup, fingerprintRestoreFile, replaceWithStagedBackup, stageFileRestore } from '../desktop/fileRestoreStage.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
const key = randomBytes(32), wrap = (state: unknown) => JSON.stringify({ state })
const year = { id: 1, nameAr: '2025', startDate: '2025-01-01', endDate: '2025-12-31', status: 'closed', branchId: 1 }
const entry: JournalEntryDto = { id: 1, entryNumber: 10, date: '2025-01-02', description: 'قيد', sourceType: 'manual', sourceId: null, lines: [{ accountCode: '1101', debit: 10, credit: 0 }, { accountCode: '4101', debit: 0, credit: 10 }], createdBy: 'م', createdAt: '2025-01-02', reversedByEntryId: null, reversesEntryId: null }
const baseData = { journal: [], treasuries: [], projects: [], projectDeletionRecords: [], projectCloseouts: [], materialRequisitions: [], quotationDeletionRecords: [], surveyDeletionRecords: [] }
const baseApp = { fiscalYears: [year] }
function encrypt(payload: string) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv)
  const content = Buffer.concat([cipher.update(payload), cipher.final(), cipher.getAuthTag()])
  return `enc:v1:${iv.toString('base64url')}:${content.toString('base64url')}`
}
async function create(path: string, data: unknown = baseData, app: unknown = baseApp, sqlEntry?: JournalEntryDto) {
  const db = await ShopsysDatabase.open(path)
  if (data !== null) db.saveSnapshot({ storeName: 'shopsys-data', expectedRevision: 0, payloadJson: typeof data === 'string' ? data : wrap(data), ...(sqlEntry ? { journalEntries: [sqlEntry] } : {}) })
  if (app !== null) db.saveSnapshot({ storeName: 'shopsys-app', expectedRevision: 0, payloadJson: typeof app === 'string' ? app : wrap(app) })
  return db
}
async function setup(oldData: unknown = baseData, newData: unknown = baseData, oldApp: unknown = baseApp, newApp: unknown = baseApp, oldEntry?: JournalEntryDto, newEntry?: JournalEntryDto) {
  const root = mkdtempSync(join(tmpdir(), 'file-history-')); roots.push(root)
  const live = join(root, 'live.db'), next = join(root, 'backup.db')
  const current = await create(live, oldData, oldApp, oldEntry)
  const candidate = await create(next, newData, newApp, newEntry); candidate.close()
  return { live, next, current }
}

describe('حماية أدلة الاستعادة الملفية على قاعدتي SQLite', () => {
  it('يرفض إسقاط علامة المستخلص الختامي في ملف الاستعادة مع إبقاء القاعدة الأصلية مفتوحة', async () => {
    const extract = { id: 1, projectId: 1, isFinal: true }
    const old = { ...baseData, projectExtracts: [extract] }
    const incoming = { ...old, projectExtracts: [{ ...extract, isFinal: false }] }
    const { next, current } = await setup(old, incoming)
    try {
      expect(() => assertFileRestoreHistory(current.raw, next, key)).toThrow(/ختامي/)
      expect(current.raw.open).toBe(true)
      expect(current.getSnapshot('shopsys-data').payloadJson).toBe(wrap(old))
    } finally { current.close() }
  })
  it('يرفض تغيير رقم أو أساس الختامي مع القيد نفسه في قاعدة الاستعادة ويبقي الحالية مفتوحة', async () => {
    const extract = { id: 1, projectId: 1, isFinal: true, extractNumber: 'PRX-0001', journalEntryId: 1, payment: 'cash', totals: { grossMinor: 100, dueMinor: 100 } }
    const old = { ...baseData, projectExtracts: [extract] }
    for (const patch of [{ extractNumber: 'PRX-آخر' }, { totals: { grossMinor: 50, dueMinor: 50 } }]) {
      const incoming = { ...old, projectExtracts: [{ ...extract, ...patch }] }
      const { next, current } = await setup(old, incoming)
      try {
        expect(() => assertFileRestoreHistory(current.raw, next, key)).toThrow(/ختامي/)
        expect(current.raw.open).toBe(true)
        expect(current.getSnapshot('shopsys-data').payloadJson).toBe(wrap(old))
      } finally { current.close() }
    }
  })
  it('يرفض إعادة فتح مشروع محصل المحتجز في ملف الاستعادة دون إغلاق القاعدة الحالية', async () => {
    const project = { id: 1, status: 'completed', completedAt: '2026-11-15T10:00:00', branchId: 1 }
    const release = { id: 1, projectId: 1 }
    const old = { ...baseData, projects: [project], retentionReleases: [release] }
    const incoming = { ...old, projects: [{ ...project, status: 'active' }] }
    const { next, current } = await setup(old, incoming)
    try {
      expect(() => assertFileRestoreHistory(current.raw, next, key)).toThrow(/إقفال المشروع/)
      expect(current.raw.open).toBe(true)
      expect(current.getSnapshot('shopsys-data').payloadJson).toBe(wrap(old))
    } finally { current.close() }
  })
  it('يقبل الأدلة المطابقة ويسمح بتجهيز النسخة واستبدالها وإعادة فتحها', async () => {
    const { live, next, current } = await setup({ ...baseData, journal: [entry] }, { ...baseData, journal: [entry] }, baseApp, baseApp, entry, entry)
    const stage = stageFileRestore(next, live)
    try {
      expect(() => assertFileRestoreHistory(current.raw, stage, key)).not.toThrow()
      cleanStagedProbeFiles(stage); current.close()
      replaceWithStagedBackup(live, stage, live + '.before', fingerprintRestoreFile(stage), backup => { try { assertBackupRestoreHistory(backup, stage, key) } finally { cleanStagedProbeFiles(backup); cleanStagedProbeFiles(stage) } })
      const db = await ShopsysDatabase.open(live)
      try { expect(JSON.parse(db.getSnapshot('shopsys-data').payloadJson!).state.journal).toEqual([entry]) } finally { db.close() }
    } finally { if (current.raw.open) current.close() }
  })
  it('يرفض نسخة تُسقط قيداً في لقطة JSON دون إغلاق القاعدة أو تغييرها', async () => {
    const { live, next, current } = await setup({ ...baseData, journal: [entry] }, baseData, baseApp, baseApp, entry)
    const stage = stageFileRestore(next, live)
    try {
      expect(() => assertFileRestoreHistory(current.raw, stage, key)).toThrow('تسقط قيوداً محلية')
      expect(current.getSnapshot('shopsys-data').payloadJson).toBe(wrap({ ...baseData, journal: [entry] }))
      expect(current.raw.open).toBe(true)
    } finally { discardStagedBackup(stage); current.close() }
  })
  it('يرفض حذف سنة مقفلة وغياب مخزن الإعدادات في الملف الوارد', async () => {
    const { next, current } = await setup(baseData, baseData, baseApp, { fiscalYears: [] })
    try { expect(() => assertFileRestoreHistory(current.raw, next, key)).toThrow('السنة المالية المحلية') } finally { current.close() }
    const second = await setup(baseData, baseData, baseApp, null)
    try { expect(() => assertFileRestoreHistory(second.current.raw, second.next, key)).toThrow('إعدادات النسخة مفقودة') } finally { second.current.close() }
  })
  it('يرفض فقد رقم محفوظ في جدول SQLite حتى لو كانت اللقطات متطابقة', async () => {
    const { next, current } = await setup()
    current.raw.prepare('INSERT INTO doc_numbers VALUES (?, ?, ?, ?, ?)').run('1', 'invoiceNumber', '42', 'device', 'date')
    try { expect(() => assertFileRestoreHistory(current.raw, next, key)).toThrow('تسقط رقم مستند') } finally { current.close() }
  })
  it('يقبل أرقام المستندات المثبتة حين تتطابق المجموعة والفرع والرقم', async () => {
    const { next, current } = await setup()
    current.raw.prepare('INSERT INTO doc_numbers VALUES (?, ?, ?, ?, ?)').run('1', 'invoiceNumber', '42', 'device', 'date')
    const candidate = new Database(next)
    try { candidate.prepare('INSERT INTO doc_numbers VALUES (?, ?, ?, ?, ?)').run('1', 'invoiceNumber', '42', 'device', 'date') } finally { candidate.close() }
    try { expect(() => assertFileRestoreHistory(current.raw, next, key)).not.toThrow() } finally { current.close() }
  })
  it('يرفض إسقاط أو تغيير حدث تدقيق محفوظ في SQLite', async () => {
    const { next, current } = await setup()
    current.raw.prepare('INSERT INTO audit_log VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(1, 'date', 'user', 'ops', 'action', null, 'device', '', 'date')
    try {
      expect(() => assertFileRestoreHistory(current.raw, next, key)).toThrow('حدث التدقيق')
      const candidate = new Database(next)
      try { candidate.prepare('INSERT INTO audit_log VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(1, 'date', 'user', 'ops', 'modified', null, 'device', '', 'date') } finally { candidate.close() }
      expect(() => assertFileRestoreHistory(current.raw, next, key)).toThrow('حدث التدقيق')
      const corrected = new Database(next)
      try { corrected.prepare('UPDATE audit_log SET title = ? WHERE id = 1').run('action') } finally { corrected.close() }
      expect(() => assertFileRestoreHistory(current.raw, next, key)).not.toThrow()
    } finally { current.close() }
  })
  it('يرفض إسقاط أو تغيير قيد في جدول SQLite حتى لو احتوته اللقطة', async () => {
    const { next, current } = await setup({ ...baseData, journal: [entry] }, { ...baseData, journal: [entry] }, baseApp, baseApp, entry)
    try { expect(() => assertFileRestoreHistory(current.raw, next, key)).toThrow('تسقط أو تغيّر قيد SQLite') } finally { current.close() }
  })
  it('يرفض إسقاط سجل حذف مشروع أو محضر كميات أو إذن مواد محفوظ', async () => {
    for (const [field, value, message] of [
      ['projectDeletionRecords', [{ id: 7, reason: 'حذف' }], 'سجل حذف المشروع'],
      ['projectCloseouts', [{ id: 2, projectId: 9, basis: 'محضر' }], 'محاضر الكميات'],
      ['materialRequisitions', [{ id: 3, projectId: 9, status: 'issued' }], 'صرف المواد'],
    ] as const) {
      const { next, current } = await setup({ ...baseData, [field]: value }, baseData)
      try { expect(() => assertFileRestoreHistory(current.raw, next, key)).toThrow(message) } finally { current.close() }
    }
  })
  it('يرفض إحياء مشروع أو عرض له سجل حذف في النسخة نفسها', async () => {
    const project = await setup(baseData, { ...baseData, projectDeletionRecords: [{ id: 7 }], projects: [{ id: 7 }] })
    try { expect(() => assertFileRestoreHistory(project.current.raw, project.next, key)).toThrow('تعيد مشروعاً محذوفاً') } finally { project.current.close() }
    const quote = await setup(baseData, { ...baseData, quotationDeletionRecords: [{ id: 11 }], quotations: [{ id: 11 }] })
    try { expect(() => assertFileRestoreHistory(quote.current.raw, quote.next, key)).toThrow('عرض سعر محذوف') } finally { quote.current.close() }
  })
  it('يرفض إسقاط سجل تواصل من مشروع باقٍ', async () => {
    const history = [{ customerId: 1, customerName: 'أ', capturedAt: '2025-01-01', capturedBy: 'م', profile: {} }]
    const { next, current } = await setup({ ...baseData, projects: [{ id: 1, customerContactHistory: history }] }, { ...baseData, projects: [{ id: 1 }] })
    try { expect(() => assertFileRestoreHistory(current.raw, next, key)).toThrow('سجل التواصل التاريخي') } finally { current.close() }
  })
  it('يدعم فك لقطات enc:v1 بالمفتاح الأصلي ويرفض المفتاح غير المطابق', async () => {
    const { next, current } = await setup(encrypt(wrap(baseData)), encrypt(wrap(baseData)), encrypt(wrap(baseApp)), encrypt(wrap(baseApp)))
    try {
      expect(() => assertFileRestoreHistory(current.raw, next, key)).not.toThrow()
      expect(() => assertFileRestoreHistory(current.raw, next, randomBytes(32))).toThrow('فك تشفيرها')
    } finally { current.close() }
  })
  it.each(['[]', '{"state":null}', '{broken', '{"state":{"__proto__":{}}}'])('يرفض حالة واردة غير آمنة %s', async bad => {
    const { next, current } = await setup(baseData, bad)
    try { expect(() => assertFileRestoreHistory(current.raw, next, key)).toThrow() } finally { current.close() }
  })
  it('يسمح بقاعدة محلية جديدة فارغة، لكنه يرفض نسخة مفقودة البيانات', async () => {
    const first = await setup(null, baseData, null, baseApp)
    try { expect(() => assertFileRestoreHistory(first.current.raw, first.next, key)).not.toThrow() } finally { first.current.close() }
    const second = await setup(null, null, null, null)
    try { expect(() => assertFileRestoreHistory(second.current.raw, second.next, key)).toThrow('بيانات النسخة مفقودة') } finally { second.current.close() }
  })
  it('يرفض مرشحاً ينقصه جدول اليومية حتى إن اجتاز وجود snapshots', async () => {
    const { next, current } = await setup()
    const candidate = new Database(next); candidate.exec('DROP TABLE journal'); candidate.close()
    try { expect(() => assertFileRestoreHistory(current.raw, next, key)).toThrow('جدول journal مفقود') } finally { current.close() }
  })
})
it('يرفض الاستعادة الملفية إذا أسقطت تحصيل محتجز أو دليل إشعار في اللقطة', async () => {
  const release = { id: 3, projectId: 9, amountMinor: 100, journalEntryId: 4 }
  const extract = { id: 5, projectId: 9, refundedMinor: 10, refundedTaxMinor: 0, refunds: [{ amountMinor: 10, taxShareMinor: 0, journalEntryId: 7 }] }
  for (const [oldData, newData, expected] of [
    [{ ...baseData, retentionReleases: [release] }, { ...baseData, retentionReleases: [] }, 'تحصيل المحتجز'],
    [{ ...baseData, projectExtracts: [extract] }, { ...baseData, projectExtracts: [{ ...extract, refunds: [] }] }, 'دليل إشعار'],
  ] as const) {
    const { next, current } = await setup(oldData, newData)
    try { expect(() => assertFileRestoreHistory(current.raw, next, key)).toThrow(expected) } finally { current.close() }
  }
})
it('يرفض الاستعادة الملفية إن فقدت أصل مقدمة محلية أو غيرت قيدها', async () => {
  const advance = { id: 4, projectId: 1, date: '2026-01-01', amountMinor: 500, recoveredMinor: 0, journalEntryId: 7 }
  for (const rows of [[], [{ ...advance, journalEntryId: 8 }]]) {
    const { next, current } = await setup({ ...baseData, clientAdvances: [advance] }, { ...baseData, clientAdvances: rows })
    try { expect(() => assertFileRestoreHistory(current.raw, next, key)).toThrow('أصل دفعة المقدمة') } finally { current.close() }
  }
})
it('يرفض ملف SQLite يغير رصيد استرداد المقدمة دون تغير مستخلص المشروع', async () => {
  const advance = { id: 4, projectId: 1, date: '2026-01-01', amountMinor: 500, recoveredMinor: 0, journalEntryId: 7 }
  const old = { ...baseData, clientAdvances: [advance], projectExtracts: [] }
  const nextData = { ...old, clientAdvances: [{ ...advance, recoveredMinor: 100 }] }
  const { next, current } = await setup(old, nextData)
  try { expect(() => assertFileRestoreHistory(current.raw, next, key)).toThrow('لا يطابق تغيّر مستخلصات') } finally { current.close() }
})
it('يرفض ملف SQLite يسقط استرداد مستخلص دون تغيير الدفعة', async () => {
  const advance = { id: 4, projectId: 1, date: '2026-01-01', amountMinor: 500, recoveredMinor: 100, journalEntryId: 7 }
  const old = { ...baseData, clientAdvances: [advance], projectExtracts: [{ id: 3, projectId: 1, advanceRecoveryMinor: 100 }] }
  const { next, current } = await setup(old, { ...old, projectExtracts: [] })
  try { expect(() => assertFileRestoreHistory(current.raw, next, key)).toThrow('لا يطابق تغيّر مستخلصات') } finally { current.close() }
})
it('يرفض ملف SQLite يبدل دليل تخصيص مقدمة دون قيد بديل', async () => {
  const advance = { id: 4, projectId: 1, date: '2026-01-01', amountMinor: 500, recoveredMinor: 100, journalEntryId: 7 }
  const extract = { id: 3, projectId: 1, journalEntryId: 9, advanceRecoveryMinor: 100, advanceAllocations: [{ advanceId: 4, journalEntryId: 7, amountMinor: 100 }] }
  const old = { ...baseData, clientAdvances: [advance], projectExtracts: [extract] }
  const data = { ...old, projectExtracts: [{ ...extract, advanceAllocations: [{ advanceId: 4, journalEntryId: 8, amountMinor: 100 }] }] }
  const { next, current } = await setup(old, data)
  try { expect(() => assertFileRestoreHistory(current.raw, next, key)).toThrow('دون قيد مستخلص بديل') } finally { current.close() }
})
it('يرفض ملف SQLite يسقط لقطة توزيع راتب قسيمة محفوظة', async () => {
  const slip = { id: 1, employeeId: 1, projectAllocation: { version: 1, projects: [{ projectId: 1, basisPoints: 10000 }] } }
  const old = { ...baseData, payrollSlips: [slip] }
  const next = { ...baseData, payrollSlips: [{ ...slip, projectAllocation: undefined }] }
  const state = await setup(old, next)
  try { expect(() => assertFileRestoreHistory(state.current.raw, state.next, key)).toThrow('توزيع الرواتب') } finally { state.current.close() }
})
it('يحافظ ملف SQLite على تخصيص تحصيل المحتجز الجديد ولا يبدله بالمبلغ نفسه لمستخلص آخر', async () => {
  const release = { id: 3, projectId: 9, amountMinor: 100, journalEntryId: 4, allocationEvidence: { version: 1, allocations: [{ extractId: 5, journalEntryId: 2, amountMinor: 100 }] } }
  const old = { ...baseData, projectExtracts: [{ id: 5, projectId: 9, journalEntryId: 2, totals: { retentionMinor: 100 } }], retentionReleases: [release] }
  const altered = { ...old, retentionReleases: [{ ...release, allocationEvidence: { version: 1, allocations: [{ extractId: 6, journalEntryId: 2, amountMinor: 100 }] } }] }
  const rejected = await setup(old, altered)
  try { expect(() => assertFileRestoreHistory(rejected.current.raw, rejected.next, key)).toThrow('تحصيل المحتجز') } finally { rejected.current.close() }
  const accepted = await setup(old, old)
  try { expect(() => assertFileRestoreHistory(accepted.current.raw, accepted.next, key)).not.toThrow() } finally { accepted.current.close() }
})
it('يرفض ملف SQLite يحافظ على التحصيل لكنه يسقط مستخلصه المخصص قبل الاستبدال', async () => {
  const release = { id: 3, projectId: 9, amountMinor: 100, journalEntryId: 4, allocationEvidence: { version: 1, allocations: [{ extractId: 5, journalEntryId: 2, amountMinor: 100 }] } }
  const extract = { id: 5, projectId: 9, journalEntryId: 2, totals: { retentionMinor: 100 } }
  const old = { ...baseData, projectExtracts: [extract], retentionReleases: [release] }
  const { next, current } = await setup(old, { ...old, projectExtracts: [] })
  try { expect(() => assertFileRestoreHistory(current.raw, next, key)).toThrow('أساس توزيع تحصيل المحتجز'); expect(current.getSnapshot('shopsys-data').payloadJson).toBe(wrap(old)) } finally { current.close() }
})
it('يرفض ملف SQLite يضيف قيداً بمعرف مكرر رغم بقاء القيد المحلي في لقطة JSON', async () => {
  const old = { ...baseData, journal: [entry] }
  const nextData = { ...baseData, journal: [entry, { ...entry, description: 'قيد آخر بالمعرف نفسه' }] }
  const { next, current } = await setup(old, nextData, baseApp, baseApp, entry, entry)
  try {
    expect(() => assertFileRestoreHistory(current.raw, next, key)).toThrow(/معرف قيد غير صالح أو مكرراً/)
    expect(JSON.parse(current.getSnapshot('shopsys-data').payloadJson!).state.journal).toEqual([entry])
  } finally { current.close() }
})
it('يرفض SQLite استبدال أو رد حركة ماكينة مرتبطة بتحصيل محتجز قديم دون دليل تسوية', async () => {
  const charge = { id: 't1', kind: 'charge', documentType: 'project_extract', documentId: 'retention:3', amountMinor: 100 }
  const release = { id: 3, projectId: 9, amountMinor: 100, journalEntryId: 4 }
  const original = { ...baseData, projectExtracts: [], retentionReleases: [release], paymentTerminalTransactions: [charge] }
  for (const transactions of [[], [charge, { ...charge, id: 'r1', kind: 'refund', originalTransactionId: 't1' }]]) {
    const { next, current } = await setup(original, { ...original, paymentTerminalTransactions: transactions })
    try { expect(() => assertFileRestoreHistory(current.raw, next, key)).toThrow(/ماكينة تحصيل المحتجز/) } finally { current.close() }
  }
})

it('يرفض الاستعادة الملفية التي تخفض عداد خطاب محذوف قبل استبدال القاعدة', async () => {
  const local = { ...baseData, letterNumberCounters: { 'branch-1:2026': 9 } }
  const { next, current } = await setup(local, { ...baseData, letterNumberCounters: { 'branch-1:2026': 2 } })
  try {
    expect(() => assertFileRestoreHistory(current.raw, next, key)).toThrow('عداد الخطابات')
    expect(current.getSnapshot('shopsys-data').payloadJson).toBe(wrap(local))
  } finally { current.close() }
})


it('يرفض تغير اليومية بعد فحصها الأول بفضل فحص نسخة الأمان بعد إغلاق القاعدة', async () => {
  const { live, next, current } = await setup()
  const stage = stageFileRestore(next, live), fingerprint = fingerprintRestoreFile(stage), before = live + '.before'
  try {
    assertFileRestoreHistory(current.raw, stage, key)
    cleanStagedProbeFiles(stage)
    current.saveSnapshot({ storeName: 'shopsys-data', expectedRevision: 1, payloadJson: wrap({ ...baseData, journal: [entry] }), journalEntries: [entry] })
    current.close()
    expect(() => replaceWithStagedBackup(live, stage, before, fingerprint, backup => {
      try { assertBackupRestoreHistory(backup, stage, key) } finally { cleanStagedProbeFiles(backup); cleanStagedProbeFiles(stage) }
    })).toThrow('تسقط قيوداً محلية')
    const recovered = await ShopsysDatabase.open(live)
    try { expect(JSON.parse(recovered.getSnapshot('shopsys-data').payloadJson!).state.journal).toEqual([entry]) } finally { recovered.close() }
    const saved = await ShopsysDatabase.open(before)
    try { expect(JSON.parse(saved.getSnapshot('shopsys-data').payloadJson!).state.journal).toEqual([entry]) } finally { saved.close() }
  } finally { if (current.raw.open) current.close(); discardStagedBackup(stage) }
})
