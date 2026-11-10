import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
const project = { id: 1, code: 'P-1', nameAr: 'مشروع', clientName: 'عميل', clientId: null, contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-01-01', status: 'active', notes: '' }
const item = { id: 5, nameAr: 'صنف', sku: 'X', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [{ nameAr: 'علبة', factor: 2 }], costMinor: 33, stockValueMinor: 100, stockQty: 3, priceMinor: 200, minQty: 0, isActive: true }
const employees = [{ id: 10, nameAr: 'الصارف', active: true }, { id: 11, nameAr: 'المستلم', active: true }]
const base = { projectId: 1, issuedByEmployeeId: 10, receivedByEmployeeId: 11, lines: [{ itemId: 5, qty: 1, unitAr: '' }], notes: '' }
beforeEach(() => {
 vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 5, 12))
 const setup = { ...app.setup, completed: true, activityId: 'contracting' as const, countryCode: 'EG', modules: ['contracting'] as never }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
 useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: null, branches: [], warehouses: [{ id: 1, nameAr: 'رئيسي', isMain: true }, { id: 2, nameAr: 'ثان', isMain: false }], items: [item], projects: [project], employees, transfers: [], purchases: [], sales: [], saleReturns: [], purchaseReturns: [], productionOrders: [], processingOrders: [], serials: [], batches: [], journal: [], projectCosts: [], materialRequisitions: [], stockMoves: [], approvalFlows: [], approvalRequests: [] } as never)
})
afterEach(() => { useRawDataStore.setState(original); useAppStore.setState(app); vi.useRealTimers() })
it('الوحدات والسطور المتكررة تستنفد القيمة الدقيقة بلا فرق في القيد أو تكلفة المشروع أو حركة الصنف', () => {
 const doc = S().issueMaterials({ ...base, date: '2026-11-05', lines: [{ itemId: 5, qty: 1, unitAr: 'علبة' }, { itemId: 5, qty: 1, unitAr: '' }] })
 expect(doc.lines.map(l => l.baseQty)).toEqual([2, 1]); expect(doc.lines.map(l => l.costMinor)).toEqual([67, 33]); expect(doc.totalCostMinor).toBe(100)
 expect(S().journal[0]).toMatchObject({ date: '2026-11-05', createdAt: expect.stringContaining('2026-11-05'), sourceType: 'material_issue', sourceId: doc.id })
 expect(S().journal[0].lines.map(l => [l.accountCode, l.debit, l.credit])).toEqual([['5110', 100, 0], ['1103', 0, 100]])
 expect(S().projectCosts[0]).toMatchObject({ date: '2026-11-05', amountMinor: 100, journalEntryId: doc.journalEntryId })
 expect(S().items[0]).toMatchObject({ stockQty: 0, stockValueMinor: 0 }); expect(S().stockMoves.map(m => m.balanceAfter)).toEqual([1, 0])
})
it('تطابق قيمة الصرف الجزئي المتبقية مع آخر عملية', () => {
 const first = S().issueMaterials(base); const second = S().issueMaterials({ ...base, lines: [{ itemId: 5, qty: 2, unitAr: '' }] })
 expect([first.totalCostMinor, second.totalCostMinor]).toEqual([33, 67]); expect(S().items[0].stockValueMinor).toBe(0)
})
it.each(['', '2026-02-30', '2026-11-04', '2026-11-06', '2026-11-05T12:00:00Z'])('يرفض التاريخ %s بلا أثر', date => {
 const before = S(); expect(() => S().issueMaterials({ ...base, date })).toThrow(/تاريخ/); expect(S()).toBe(before)
})
it.each([0, -1, NaN, Infinity, 0.0001, 1.0001, 4])('يرفض كمية غير صالحة %s بلا أثر', qty => {
 const before = S(); expect(() => S().issueMaterials({ ...base, lines: [{ itemId: 5, qty, unitAr: '' }] })).toThrow(); expect(S()).toBe(before)
})
it('يرفض معاملات وحدة غير سليمة أو تحويل كمية فاقد الدقة', () => {
 useRawDataStore.setState({ items: [{ ...item, extraUnits: [{ nameAr: 'وحدة', factor: 0 }] }] as never })
 const args = { ...base, lines: [{ itemId: 5, qty: 1, unitAr: 'وحدة' }] }; let before = S()
 expect(() => S().issueMaterials(args)).toThrow(/معامل/); expect(S()).toBe(before)
 useRawDataStore.setState({ items: [{ ...item, extraUnits: [{ nameAr: 'وحدة', factor: 0.3333 }] }] as never }); before = S()
 expect(() => S().issueMaterials(args)).toThrow(/دقيقة/); expect(S()).toBe(before)
})
it('يرفض السنة المقفلة والتاريخ السابق لبداية المشروع والصلاحية المفقودة', () => {
 useAppStore.setState({ fiscalYears: [{ id: 1, nameAr: 'مقفلة', startDate: '2026-01-01', endDate: '2026-12-31', status: 'closed' }] })
 let before = S(); expect(() => S().issueMaterials(base)).toThrow(/مقفلة/); expect(S()).toBe(before)
 useAppStore.setState({ fiscalYears: [] }); useRawDataStore.setState({ projects: [{ ...project, startDate: '2026-11-06' }] as never }); before = S()
 expect(() => S().issueMaterials(base)).toThrow(/تاريخ المشروع/); expect(S()).toBe(before)
 useRawDataStore.setState({ projects: [project] as never, currentUserId: 999 }); before = S()
 expect(() => S().issueMaterials(base)).toThrow(/صلاحية/); expect(S()).toBe(before)
})
it('لا يصرف مخزناً آخر ويسجل دفعات المخزن الأساسي فقط', () => {
 useRawDataStore.setState({ transfers: [{ fromWarehouseId: 1, toWarehouseId: 2, lines: [{ itemId: 5, qty: 2 }] }] as never })
 let before = S(); expect(() => S().issueMaterials({ ...base, lines: [{ itemId: 5, qty: 2, unitAr: '' }] })).toThrow(/المخزن/); expect(S()).toBe(before)
 useRawDataStore.setState({ transfers: [], items: [{ ...item, trackExpiry: true }] as never, batches: [{ id: 10, itemId: 5, warehouseId: 1, expiryDate: '2026-10-01', qty: 1, purchaseId: null, receivedAt: '2026-01-01' }, { id: 11, itemId: 5, warehouseId: 2, expiryDate: '2026-09-01', qty: 2, purchaseId: null, receivedAt: '2026-01-01' }] })
 const doc = S().issueMaterials(base); expect(doc.batchAllocations).toEqual([{ itemId: 5, batchId: 10, qty: 1 }]); expect(S().batches.map(b => b.qty)).toEqual([0, 2])
 before = S(); expect(() => S().issueMaterials(base)).toThrow(/دفعات/); expect(S()).toBe(before)
})
it('يحجب السيريال والموظف غير النشط ولا يترك أثراً', () => {
 useRawDataStore.setState({ items: [{ ...item, trackSerial: true }] as never }); let before = S()
 expect(() => S().issueMaterials(base)).toThrow(/السيريال/); expect(S()).toBe(before)
 useRawDataStore.setState({ items: [item] as never, employees: [employees[0], { ...employees[1], active: false }] as never }); before = S()
 expect(() => S().issueMaterials(base)).toThrow(/المستلم/); expect(S()).toBe(before)
})
it('يرفض مشروعاً أو موظفاً من فرع آخر حتى لو كان المعرّف موجوداً', () => {
 const branches = [{ id: 1, nameAr: 'رئيسي', isMain: true, active: true, warehouseId: 1, treasuryCode: '1101' }, { id: 2, nameAr: 'آخر', isMain: false, active: true, warehouseId: 2, treasuryCode: '1121' }]
 useRawDataStore.setState({ branches: branches as never, activeBranchId: 1, projects: [{ ...project, branchId: 2 }] as never })
 let before = S(); expect(() => S().issueMaterials(base)).toThrow(/المشروع/); expect(S()).toBe(before)
 useRawDataStore.setState({ projects: [{ ...project, branchId: 1 }] as never, employees: [{ ...employees[0], branchId: 2 }, { ...employees[1], branchId: 1 }] as never }); before = S()
 expect(() => S().issueMaterials(base)).toThrow(/الصارف/); expect(S()).toBe(before)
})
it('رفض متأخر لا يستهلك الاعتماد وتُسجل جميع الآثار مع استهلاكه دفعة واحدة', () => {
 S().setApprovalFlow('material_requisition', [{ roleAr: 'مدير', employeeId: null }], true)
 const approval = S().requestApproval('material_requisition', 'صرف', 1); S().decideApproval(approval.id, 'approved', 'المالك')
 useRawDataStore.setState({ items: [{ ...item, costMinor: 0, stockValueMinor: 0 }] as never }); const before = S()
 expect(() => S().issueMaterials(base)).toThrow(/تكلفة/); expect(S()).toBe(before); expect(S().approvalRequests[0].consumedAt).toBeNull()
 useRawDataStore.setState({ items: [item] as never }); let updates = 0
 const unsubscribe = useRawDataStore.subscribe(s => { updates++; expect(s.approvalRequests[0].consumedAt).toBeTruthy(); expect(s.materialRequisitions).toHaveLength(1); expect(s.journal).toHaveLength(1); expect(s.projectCosts).toHaveLength(1) })
 S().issueMaterials(base); unsubscribe(); expect(updates).toBe(1)
})
