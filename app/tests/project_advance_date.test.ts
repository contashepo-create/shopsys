import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
 vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 5, 12))
 const setup = { ...app.setup, completed: true, countryCode: 'EG', activityId: 'contracting' as const, modules: ['contracting'] as never[] }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [], approvals: { ...app.approvals, enabled: false } })
 useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: null, branches: [], customers: [], employees: [], projects: [], boqItems: [], projectExtracts: [], projectSurveys: [], projectExtractDrafts: [], projectCloseouts: [], clientAdvances: [], journal: [], changeOrders: [], paymentTerminals: [], paymentTerminalTransactions: [], treasuries: [{ code: '1101', nameAr: 'الخزينة', kind: 'cash', isDefault: true }] })
 S().addProject({ nameAr: 'مشروع', clientName: '', contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
})
afterEach(() => { useRawDataStore.setState(original); useAppStore.setState(app); vi.useRealTimers() })
const receive = (date?: string) => S().receiveClientAdvance({ projectId: S().projects[0].id, amountMinor: 1000, treasury: '1101', ...(date === undefined ? {} : { date }) })
it.each(['2026-11-05', '2026-11-04', '2026-11-03'])('يسجل الدفعة والقيد بتاريخ %s مع وقت إنشاء فعلي', date => {
 const observed: [number, number][] = []
 const off = useRawDataStore.subscribe(state => observed.push([state.clientAdvances.length, state.journal.length]))
 try { receive(date); expect(observed).toEqual([[1, 1]]) } finally { off() }
 const state = S(), advance = state.clientAdvances[0], entry = state.journal[0]
 expect(advance).toMatchObject({ date, amountMinor: 1000, recoveredMinor: 0, journalEntryId: entry.id })
 expect(entry.date).toBe(date); expect(entry.createdAt.slice(0, 10)).toBe('2026-11-05')
 expect(entry.lines).toEqual(expect.arrayContaining([expect.objectContaining({ accountCode: '1101', debit: 1000 }), expect.objectContaining({ accountCode: '2109', credit: 1000 })]))
})
it('يتوافق مع المستدعين السابقين بترحيل تاريخ اليوم', () => { receive(); expect(S().clientAdvances[0].date).toBe('2026-11-05') })
it.each(['2026-11-06', '2026-02-30', '', '2026-11-04T12:00:00Z'])('يرفض التاريخ غير الصحيح أو المستقبلي %s دون قيد', date => {
 expect(() => receive(date)).toThrow(/تاريخ/); expect(S().clientAdvances).toHaveLength(0); expect(S().journal).toHaveLength(0)
})
it('يرفض السنة المقفلة دون كتابة الدفعة أو القيد', () => {
 useAppStore.setState({ fiscalYears: [{ id: 1, nameAr: 'مقفلة', startDate: '2026-01-01', endDate: '2026-11-04', status: 'closed' }] })
 expect(() => receive('2026-11-04')).toThrow(/مقفلة/); expect(S().clientAdvances).toHaveLength(0); expect(S().journal).toHaveLength(0)
})
it('لا يعيد ترتيب دفعة مسجلة أو يدخلها قبل مستخلص مسجل', () => {
 receive('2026-11-04')
 const before = S()
 expect(() => receive('2026-11-03')).toThrow(/تسلسل/)
 expect(S().clientAdvances).toBe(before.clientAdvances); expect(S().journal).toBe(before.journal)
 S().addProjectExtract({ projectId: S().projects[0].id, grossMinor: 1000, payment: 'cash', description: 'أعمال', vatPercent: 0 })
 const after = S()
 expect(() => receive('2026-11-04')).toThrow(/تسلسل/)
 expect(S().clientAdvances).toBe(after.clientAdvances); expect(S().journal).toBe(after.journal)
})
it('يستهلك المقدمات بترتيبها الذي تتحقق منه التواريخ', () => {
 receive('2026-11-03'); receive('2026-11-04')
 S().addProjectExtract({ projectId: S().projects[0].id, grossMinor: 1500, payment: 'cash', description: 'أعمال', vatPercent: 0, advanceRecoveryMinor: 1500 })
 expect(S().clientAdvances.map(row => row.recoveredMinor)).toEqual([1000, 500])
})
it('يرفض تاريخ ماكينة سابق بلا مستند أو معاملة أو قيد', () => {
 expect(() => S().receiveClientAdvance({ projectId: S().projects[0].id, amountMinor: 1000, treasury: '1101', date: '2026-11-04', terminalPayment: { terminalId: 't', providerReference: 'ref' } })).toThrow(/الماكينة/)
 expect(S().clientAdvances).toHaveLength(0); expect(S().paymentTerminalTransactions).toHaveLength(0); expect(S().journal).toHaveLength(0)
})
it('يرفض الخزينة غير الموجودة وصلاحية المستخدم المسحوبة', () => {
 expect(() => S().receiveClientAdvance({ projectId: S().projects[0].id, amountMinor: 1000, treasury: '4101' })).toThrow(/الخزينة/)
 useRawDataStore.setState({ currentUserId: 999 })
 expect(() => receive()).toThrow(/صلاحية/); expect(S().journal).toHaveLength(0)
})
it('يفرض اختيار الفرع الصحيح ولا يسمح بخزينة فرع آخر', () => {
 const p = S().projects[0]
 const branches = [{ id: 1, nameAr: 'رئيسي', isMain: true, warehouseId: 1, treasuryCode: '1101', active: true }, { id: 2, nameAr: 'ثان', isMain: false, warehouseId: 2, treasuryCode: '1102', active: true }]
 useRawDataStore.setState({ branches: branches as never, activeBranchId: null, projects: [{ ...p, branchId: 1 }] as never, treasuries: [{ code: '1101', nameAr: 'رئيسي', kind: 'cash' }, { code: '1102', nameAr: 'فرعي', kind: 'bank', branchId: 2 }] })
 expect(() => receive()).toThrow(/اختر الفرع/)
 useRawDataStore.setState({ activeBranchId: 1 })
 expect(() => S().receiveClientAdvance({ projectId: p.id, amountMinor: 1000, treasury: '1102' })).toThrow(/الفرع/)
 expect(S().journal).toHaveLength(0)
})
it('يحترم السنة المقفلة للفرع المنفذ لا الفترة المقفلة للفرع الآخر', () => {
 const p = S().projects[0]
 const branches = [{ id: 1, nameAr: 'رئيسي', isMain: true, warehouseId: 1, treasuryCode: '1101', active: true }, { id: 2, nameAr: 'ثان', isMain: false, warehouseId: 2, treasuryCode: '1102', active: true }]
 useRawDataStore.setState({ branches: branches as never, activeBranchId: 2, projects: [{ ...p, branchId: 2 }] as never, treasuries: [{ code: '1101', nameAr: 'رئيسي', kind: 'cash', branchId: 1 }, { code: '1102', nameAr: 'فرعي', kind: 'bank', branchId: 2 }] })
 useAppStore.setState({ fiscalYears: [{ id: 1, branchId: 1, nameAr: 'الرئيسي', startDate: '2026-01-01', endDate: '2026-12-31', status: 'closed' }, { id: 3, branchId: 2, nameAr: 'الفرعي المفتوح', startDate: '2026-01-01', endDate: '2026-12-31', status: 'open' }] })
 S().receiveClientAdvance({ projectId: p.id, amountMinor: 1000, treasury: '1102', date: '2026-11-04' })
 expect(S().journal[0]).toMatchObject({ date: '2026-11-04', branchId: 2 })
 useAppStore.setState({ fiscalYears: [{ id: 2, branchId: 2, nameAr: 'الفرعي', startDate: '2026-01-01', endDate: '2026-12-31', status: 'closed' }] })
 expect(() => S().receiveClientAdvance({ projectId: p.id, amountMinor: 1000, treasury: '1102', date: '2026-11-05' })).toThrow(/مقفلة/)
 expect(S().journal).toHaveLength(1)
})
