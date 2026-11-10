import { afterEach, beforeEach, expect, it } from 'vitest'
import { EMPTY_EXTENDED, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import type { ApprovalAction } from '../src/core/projectOps.ts'
const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
 const setup = { ...app.setup, completed: true, countryCode: 'EG', activityId: 'contracting' as const, modules: ['contracting'] as never, allowNegativeTreasury: true }
 useAppStore.setState({ ...app, setup, companySetup: setup, fiscalYears: [] })
 useRawDataStore.setState({ ...original, branches: [], activeBranchId: null, currentUserId: null, customers: [], projects: [], boqItems: [], projectSurveys: [], projectExtracts: [], projectCosts: [], clientAdvances: [], journal: [], approvalFlows: [], approvalRequests: [], changeOrders: [], subContracts: [], subCertificates: [], subAdvances: [], employees: [], items: [], warehouses: [], serials: [], batches: [], materialRequisitions: [], stockMoves: [], transfers: [], purchases: [], sales: [], saleReturns: [], purchaseReturns: [], productionOrders: [], processingOrders: [] } as never)
})
afterEach(() => { useRawDataStore.setState(original); useAppStore.setState(app) })
function project() {
 S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل', phone: '', creditLimitMinor: 0, notes: '' })
 return S().addProject({ nameAr: 'مشروع', clientName: 'عميل', clientId: S().customers[0].id, contractValueMinor: 100000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
}
function approval(action: ApprovalAction, refId: number) {
 S().setApprovalFlow(action, [{ roleAr: 'مدير', employeeId: null }], true)
 const req = S().requestApproval(action, 'اعتماد', refId)
 S().decideApproval(req.id, 'approved', 'المالك')
 return req.id
}
const consumed = (id: number) => S().approvalRequests.find(r => r.id === id)?.consumedAt
it('رفض مستخلص بعد فحص الاعتماد لا يستهلكه؛ النجاح ينشرهما معاً', () => {
 const p = project(), id = approval('project_extract', p.id)
 const before = S(); expect(() => S().addProjectExtract({ projectId: p.id, grossMinor: 100001, vatPercent: 0, payment: 'credit', description: 'أعمال' })).toThrow(/يتجاوز|العقد/)
 expect(S()).toBe(before); expect(consumed(id)).toBeNull()
 let states = 0
 const unsubscribe = useRawDataStore.subscribe(s => { states++; expect(s.projectExtracts).toHaveLength(1); expect(s.approvalRequests.find(r => r.id === id)?.consumedAt).toBeTruthy(); expect(s.journal).toHaveLength(1) })
 S().addProjectExtract({ projectId: p.id, grossMinor: 50000, vatPercent: 0, payment: 'credit', description: 'أعمال' }); unsubscribe()
 expect(states).toBe(1); expect(consumed(id)).toBeTruthy()
})
it('فشل تعديل المستخلص بعد فحص الاعتماد لا يستهلكه ولا يعكس القيد', () => {
 const p = project(), ex = S().addProjectExtract({ projectId: p.id, grossMinor: 50000, vatPercent: 0, payment: 'credit', description: 'أعمال' })
 const id = approval('project_extract', p.id), before = S()
 expect(() => S().editProjectExtract({ extractId: ex.id, grossMinor: 100001, vatPercent: 0, payment: 'credit', description: 'تعديل', reason: 'تصحيح' })).toThrow(/يتجاوز|العقد/)
 expect(S()).toBe(before); expect(consumed(id)).toBeNull()
 S().editProjectExtract({ extractId: ex.id, grossMinor: 60000, vatPercent: 0, payment: 'credit', description: 'تعديل', reason: 'تصحيح' }); expect(consumed(id)).toBeTruthy()
})
it('شهادة باطن تتجاوز العقد لا تستهلك الموافقة', () => {
 const p = project()
 const c = S().addSubContract({ projectId: p.id, contractorName: 'مقاول', scopeAr: 'أعمال', contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-01-01', notes: '' } as never)
 const id = approval('sub_certificate', c.id), before = S()
 expect(() => S().addSubCertificate({ contractId: c.id, amountMinor: 10001, description: 'أعمال' })).toThrow(/تتجاوز/)
 expect(S()).toBe(before); expect(consumed(id)).toBeNull()
 S().addSubCertificate({ contractId: c.id, amountMinor: 5000, description: 'أعمال' }); expect(consumed(id)).toBeTruthy(); expect(S().subCertificates).toHaveLength(1)
})
it('إذن بتكلفة صفرية لا يستهلك الاعتماد عند رفض القيد', () => {
 const p = project()
 S().addEmployee({ nameAr: 'الصارف', phone: '', roleId: 'cashier', salaryMinor: 0, active: true } as never)
 S().addEmployee({ nameAr: 'المستلم', phone: '', roleId: 'cashier', salaryMinor: 0, active: true } as never)
 S().addItem({ nameAr: 'صنف', sku: '', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 0, stockQty: 3, priceMinor: 100, minQty: 0, isActive: true } as never)
 const id = approval('material_requisition', p.id), before = S()
 const args = { projectId: p.id, issuedByEmployeeId: S().employees[0].id, receivedByEmployeeId: S().employees[1].id, lines: [{ itemId: S().items[0].id, qty: 1, unitAr: '' }], notes: '' }
 expect(() => S().issueMaterials(args)).toThrow(/تكلفة/); expect(S()).toBe(before); expect(consumed(id)).toBeNull()
})
it('لا يُستهلك اعتماد فرع آخر ولا يُبتّ فيه من الفرع الحالي', () => {
 const p = project()
 const branches = [{ id: 1, nameAr: 'الرئيسي', isMain: true, warehouseId: 1, treasuryCode: '1101', active: true }, { id: 2, nameAr: 'الثاني', isMain: false, warehouseId: 2, treasuryCode: '1102', active: true }]
 useRawDataStore.setState({ branches: branches as never, activeBranchId: 1, projects: S().projects.map(row => ({ ...row, branchId: 1 })) as never,
  approvalFlows: [{ id: 1, action: 'project_extract', active: true, branchId: 1, steps: [{ order: 1, roleAr: 'مدير', employeeId: null }] }] as never,
  approvalRequests: [{ id: 1, action: 'project_extract', refId: p.id, status: 'approved', consumedAt: null, branchId: 2, decisions: [] }] as never })
 const before = S()
 expect(() => S().addProjectExtract({ projectId: p.id, grossMinor: 1000, vatPercent: 0, payment: 'credit', description: 'أعمال' })).toThrow(/اعتماد/)
 expect(() => S().decideApproval(1, 'approved', 'المالك')).toThrow(/الفرع/)
 expect(S()).toBe(before); expect(consumed(1)).toBeNull()
})
it('لا يستخدم مسار موافقة ملتبس في نطاق كل الفروع أو المسارات المكررة', () => {
 const p = project()
 const branches = [{ id: 1, nameAr: 'الرئيسي', isMain: true, warehouseId: 1, treasuryCode: '1101', active: true }, { id: 2, nameAr: 'الثاني', isMain: false, warehouseId: 2, treasuryCode: '1102', active: true }]
 const flows = [{ id: 1, action: 'project_extract', active: true, branchId: 1, steps: [{ order: 1, roleAr: 'مدير', employeeId: null }] }, { id: 2, action: 'project_extract', active: true, branchId: 1, steps: [{ order: 1, roleAr: 'مدير', employeeId: null }] }]
 useRawDataStore.setState({ branches: branches as never, activeBranchId: null, projects: S().projects.map(row => ({ ...row, branchId: 1 })) as never, approvalFlows: flows as never })
 const args = { projectId: p.id, grossMinor: 1000, vatPercent: 0, payment: 'credit' as const, description: 'أعمال' }
 expect(() => S().addProjectExtract(args)).toThrow(/الفرع/)
 useRawDataStore.setState({ activeBranchId: 1 }); const before = S()
 expect(() => S().addProjectExtract(args)).toThrow(/غير فريد/); expect(S()).toBe(before)
})
it('تعديل مسار قائم يحفظ ملكيته ولا ينقله للفرع الرئيسي', () => {
 const branches = [{ id: 1, nameAr: 'الرئيسي', isMain: true, warehouseId: 1, treasuryCode: '1101', active: true }, { id: 2, nameAr: 'الثاني', isMain: false, warehouseId: 2, treasuryCode: '1102', active: true }]
 useRawDataStore.setState({ branches: branches as never, activeBranchId: 2, approvalFlows: [{ id: 1, action: 'project_extract', active: true, branchId: 2, steps: [{ order: 1, roleAr: 'مدير', employeeId: null }] }] as never })
 S().setApprovalFlow('project_extract', [{ roleAr: 'محاسب', employeeId: null }], true, 100)
 expect(S().approvalFlows[0]).toMatchObject({ id: 1, branchId: 2, thresholdMinor: 100 })
})
it('تحويل العرض ينشر المشروع والبنود واستهلاك الاعتماد في لقطة واحدة', () => {
 S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل', phone: '', creditLimitMinor: 0, notes: '' })
 const quote = S().addQuotation({ kind: 'quotation', clientName: 'عميل', clientId: S().customers[0].id, titleAr: 'عرض', validUntil: '2027-01-01', lines: [{ descriptionAr: 'أعمال', qty: 1, unitAr: 'م', unitPriceMinor: 1000, vatPercent: 0 }], notes: '' })
 S().setQuotationStatus(quote.id, 'submitted'); S().setQuotationStatus(quote.id, 'won')
 const id = approval('quotation_to_project', quote.id)
 let snapshots = 0
 const unsubscribe = useRawDataStore.subscribe(s => { snapshots++; expect(s.projects).toHaveLength(1); expect(s.boqItems).toHaveLength(1); expect(s.quotations[0].projectId).toBe(s.projects[0].id); expect(s.approvalRequests.find(r => r.id === id)?.consumedAt).toBeTruthy() })
 S().convertQuotationToProject(quote.id, 0); unsubscribe(); expect(snapshots).toBe(1)
})
