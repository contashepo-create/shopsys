import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { mergeConcurrentSnapshots } from '../src/data/persistentStorage.ts'

const initial = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 5, 12))
  const setup = { ...app.setup, completed: true, countryCode: 'EG', activityId: 'contracting' as const, modules: ['contracting'] as never[] }
  useAppStore.setState({ setup, companySetup: setup, fiscalYears: [], approvals: { ...app.approvals, enabled: false } })
  useRawDataStore.setState({ ...initial, currentUserId: null, activeBranchId: null, branches: [], customers: [], projects: [], boqItems: [], projectExtracts: [], retentionReleases: [], projectSurveys: [], projectExtractDrafts: [], projectCloseouts: [], clientAdvances: [], journal: [], sales: [], saleReturns: [], vouchers: [], clientSettlements: [], changeOrders: [], paymentTerminals: [], paymentTerminalTransactions: [], treasuries: [{ code: '1101', nameAr: 'الخزينة', kind: 'cash', isDefault: true }] })
  S().addProject({ nameAr: 'مشروع', clientName: '', contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
})
afterEach(() => { useRawDataStore.setState(initial); useAppStore.setState(app); vi.useRealTimers() })
function advance() { S().receiveClientAdvance({ projectId: S().projects[0].id, amountMinor: 1000, treasury: '1101' }) }
function issue(recovery: number) { return S().addProjectExtract({ projectId: S().projects[0].id, grossMinor: 2000, payment: 'cash', vatPercent: 0, description: 'أعمال', advanceRecoveryMinor: recovery }) }
function edit(id: number, recovery: number) { return S().editProjectExtract({ extractId: id, grossMinor: 2000, payment: 'cash', vatPercent: 0, description: 'أعمال معدلة', reason: 'تصحيح', advanceRecoveryMinor: recovery }) }
it('يوثق الاسترداد عبر الدفعات ويمنع تعديل الأقدم قبل الاسترداد اللاحق', () => {
  advance(); advance()
  const first = issue(1200), second = issue(300)
  expect(first.advanceAllocations).toEqual([{ advanceId: 1, journalEntryId: 1, amountMinor: 1000 }, { advanceId: 2, journalEntryId: 2, amountMinor: 200 }])
  expect(second.advanceAllocations).toEqual([{ advanceId: 2, journalEntryId: 2, amountMinor: 300 }])
  expect(S().clientAdvances.map(row => row.recoveredMinor)).toEqual([1000, 500])
  const before = S()
  expect(() => edit(first.id, 900)).toThrow(/استرداد مقدمة أحدث/)
  expect(S().journal).toBe(before.journal); expect(S().clientAdvances).toBe(before.clientAdvances)
  const updated = edit(second.id, 100)
  expect(updated.advanceAllocations).toEqual([{ advanceId: 2, journalEntryId: 2, amountMinor: 100 }])
  expect(S().clientAdvances.map(row => row.recoveredMinor)).toEqual([1000, 300])
  edit(second.id, 0)
  expect(S().clientAdvances.map(row => row.recoveredMinor)).toEqual([1000, 200])
  expect(edit(first.id, 900).advanceAllocations).toEqual([{ advanceId: 1, journalEntryId: 1, amountMinor: 900 }])
  expect(S().clientAdvances.map(row => row.recoveredMinor)).toEqual([900, 0])
})
it('يرفض تعديل السجل القديم الملتبس بين مقدمات متعددة بلا تخمين، ويسمح بالدفعة الوحيدة المثبتة', () => {
  advance(); advance(); const ex = issue(1200)
  useRawDataStore.setState({ projectExtracts: S().projectExtracts.map(row => ({ ...row, advanceAllocations: undefined })) })
  const before = S()
  expect(() => edit(ex.id, 500)).toThrow(/التاريخي غير مثبت/)
  expect(S().journal).toBe(before.journal); expect(S().clientAdvances).toBe(before.clientAdvances)
  useRawDataStore.setState({ projectExtracts: [], clientAdvances: [], journal: [] })
  advance(); const single = issue(600)
  useRawDataStore.setState({ projectExtracts: S().projectExtracts.map(row => ({ ...row, advanceAllocations: undefined })) })
  const amended = edit(single.id, 300)
  expect(amended.advanceAllocations).toEqual([{ advanceId: 1, journalEntryId: 1, amountMinor: 300 }])
  expect(S().clientAdvances[0].recoveredMinor).toBe(300)
})
it('يرفض الرصيد أو التوزيع أو القيد المعبث به قبل إصدار أو تعديل مستخلص', () => {
  advance(); advance(); const ex = issue(1200)
  const base = S(), assertNoWrite = () => {
    const before = S()
    expect(() => edit(ex.id, 500)).toThrow(/مراجعة/)
    expect(() => issue(100)).toThrow(/مراجعة/)
    expect(S().journal).toBe(before.journal); expect(S().clientAdvances).toBe(before.clientAdvances)
  }
  useRawDataStore.setState({ projectExtracts: base.projectExtracts.map(row => ({ ...row, advanceAllocations: row.advanceAllocations?.map((a, i) => i === 0 ? { ...a, journalEntryId: 999 } : a) })) }); assertNoWrite()
  useRawDataStore.setState({ projectExtracts: base.projectExtracts, clientAdvances: base.clientAdvances.map((row, i) => i === 0 ? { ...row, recoveredMinor: 999 } : row) }); assertNoWrite()
  useRawDataStore.setState({ clientAdvances: base.clientAdvances, journal: base.journal.map(row => row.id === 1 ? { ...row, lines: [] } : row) }); assertNoWrite()
  useRawDataStore.setState({ journal: [...base.journal, base.journal[0]] }); assertNoWrite()
})
it('يمنع دمج تحصيل أو استرداد مقدمات مع أساس المشروع أو الدفتر المتغير في الاتجاهين', () => {
  const snap = (state: object) => JSON.stringify({ state })
  const base = { projects: [{ id: 1 }], clientAdvances: [{ id: 1, projectId: 1, amountMinor: 1000, recoveredMinor: 0 }], projectExtracts: [], journal: [{ id: 1 }] }
  const issuing = { ...base, clientAdvances: [{ ...base.clientAdvances[0], recoveredMinor: 500 }], projectExtracts: [{ id: 1, projectId: 1, advanceRecoveryMinor: 500, advanceAllocations: [{ advanceId: 1, journalEntryId: 1, amountMinor: 500 }] }], journal: [{ id: 1 }, { id: 2 }] }
  const otherStates = [
    { ...base, clientAdvances: [...base.clientAdvances, { id: 2, projectId: 1, amountMinor: 100, recoveredMinor: 0 }] },
    { ...base, projectExtracts: [{ id: 5, projectId: 1 }] },
    { ...base, journal: [...base.journal, { id: 3 }] },
    { ...base, projects: [{ id: 1, name: 'changed' }] },
  ]
  for (const other of otherStates) {
    expect(() => mergeConcurrentSnapshots(snap(base), snap(issuing), snap(other))).toThrow(/تعارض/)
    expect(() => mergeConcurrentSnapshots(snap(base), snap(other), snap(issuing))).toThrow(/تعارض/)
  }
  expect(JSON.parse(mergeConcurrentSnapshots(snap(base), snap(issuing), snap(base))).state.clientAdvances[0].recoveredMinor).toBe(500)
})
it('يكتشف تبديل تخصيصَي مستخلصين حتى إذا تطابقت مجاميع كل دفعة', () => {
  advance(); advance(); const first = issue(1000); const second = issue(1000)
  useRawDataStore.setState({ projectExtracts: S().projectExtracts.map(row => row.id === first.id ? { ...row, advanceAllocations: second.advanceAllocations } : { ...row, advanceAllocations: first.advanceAllocations }) })
  const before = S()
  expect(() => edit(second.id, 500)).toThrow(/مراجعة/)
  expect(S().journal).toBe(before.journal); expect(S().clientAdvances).toBe(before.clientAdvances)
})
it('يبقى توزيع المقدمة وقيدها قابلين للمراجعة بعد النسخ الاحتياطي والاستعادة', async () => {
  const { secureStorage, flushSecureStorageWrites } = await import('../src/data/secureStorage.ts')
  const { buildBackup, parseBackup } = await import('../src/core/backup.ts')
  advance(); advance(); const extract = issue(1200)
  vi.useRealTimers()
  await flushSecureStorageWrites('shopsys-data')
  const stored = await secureStorage.getItem('shopsys-data')
  const backup = buildBackup({ appState: {}, storeState: JSON.parse(stored!), appDataVersion: 25, shopName: 'اختبار' })
  const restored = parseBackup(JSON.stringify(backup))
  useRawDataStore.setState({ projectExtracts: [], clientAdvances: [], journal: [] })
  await flushSecureStorageWrites('shopsys-data')
  await secureStorage.setItem('shopsys-data', JSON.stringify(restored.data.store))
  await useRawDataStore.persist.rehydrate()
  expect(S().projectExtracts[0].advanceAllocations).toEqual(extract.advanceAllocations)
  expect(edit(extract.id, 300).advanceAllocations).toMatchObject([{ advanceId: 1, amountMinor: 300 }])
  expect(S().clientAdvances.map(row => row.recoveredMinor)).toEqual([300, 0])
})
it('لا تُعاد كتابة الأقدم لإضافة استرداد يسبق استرداداً أحدث', () => {
  advance(); const first = issue(0); issue(300)
  const before = S()
  expect(() => edit(first.id, 100)).toThrow(/استرداد مقدمة أحدث/)
  expect(S().journal).toBe(before.journal); expect(S().clientAdvances).toBe(before.clientAdvances)
})
it('يرفض تجاوز المتاح بعد التراجع دون اعتماد قيد العكس المؤقت', () => {
  advance(); const ex = issue(700), before = S()
  expect(() => edit(ex.id, 1500)).toThrow(/أكبر من رصيد/)
  expect(S().journal).toBe(before.journal); expect(S().projectExtracts).toBe(before.projectExtracts); expect(S().clientAdvances).toBe(before.clientAdvances)
})
it('تحصيل مقدمة جديد متزامن مع مستخلص آخر لا يُدمج آلياً', () => {
  const wrap = (state: object) => JSON.stringify({ state })
  const base = { projects: [{ id: 1 }], clientAdvances: [], projectExtracts: [], journal: [] }
  const advancing = { ...base, clientAdvances: [{ id: 1, projectId: 1 }], journal: [{ id: 1 }] }
  const extract = { ...base, projectExtracts: [{ id: 1, projectId: 1 }], journal: [{ id: 2 }] }
  expect(() => mergeConcurrentSnapshots(wrap(base), wrap(advancing), wrap(extract))).toThrow(/تعارض/)
  expect(() => mergeConcurrentSnapshots(wrap(base), wrap(extract), wrap(advancing))).toThrow(/تعارض/)
})
it('يرفض صف تخصيص تالف بدلاً من اعتماد رصيد بلا دليل', () => {
  advance(); const ex = issue(500)
  useRawDataStore.setState({ projectExtracts: S().projectExtracts.map(row => ({ ...row, advanceAllocations: [null] as never })) })
  const before = S()
  expect(() => edit(ex.id, 300)).toThrow(/مراجعة/)
  expect(S().journal).toBe(before.journal); expect(S().clientAdvances).toBe(before.clientAdvances)
})
