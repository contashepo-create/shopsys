import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fiscalCloseStateRepairs, type FiscalYear } from '../src/core/fiscal.ts'
import type { JournalEntry } from '../src/core/ledger.ts'
import { useRawDataStore } from '../src/data/repo.ts'
import { guardedFiscalStateRepairs } from '../src/data/fiscalStateRepair.ts'
import { useAppStore } from '../src/stores/app.store.ts'

const initialData = useRawDataStore.getState(), initialApp = useAppStore.getState()
const year: FiscalYear = { id: 1, nameAr: '2024', branchId: 1, startDate: '2024-01-01', endDate: '2024-12-31', status: 'open' }
const branches = [
  { id: 1, nameAr: 'الرئيسي', isMain: true, active: true, warehouseId: 1, treasuryCode: '1101' },
  { id: 2, nameAr: 'الثاني', isMain: false, active: true, warehouseId: 2, treasuryCode: '1102' },
]
const activity: JournalEntry = { id: 1, entryNumber: 1, branchId: 1, date: '2024-06-01', description: 'إيراد', sourceType: 'manual', sourceId: null, lines: [{ accountCode: '1101', debit: 100, credit: 0 }, { accountCode: '4101', debit: 0, credit: 100 }], createdAt: '2024-06-01', createdBy: 'م', reversedByEntryId: null, reversesEntryId: null }
const hidden: JournalEntry = { ...activity, id: 20, entryNumber: 20, branchId: 2, sourceType: 'reversal', sourceId: 1, reversesEntryId: 1, lines: activity.lines.map(line => ({ ...line, debit: line.credit, credit: line.debit })) }
const S = () => useRawDataStore.getState()
beforeEach(() => { useAppStore.setState({ ...initialApp, fiscalYears: [year] }); useRawDataStore.setState({ ...initialData, branches, activeBranchId: 1, currentUserId: null, loggedOut: false, appUsers: [], journal: [activity] }) })
afterEach(() => { useAppStore.setState(initialApp); useRawDataStore.setState(initialData) })

describe('حماية إعادة فتح سنة عند عكس مخفي', () => {
  it('يرفض إنشاء عكس الإقفال ولا يغير الحالة عندما يدعي عكس مخفي الأصل', () => {
    S().closeFiscalYear(year, [year])
    const closed = useAppStore.getState().fiscalYears[0], ledger = [...S().journal, hidden]
    useRawDataStore.setState({ journal: ledger })
    expect(() => S().reopenFiscalYear(closed, [closed])).toThrow(/عكس خارج نطاق الفرع/)
    expect(S().journal).toBe(ledger)
    expect(useAppStore.getState().fiscalYears[0].status).toBe('closed')
  })
  it('لا يستعيد حالة الفتح عند انقطاع سابق مع وجود المطالبة المخفية', () => {
    S().closeFiscalYear(year, [year])
    const closed = useAppStore.getState().fiscalYears[0]
    S().reopenFiscalYear(closed, [closed])
    const ledger = [...S().journal, hidden]
    useRawDataStore.setState({ journal: ledger }); useAppStore.setState({ fiscalYears: [closed] })
    expect(fiscalCloseStateRepairs([closed], ledger, 1)).toEqual({ closeIds: [], reopenIds: [1] }) // الحارس القديم وحده لا يرى إسناد العكس
    expect(() => S().reopenFiscalYear(closed, [closed])).toThrow(/عكس خارج نطاق الفرع/)
    expect(S().journal).toBe(ledger)
    expect(useAppStore.getState().fiscalYears[0].status).toBe('closed')
  })
})

