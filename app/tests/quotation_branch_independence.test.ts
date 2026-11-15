import { afterEach, beforeEach, expect, it } from 'vitest'
import { useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const initial = useRawDataStore.getState(), app = useAppStore.getState()
const branches = [1, 2].map(id => ({ id, nameAr: `فرع ${id}`, isMain: id === 1, active: true, warehouseId: id, treasuryCode: id === 1 ? '1101' : '1102' }))
const args = { kind: 'quotation' as const, titleAr: 'عرض', clientName: 'عميل', clientId: 1, validUntil: '2099-01-01', lines: [{ descriptionAr: 'خدمة', qty: 1, unitAr: 'عدد', unitPriceMinor: 1000 }], notes: '' }
beforeEach(() => { const setup = { ...app.setup, activityId: 'contracting' as const, modules: ['contracting'] as typeof app.setup.modules }; useAppStore.setState({ setup, companySetup: setup }); useRawDataStore.setState({ ...initial, currentUserId: null, activeBranchId: 1, branches, quotations: [], customers: [{ id: 1, nameAr: 'عميل 1', branchId: 1 }, { id: 2, nameAr: 'عميل 2', branchId: 2 }] as never, quotationDeletionRecords: [] }) })
afterEach(() => { useRawDataStore.setState(initial); useAppStore.setState(app) })
it('يحفظ ويعيد فرع العرض ويعزل العرض عن الفرع الآخر', () => {
 const first = useRawDataStore.getState().addQuotation(args); expect(first.branchId).toBe(1)
 useRawDataStore.setState({ activeBranchId: 2 }); expect(useDataStore.getState().quotations).toHaveLength(0)
 const second = useRawDataStore.getState().addQuotation({ ...args, clientId: 2, titleAr: 'فرع ثان' }); expect(second.branchId).toBe(2)
 expect(useDataStore.getState().quotations.map(q => q.id)).toEqual([second.id])
 expect(() => useRawDataStore.getState().updateQuotation(first.id, { titleAr: 'تغيير' })).toThrow()
 useRawDataStore.setState({ activeBranchId: 1 }); expect(useDataStore.getState().quotations.map(q => q.id)).toEqual([first.id])
})
it('يطلب اختيار فرع عندما يعرض المالك كل الفروع', () => { useRawDataStore.setState({ activeBranchId: null }); expect(() => useRawDataStore.getState().addQuotation(args)).toThrow(/حدد الفرع/); expect(useRawDataStore.getState().quotations).toHaveLength(0) })
it('يستخدم نشاط الفرع الفعلي عند التحقق من صلاحية دور المقاولات حتى إذا كانت إعدادات الواجهة لم تتزامن', () => {
 const company = { ...app.setup, completed: true, activityId: 'clinic' as const, modules: ['contracting'] as typeof app.setup.modules }
 useAppStore.setState({ setup: company, companySetup: company })
 useRawDataStore.setState({ branches: [branches[0], { ...branches[1], activityId: 'contracting' }], activeBranchId: 2, currentUserId: 2, appUsers: [{ id: 2, nameAr: 'مدير', roleId: 'project_manager', active: true, pinHash: '', branchId: 2 }], roleOverrides: {}, branchRoleOverrides: {}, customRoles: [] })
 expect(useRawDataStore.getState().addQuotation({ ...args, clientId: 2 }).branchId).toBe(2)
 useRawDataStore.setState({ appUsers: [{ id: 2, nameAr: 'مدير', roleId: 'project_manager', active: true, pinHash: '', branchId: 2, deniedPerms: ['sales.quotation.manage'] }] })
 expect(() => useRawDataStore.getState().addQuotation({ ...args, clientId: 2 })).toThrow(/صلاحية/)
})
