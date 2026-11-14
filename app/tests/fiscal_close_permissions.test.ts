import { afterEach, beforeEach, expect, it } from 'vitest'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import type { FiscalYear } from '../src/core/fiscal.ts'

const original = useRawDataStore.getState(), app = useAppStore.getState()
const year: FiscalYear = { id: 12, branchId: 1, nameAr: '2024', startDate: '2024-01-01', endDate: '2024-12-31', status: 'open' }
const branches = [{ id: 1, nameAr: 'الرئيسي', isMain: true, warehouseId: 1, treasuryCode: '1101', active: true }, { id: 2, nameAr: 'الفرع الثاني', isMain: false, warehouseId: 2, treasuryCode: '1102', active: true }]
const user = (roleId: string, branchId: number | undefined = 1, active = true) => ({ id: 1, nameAr: 'المستخدم', roleId, branchId, active, pinHash: '' })
const S = () => useRawDataStore.getState()
beforeEach(() => {
 useAppStore.setState({ ...app, fiscalYears: [year] })
 useRawDataStore.setState({ ...original, loggedOut: false, currentUserId: 1, appUsers: [user('cashier')], branches, activeBranchId: 1, roleOverrides: {}, branchRoleOverrides: {}, customRoles: [], journal: [{ id: 1, entryNumber: 1, branchId: 1, date: '2024-06-01', description: 'إيراد', sourceType: 'manual', sourceId: null, lines: [{ accountCode: '1101', debit: 10000, credit: 0 }, { accountCode: '4101', debit: 0, credit: 10000 }], createdAt: '2024-06-01', createdBy: 'محاسب' }] } as never)
})
afterEach(() => { useRawDataStore.setState(original); useAppStore.setState(app) })

it('يرفض من لا يملك صلاحية الإقفال أو إعادة الفتح في المستودع دون آثار', () => {
 const journal = S().journal
 expect(() => S().closeFiscalYear(year, [year])).toThrow(/صلاحية/)
 expect(S().journal).toBe(journal); expect(useAppStore.getState().fiscalYears[0].status).toBe('open')
 const closed = { ...year, status: 'closed' as const }
 expect(() => S().reopenFiscalYear(closed, [closed])).toThrow(/صلاحية/)
 expect(S().journal).toBe(journal)
})
it('يتحقق من الصلاحية الحالية عند إعادة الفتح حتى لو أقفلها المستخدم سابقاً', () => {
 useRawDataStore.setState({ appUsers: [user('accountant')] })
 S().closeFiscalYear(year, [year])
 const closed = useAppStore.getState().fiscalYears[0], journal = S().journal
 expect(closed.status).toBe('closed')
 useRawDataStore.setState({ branchRoleOverrides: { 1: { accountant: [] } } })
 expect(() => S().reopenFiscalYear(closed, [closed])).toThrow(/صلاحية/)
 expect(S().journal).toBe(journal); expect(useAppStore.getState().fiscalYears[0].status).toBe('closed')
})
it('يرفض الحساب المعطل أو الفرع غير النشط أو جلسة الخروج قبل أي تغيير', () => {
 useRawDataStore.setState({ appUsers: [user('accountant', 1, false)] })
 expect(() => S().closeFiscalYear(year, [year])).toThrow(/صلاحية/)
 useRawDataStore.setState({ appUsers: [user('accountant', 99)] })
 expect(() => S().closeFiscalYear(year, [year])).toThrow(/فرع/)
 useRawDataStore.setState({ loggedOut: true, currentUserId: null })
 expect(() => S().closeFiscalYear(year, [year])).toThrow(/سجل الدخول/)
 expect(S().journal).toHaveLength(1); expect(useAppStore.getState().fiscalYears[0].status).toBe('open')
})
it('لا تسمح صلاحية فرع المحاسب بإقفال سنة فرع مختلف', () => {
 useRawDataStore.setState({ appUsers: [user('accountant', 1)] })
 const other = { ...year, id: 13, branchId: 2 }
 expect(() => S().closeFiscalYear(other, [year, other])).toThrow(/فرعاً آخر/)
})
