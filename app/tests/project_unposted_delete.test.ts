import { afterEach, beforeEach, expect, it } from 'vitest'
import { useRawDataStore, useDataStore, EMPTY_EXTENDED } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const pinHash = 'dd963634ae8f2839313302f03077c41b6de321c73056d69b1f34334c193c425e'
const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
 useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG', activityId: 'contracting', modules: ['contracting'] } as never })
 useRawDataStore.setState({ ...original, branches: [], activeBranchId: null, currentUserId: null, ownerPinHash: pinHash, customers: [], projects: [], projectExtracts: [], boqItems: [], projectBudgets: [], projectTasks: [], changeOrders: [], quotations: [], clientAdvances: [], projectCosts: [], journal: [], staffCommissions: [], vouchers: [], auditLog: [], projectDeletionRecords: [] } as never)
})
afterEach(() => { useRawDataStore.setState(original); useAppStore.setState(app) })
function setup() {
 S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'المالك', phone: '', creditLimitMinor: 0, notes: '' })
 const customer = S().customers.at(-1)!
 const project = S().addProject({ nameAr: 'مشروع ملغى', clientName: customer.nameAr, clientId: customer.id, contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
 const boq = S().addBoqItem({ projectId: project.id, code: '1', descriptionAr: 'عمل', unit: 'م', qty: 100, unitPriceMinor: 100 })
 return { project, boq }
}
it('يحذف المشروع غير المرحّل وبنوده دفعة واحدة ويسجل الحذف ولا يعيد استعمال رقمه', async () => {
 const { project } = setup()
 let observed = 0
 const unsub = useRawDataStore.subscribe(s => { if (!s.projects.some(p => p.id === project.id)) { observed++; expect(s.boqItems.some(b => b.projectId === project.id)).toBe(false) } })
 await S().deleteUnpostedProject(project.id, 'إلغاء العميل', undefined, '123456')
 unsub()
 expect(observed).toBe(1)
 expect(S().projectDeletionRecords.at(-1)).toMatchObject({ id: project.id, code: project.code, reason: 'إلغاء العميل' })
 expect(S().journal).toHaveLength(0)
 const next = S().addProject({ nameAr: 'جديد', clientName: '', contractValueMinor: 100, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
 expect(next.id).toBeGreaterThan(project.id)
})
it('لا يحذف مشروعاً عليه مستخلص مرحل ولا يغير الدفتر أو المشروع', async () => {
 const { project, boq } = setup()
 S().addProjectExtract({ projectId: project.id, description: 'أعمال', payment: 'credit', vatPercent: 0, extractQtyLines: [{ boqItemId: boq.id, cumulativeQty: 20 }] })
 const before = S()
 await expect(S().deleteUnpostedProject(project.id, 'إلغاء', undefined, '123456')).rejects.toThrow(/مرحّل|مرتبط/)
 expect(S().projects).toBe(before.projects)
 expect(S().journal).toBe(before.journal)
 expect(S().projectExtracts).toBe(before.projectExtracts)
})
it('لا يحذف مشروعاً له مرجع متداخل في مسودة أو له دفعة مقدمة', async () => {
 const { project } = setup()
 useRawDataStore.setState({ advancedInvoiceDrafts: [{ id: '1', kind: 'sale', name: '', payload: JSON.stringify({ projectId: project.id }), createdAt: '', updatedAt: '' }] })
 await expect(S().deleteUnpostedProject(project.id, 'إلغاء', undefined, '123456')).rejects.toThrow(/مرتبط/)
 useRawDataStore.setState({ advancedInvoiceDrafts: [] })
 S().receiveClientAdvance({ projectId: project.id, amountMinor: 100, treasury: '1101' })
 await expect(S().deleteUnpostedProject(project.id, 'إلغاء', undefined, '123456')).rejects.toThrow(/مرتبط/)
})
it('يرفض الحذف بلا سبب أو صلاحية ولا يتجاوز الفرع', async () => {
 const { project } = setup()
 await expect(S().deleteUnpostedProject(project.id, '', undefined, '123456')).rejects.toThrow(/سبب/)
 useRawDataStore.setState({ currentUserId: 20, appUsers: [{ id: 20, nameAr: 'موظف', roleId: 'cashier', active: true, pinHash: '' }] })
 await expect(useRawDataStore.getState().deleteUnpostedProject(project.id, 'إلغاء', undefined, '123456')).rejects.toThrow(/صلاحية/)
 expect(useDataStore.getState().projects).toHaveLength(1)
})
it('يعزل الحذف وسجل أرقامه على الفرع النشط', async () => {
 const { project } = setup()
 const branches = [{ id: 1, nameAr: 'رئيسي', isMain: true, warehouseId: 1, treasuryCode: '1101', active: true }, { id: 2, nameAr: 'ثان', isMain: false, warehouseId: 2, treasuryCode: '1102', active: true }]
 useRawDataStore.setState({ branches, activeBranchId: 1, projects: S().projects.map(p => ({ ...p, branchId: 2 })), boqItems: S().boqItems.map(b => ({ ...b, branchId: 2 })) })
 await expect(S().deleteUnpostedProject(project.id, 'إلغاء', undefined, '123456')).rejects.toThrow(/الفرع/)
 useRawDataStore.setState({ activeBranchId: 2 })
 await S().deleteUnpostedProject(project.id, 'إلغاء العميل', undefined, '123456')
 expect(S().projectDeletionRecords[0].branchId).toBe(2)
 useRawDataStore.setState({ activeBranchId: 1 })
 expect(useDataStore.getState().projectDeletionRecords).toEqual([])
})
it('يمنع حذف مشروع له قيد دفعة مقدمة يتيم أو بند مربوط بعقد آخر', async () => {
 const { project, boq } = setup()
 useRawDataStore.setState({ subContracts: [{ id: 8, projectId: 999, boqItemIds: [boq.id] }] as never })
 await expect(S().deleteUnpostedProject(project.id, 'إلغاء', undefined, '123456')).rejects.toThrow(/مرتبطة/)
 useRawDataStore.setState({ subContracts: [], journal: [{ id: 1, sourceType: 'client_advance', sourceId: project.id, lines: [] }] as never })
 await expect(S().deleteUnpostedProject(project.id, 'إلغاء', undefined, '123456')).rejects.toThrow(/قيد دفعة/)
})
it('حذف المشروع غير المرحّل يزيل العرض المرتبط ويحفظ رقمه ولا يغيّر القيود', async () => {
 const { project } = setup()
 S().addQuotation({ kind: 'quotation', clientName: project.clientName, clientId: project.clientId, titleAr: 'عرض', validUntil: '2027-01-01', lines: [{ nameAr: '', descriptionAr: 'عمل', qty: 1, unitAr: 'م', unitPriceMinor: 100, estCostMinor: 0 }], notes: '', winProbability: 50, bidBondMinor: 0 })
 const quote = S().quotations[0]
 useRawDataStore.setState({ quotations: [{ ...quote, projectId: project.id }] })
 const beforeJournal = S().journal
 await S().deleteUnpostedProject(project.id, 'إلغاء العميل', undefined, '123456')
 expect(useDataStore.getState().quotations).toHaveLength(0)
 expect(S().quotations).toHaveLength(0)
 expect(S().quotationDeletionRecords[0]).toMatchObject({ projectId: project.id, quoteNumber: quote.quoteNumber })
 expect(S().journal).toBe(beforeJournal)
})

it.each(['approved', 'rejected', 'invoiced'] as const)('لا يمحو أمر تغيير محسوم %s عند حذف مشروع غير مرحل', async status => {
 const { project } = setup()
 const order = S().addChangeOrder({ projectId: project.id, titleAr: 'أعمال إضافية', amountMinor: 100 })
 S().setChangeOrderStatus(order.id, status === 'invoiced' ? 'approved' : status)
 if (status === 'invoiced') S().setChangeOrderStatus(order.id, 'invoiced')
 const before = S()
 await expect(S().deleteUnpostedProject(project.id, 'إلغاء', undefined, '123456')).rejects.toThrow(/أمر تغيير محسوم/)
 expect(S().projects).toBe(before.projects)
 expect(S().changeOrders).toBe(before.changeOrders)
 expect(S().journal).toBe(before.journal)
})
it('يسمح بحذف أمر تغيير مسودة مع المشروع غير المرحل', async () => {
 const { project } = setup()
 S().addChangeOrder({ projectId: project.id, titleAr: 'مسودة', amountMinor: 100 })
 await S().deleteUnpostedProject(project.id, 'إلغاء', undefined, '123456')
 expect(S().changeOrders).toHaveLength(0)
 expect(S().projectDeletionRecords).toHaveLength(1)
})
it('يرفض حذف بند موسوم بفرع آخر في عرض كل الفروع', async () => {
 const { project } = setup()
 const branches = [{ id: 1, nameAr: 'رئيسي', isMain: true, warehouseId: 1, treasuryCode: '1101', active: true }, { id: 2, nameAr: 'ثان', isMain: false, warehouseId: 2, treasuryCode: '1102', active: true }]
 useRawDataStore.setState({ branches: branches as never, activeBranchId: null, projects: S().projects.map(p => ({ ...p, branchId: 1 })) as never, boqItems: S().boqItems.map(b => ({ ...b, branchId: 2 })) as never })
 const before = S()
 await expect(S().deleteUnpostedProject(project.id, 'إلغاء', undefined, '123456')).rejects.toThrow(/فرع آخر/)
 expect(S().projects).toBe(before.projects); expect(S().boqItems).toBe(before.boqItems)
})
it('يطلب رقم المالك نفسه ولا يقبل غيابه أو رقماً آخر', async () => {
 const { project } = setup()
 useRawDataStore.setState({ ownerPinHash: null })
 await expect(S().deleteUnpostedProject(project.id, 'إلغاء', undefined, '123456')).rejects.toThrow(/تعيين/)
 useRawDataStore.setState({ ownerPinHash: pinHash })
 await expect(S().deleteUnpostedProject(project.id, 'إلغاء', undefined, '999999')).rejects.toThrow(/غير صحيح/)
 expect(S().projects).toHaveLength(1)
 expect(S().loginGuard.failures).toBeGreaterThan(0)
 await S().deleteUnpostedProject(project.id, 'إلغاء', undefined, '123456')
 expect(S().projects).toHaveLength(0)
})
it('يرفض تبدل المستخدم أو الفرع أثناء التحقق من كلمة المالك', async () => {
 const { project } = setup()
 const pending = S().deleteUnpostedProject(project.id, 'إلغاء', undefined, '123456')
 useRawDataStore.setState({ activeBranchId: 99 })
 await expect(pending).rejects.toThrow(/تغير المستخدم أو الفرع/)
 expect(S().projects).toHaveLength(1)
})
it('يقفل اعتماد المالك بعد تكرار الأرقام الخاطئة ولا يحذف بعدها بالرقم الصحيح', async () => {
 const { project } = setup()
 for (let i = 0; i < 5; i++) await expect(S().deleteUnpostedProject(project.id, 'سبب', undefined, '111111')).rejects.toThrow(/غير صحيح/)
 await expect(S().deleteUnpostedProject(project.id, 'سبب', undefined, '123456')).rejects.toThrow(/مقفول/)
 expect(S().projects).toHaveLength(1)
})