describe('ترشيح استعادة حالة السنة بعد التحميل', () => {
  it('يرشح الإقفال التلقائي عند مطالبة مخفية دون تعديل البيانات', () => {
    S().closeFiscalYear(year, [year])
    const ledger = [...S().journal, hidden]
    useRawDataStore.setState({ journal: ledger }); useAppStore.setState({ fiscalYears: [year] })
    const state = S()
    expect(fiscalCloseStateRepairs([year], ledger, 1)).toEqual({ closeIds: [1], reopenIds: [] })
    expect(guardedFiscalStateRepairs(state, [year])).toEqual({ closeIds: [], reopenIds: [] })
    expect(S()).toBe(state)
    expect(S().journal).toBe(ledger)
    expect(useAppStore.getState().fiscalYears[0].status).toBe('open')
  })
  it('يرشح الفتح التلقائي ويجيز الحالتين السليمتين', () => {
    S().closeFiscalYear(year, [year])
    const closed = useAppStore.getState().fiscalYears[0], closedLedger = S().journal
    expect(guardedFiscalStateRepairs(S(), [year])).toEqual({ closeIds: [1], reopenIds: [] })
    S().reopenFiscalYear(closed, [closed])
    const reopenedLedger = S().journal
    expect(guardedFiscalStateRepairs(S(), [closed])).toEqual({ closeIds: [], reopenIds: [1] })
    useRawDataStore.setState({ journal: [...reopenedLedger, hidden] })
    expect(guardedFiscalStateRepairs(S(), [closed])).toEqual({ closeIds: [], reopenIds: [] })
    useRawDataStore.setState({ journal: [...closedLedger, { ...hidden, date: '2025-01-01' }] })
    expect(guardedFiscalStateRepairs(S(), [year])).toEqual({ closeIds: [1], reopenIds: [] })
  })
  it('يرفض العكس غير المسند مجهول الأصل وتاريخ المطالبة غير المثبت', () => {
    S().closeFiscalYear(year, [year])
    const closedLedger = S().journal
    const orphan = { ...hidden, branchId: undefined, reversesEntryId: 99 }
    useRawDataStore.setState({ journal: [...closedLedger, orphan] })
    expect(guardedFiscalStateRepairs(S(), [year])).toEqual({ closeIds: [], reopenIds: [] })
    useRawDataStore.setState({ journal: [...closedLedger, { ...hidden, date: 'غير معروف' }] })
    expect(guardedFiscalStateRepairs(S(), [year])).toEqual({ closeIds: [], reopenIds: [] })
  })
  it('يفحص فرع السنة لا فرع جلسة مستخدم آخر، دون تغيير الجلسة أو إظهار دفتر آخر', () => {
    S().closeFiscalYear(year, [year])
    const ledger = [...S().journal, hidden]
    const user = { id: 7, nameAr: 'موظف الفرع الثاني', roleId: 'cashier', branchId: 2, active: true, pinHash: '' }
    useRawDataStore.setState({ journal: ledger, currentUserId: 7, activeBranchId: 2, appUsers: [user] })
    const state = S()
    expect(guardedFiscalStateRepairs(state, [year])).toEqual({ closeIds: [], reopenIds: [] })
    expect(S()).toBe(state)
    expect(S().currentUserId).toBe(7)
    expect(S().activeBranchId).toBe(2)
  })
  it('يترك سنة متضررة ويستعيد سنة مستقلة سليمة في فرع آخر', () => {
    const third = { id: 3, nameAr: 'الثالث', isMain: false, active: true, warehouseId: 3, treasuryCode: '1103' }
    const otherYear = { ...year, id: 2, branchId: 3 }
    const otherActivity = { ...activity, id: 2, entryNumber: 2, branchId: 3 }
    useAppStore.setState({ fiscalYears: [year, otherYear] })
    useRawDataStore.setState({ branches: [...branches, third], journal: [activity, otherActivity] })
    S().closeFiscalYear(year, [year, otherYear])
    useRawDataStore.setState({ activeBranchId: 3 })
    S().closeFiscalYear(otherYear, [year, otherYear])
    useRawDataStore.setState({ journal: [...S().journal, hidden] })
    expect(guardedFiscalStateRepairs(S(), [year, otherYear])).toEqual({ closeIds: [2], reopenIds: [] })
  })
  it('يتوقف عند فرع رئيسي مكرر أو فرع سنة مفقود أو معطل', () => {
    S().closeFiscalYear(year, [year])
    const state = S()
    expect(guardedFiscalStateRepairs({ ...state, branches: [branches[0], { ...branches[1], isMain: true }] }, [year])).toEqual({ closeIds: [], reopenIds: [] })
    expect(guardedFiscalStateRepairs({ ...state, branches: [branches[1], { ...branches[0], active: false }] }, [year])).toEqual({ closeIds: [], reopenIds: [] })
    expect(guardedFiscalStateRepairs({ ...state, branches: [branches[1]] }, [year])).toEqual({ closeIds: [], reopenIds: [] })
  })
})
