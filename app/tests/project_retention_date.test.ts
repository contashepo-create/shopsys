import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const initial = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
 vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 5, 12))
 const setup = { ...app.setup, completed: true, countryCode: 'EG', activityId: 'contracting' as const, modules: ['contracting'] as never[] }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
 useRawDataStore.setState({ ...initial, currentUserId: null, activeBranchId: null, branches: [], customers: [], employees: [], projects: [], boqItems: [], projectExtracts: [], retentionReleases: [], projectSurveys: [], projectExtractDrafts: [], projectCloseouts: [], clientAdvances: [], journal: [], changeOrders: [], paymentTerminals: [], paymentTerminalTransactions: [], treasuries: [{ code: '1101', nameAr: 'الخزينة', kind: 'cash', isDefault: true }] })
 const p = S().addProject({ nameAr: 'مشروع', clientName: '', clientId: null, contractValueMinor: 10000, retentionPercent: 10, startDate: '2025-01-01', notes: '' })
 S().addProjectExtract({ projectId: p.id, date: '2026-11-03', grossMinor: 1000, payment: 'cash', description: 'أعمال', vatPercent: 0 })
})
afterEach(() => { useRawDataStore.setState(initial); useAppStore.setState(app); vi.useRealTimers() })
const release = (date?: string) => S().releaseRetention(S().projects[0].id, '1101', undefined, date)
it('تاريخ التحصيل والقيد سابق، والإقفال ووقت التسجيل الفعليان اليوم', () => {
 expect(release('2026-11-04').amount).toBe(100)
 expect(S().retentionReleases[0]).toMatchObject({ date: '2026-11-04', amountMinor: 100, journalEntryId: S().journal[1].id })
 expect(S().retentionReleases[0].createdAt?.slice(0, 10)).toBe('2026-11-05')
 expect(S().projects[0].status).toBe('completed'); expect(S().projects[0].completedAt?.slice(0, 10)).toBe('2026-11-05')
 expect(S().journal[1].date).toBe('2026-11-04'); expect(S().journal[1].createdAt.slice(0, 10)).toBe('2026-11-05')
 expect(S().journal[1].lines).toEqual(expect.arrayContaining([expect.objectContaining({ accountCode: '1101', debit: 100 }), expect.objectContaining({ accountCode: '1105', credit: 100 })]))
 expect(() => release()).toThrow(/مقفل/); expect(S().journal).toHaveLength(2)
})
it('الاستدعاء السابق دون تاريخ يستخدم اليوم', () => { release(); expect(S().retentionReleases[0].date).toBe('2026-11-05') })
it.each(['', '2026-11-06', '2026-02-30', '2026-11-04T12:00:00Z'])('يرفض التاريخ %s دون إقفال أو قيد', date => {
 expect(() => release(date)).toThrow(/تاريخ/); expect(S().projects[0].status).toBe('active'); expect(S().journal).toHaveLength(1); expect(S().retentionReleases).toHaveLength(0)
})
it('لا يسبق المستخلص ولا يدخل سنة مقفلة', () => {
 expect(() => release('2026-11-02')).toThrow(/تسلسل/)
 useAppStore.setState({ fiscalYears: [{ id: 1, nameAr: 'مقفلة', startDate: '2026-01-01', endDate: '2026-11-04', status: 'closed' }] })
 expect(() => release('2026-11-04')).toThrow(/مقفلة/); expect(S().journal).toHaveLength(1); expect(S().projects[0].status).toBe('active')
})
it('يرفض الماكينة بتاريخ سابق والخزينة غير الصالحة والمستخدم غير المصرح', () => {
 expect(() => S().releaseRetention(S().projects[0].id, '1101', { terminalId: 't', providerReference: 'ref' }, '2026-11-04')).toThrow(/الماكينة/)
 expect(() => S().releaseRetention(S().projects[0].id, '4107')).toThrow(/الخزينة/)
 useRawDataStore.setState({ currentUserId: 999 }); expect(() => release()).toThrow(/صلاحية/)
 expect(S().journal).toHaveLength(1); expect(S().projects[0].status).toBe('active')
})
it('لا يحصّل بناءً على أصل أو قيد مستخلص غير مطابق', () => {
 const ex = S().projectExtracts[0]
 useRawDataStore.setState({ projectExtracts: [{ ...ex, totals: { ...ex.totals, retentionMinor: 90 } }] })
 expect(() => release()).toThrow(); expect(S().retentionReleases).toHaveLength(0); expect(S().journal).toHaveLength(1); expect(S().projects[0].status).toBe('active')
})
it('يرفض سجل تحصيل قديم تالف بدلاً من خصمه من المحتجز', () => {
 useRawDataStore.setState({ retentionReleases: [{ id: 1, projectId: S().projects[0].id, date: '2026-11-04', amountMinor: 10, journalEntryId: 999 }] })
 expect(() => release()).toThrow(/غير متطابق/); expect(S().journal).toHaveLength(1)
})
it('يحمي الفرع والخزينة ولا يكتب عبر نطاق كل الفروع', () => {
 const p = S().projects[0], ex = S().projectExtracts[0]
 const branches = [{ id: 1, nameAr: 'رئيسي', isMain: true, warehouseId: 1, treasuryCode: '1101', active: true }, { id: 2, nameAr: 'فرعي', isMain: false, warehouseId: 2, treasuryCode: '1102', active: true }]
 useRawDataStore.setState({ branches, activeBranchId: null, projects: [{ ...p, branchId: 1 }], projectExtracts: [{ ...ex, branchId: 1 }], treasuries: [{ code: '1101', nameAr: 'رئيسي', kind: 'cash' }, { code: '1102', nameAr: 'فرعي', kind: 'bank', branchId: 2 }] } as never)
 expect(() => release()).toThrow(/اختر الفرع/)
 useRawDataStore.setState({ activeBranchId: 1 })
 expect(() => S().releaseRetention(p.id, '1102')).toThrow(/الفرع/); expect(S().journal).toHaveLength(1)
})
it('تحصيل الماكينة في يومه يسجل مرجع العملية ووقت التسجيل', () => {
 const terminal = { id: 't1', code: 'TERM-0001', nameAr: 'ماكينة', providerName: 'مزود', branchId: '', settlementAccountCode: '1101', terminalId: 'P1', status: 'active' as const }
 S().addPaymentTerminal(terminal)
 S().releaseRetention(S().projects[0].id, '1101', { terminalId: 't1', providerReference: 'PAY-123' })
 expect(S().paymentTerminalTransactions[0]).toMatchObject({ terminalId: 't1', documentId: 'retention:1', amountMinor: 100, providerReference: 'PAY-123' })
 expect(S().paymentTerminalTransactions[0].occurredAt.slice(0, 10)).toBe('2026-11-05')
})
it('يرفض تحصيل محتجز مسجلاً لفرع مختلف بدلاً من خلط الأرصدة', () => {
 const p = S().projects[0], ex = S().projectExtracts[0]
 const branches = [{ id: 1, nameAr: 'رئيسي', isMain: true, warehouseId: 1, treasuryCode: '1101', active: true }, { id: 2, nameAr: 'فرعي', isMain: false, warehouseId: 2, treasuryCode: '1102', active: true }]
 useRawDataStore.setState({ branches, activeBranchId: 1, projects: [{ ...p, branchId: 1 }], projectExtracts: [{ ...ex, branchId: 1 }], retentionReleases: [{ id: 1, projectId: p.id, date: '2026-11-04', amountMinor: 10, journalEntryId: 999, branchId: 2 }] } as never)
 expect(() => release()).toThrow(/فرع آخر/); expect(S().journal).toHaveLength(1)
})
