import { afterEach, beforeEach, expect, it } from 'vitest'
import { EMPTY_EXTENDED, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
 useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG', activityId: 'contracting', modules: ['contracting'] } as never })
 useRawDataStore.setState({ ...original, currentUserId: null, branches: [], activeBranchId: null, customers: [], projects: [], boqItems: [], projectSurveys: [], projectExtracts: [], projectExtractDrafts: [], changeOrders: [], clientAdvances: [], journal: [], vouchers: [], clientSettlements: [], approvalRequests: [] } as never)
 S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل', phone: '', creditLimitMinor: 0, notes: '' })
 const p = S().addProject({ nameAr: 'مشروع', clientName: 'عميل', clientId: S().customers[0].id, contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
 S().addBoqItem({ projectId: p.id, code: '1', descriptionAr: 'عمل', unit: 'م', qty: 100, unitPriceMinor: 100 })
})
afterEach(() => { useRawDataStore.setState(original); useAppStore.setState(app) })
it('الزيادة المعتمدة تضاف كشريحة مستقلة وتحافظ على أساس السابق وتبلغ قيمة الختامي العقد المعدل', () => {
 const p = S().projects[0], b = S().boqItems[0]
 S().addProjectExtract({ projectId: p.id, vatPercent: 0, payment: 'credit', description: 'سابق', extractQtyLines: [{ boqItemId: b.id, cumulativeQty: 20 }] })
 const order = S().addChangeOrder({ projectId: p.id, titleAr: 'زيادة', amountMinor: 2000, quantityChange: { originalBoqItemId: b.id, qty: 20 } })
 expect(S().boqItems).toHaveLength(1)
 S().setChangeOrderStatus(order.id, 'approved')
 const added = S().boqItems.find(row => row.quantityChange?.orderId === order.id)!
 expect(added).toMatchObject({ qty: 20, unitPriceMinor: 100, quantityChange: { orderId: order.id, originalBoqItemId: b.id } })
 expect(S().boqItems.find(row => row.id === b.id)?.qty).toBe(100)
 expect(() => S().setChangeOrderStatus(order.id, 'approved')).toThrow()
 expect(() => S().updateBoqItem(added.id, { qty: 30 })).toThrow(/تغيير/)
 const final = S().addProjectExtract({ projectId: p.id, vatPercent: 0, payment: 'credit', description: 'ختامي', isFinal: true, extractQtyLines: [{ boqItemId: b.id, cumulativeQty: 100 }, { boqItemId: added.id, cumulativeQty: 20 }] })
 expect(final.totals.grossMinor).toBe(10000)
 expect(S().projectExtracts.reduce((sum, row) => sum + row.totals.grossMinor, 0)).toBe(12000)
})
it('المسودة والمرفوض لا يضيفان كمية، والقيمة الخاطئة أو السالبة مرفوضة', () => {
 const p = S().projects[0], b = S().boqItems[0]
 expect(() => S().addChangeOrder({ projectId: p.id, titleAr: 'خطأ', amountMinor: 10, quantityChange: { originalBoqItemId: b.id, qty: 2 } })).toThrow(/لا تطابق/)
 expect(() => S().addChangeOrder({ projectId: p.id, titleAr: 'تخفيض', amountMinor: -200, quantityChange: { originalBoqItemId: b.id, qty: -2 } })).toThrow()
 const order = S().addChangeOrder({ projectId: p.id, titleAr: 'زيادة', amountMinor: 200, quantityChange: { originalBoqItemId: b.id, qty: 2 } })
 S().setChangeOrderStatus(order.id, 'rejected')
 expect(S().boqItems).toHaveLength(1)
})
it('يتوقف المستخلص عند العبث بشريحة الكمية أو فقد أمرها دون تغيير الدفتر', () => {
 const p = S().projects[0], b = S().boqItems[0]
 const order = S().addChangeOrder({ projectId: p.id, titleAr: 'زيادة', amountMinor: 2000, quantityChange: { originalBoqItemId: b.id, qty: 20 } })
 S().setChangeOrderStatus(order.id, 'approved')
 const child = S().boqItems.find(row => row.quantityChange)!
 useRawDataStore.setState({ boqItems: S().boqItems.map(row => row.id === child.id ? { ...row, qty: 21 } : row) })
 const before = S()
 expect(() => S().addProjectExtract({ projectId: p.id, vatPercent: 0, payment: 'credit', description: '', extractQtyLines: [{ boqItemId: b.id, cumulativeQty: 50 }] })).toThrow(/غير مطابقة/)
 expect(S().journal).toBe(before.journal)
})
it('الدمج يرفض اعتماد أمر كمية تزامن مع مستخلص أو تعديل أساس في الاتجاهين', async () => {
 const { mergeConcurrentSnapshots } = await import('../src/data/persistentStorage.ts')
 const p = S().projects[0], b = S().boqItems[0]
 const order = S().addChangeOrder({ projectId: p.id, titleAr: 'زيادة', amountMinor: 2000, quantityChange: { originalBoqItemId: b.id, qty: 20 } })
 const state = () => JSON.parse(JSON.stringify({ projects: S().projects, boqItems: S().boqItems, changeOrders: S().changeOrders, projectExtracts: S().projectExtracts, projectSurveys: S().projectSurveys, projectExtractDrafts: S().projectExtractDrafts, clientAdvances: S().clientAdvances, journal: S().journal }))
 const before = state()
 S().setChangeOrderStatus(order.id, 'approved')
 const approved = state()
 const concurrent = { ...before, projectExtracts: [{ id: 1, projectId: p.id }] }
 const wrap = (value: object) => JSON.stringify({ state: value })
 expect(() => mergeConcurrentSnapshots(wrap(before), wrap(approved), wrap(concurrent))).toThrow(/تعارض/)
 expect(() => mergeConcurrentSnapshots(wrap(before), wrap(concurrent), wrap(approved))).toThrow(/تعارض/)
 expect(JSON.parse(mergeConcurrentSnapshots(wrap(before), wrap(approved), wrap(before))).state.boqItems).toHaveLength(2)
})
it('بعد المستخلص الختامي لا يعتمد أمر جديد، ولا يخفض العقد تحت أعمال مفوترة', () => {
 const p = S().projects[0], b = S().boqItems[0]
 S().addProjectExtract({ projectId: p.id, vatPercent: 0, payment: 'credit', description: '', extractQtyLines: [{ boqItemId: b.id, cumulativeQty: 80 }] })
 const reduce = S().addChangeOrder({ projectId: p.id, titleAr: 'تخفيض', amountMinor: -3000 })
 expect(() => S().setChangeOrderStatus(reduce.id, 'approved')).toThrow(/تحت المستخلصات/)
 S().addProjectExtract({ projectId: p.id, vatPercent: 0, payment: 'credit', description: '', isFinal: true, extractQtyLines: [{ boqItemId: b.id, cumulativeQty: 100 }] })
 expect(() => S().setChangeOrderStatus(reduce.id, 'approved')).toThrow(/ختامي/)
 expect(() => S().addChangeOrder({ projectId: p.id, titleAr: 'زيادة', amountMinor: 100 })).toThrow(/ختامي/)
})
it('يرفض دمج مستخلص ختامي مع تعديل متزامن في أمر التغيير', async () => {
 const { mergeConcurrentSnapshots } = await import('../src/data/persistentStorage.ts')
 const wrap = (value: object) => JSON.stringify({ state: value })
 const base = { projects: [{ id: 1 }], boqItems: [], projectExtracts: [], changeOrders: [], sales: [], saleReturns: [] }
 const final = { ...base, projectExtracts: [{ id: 2, projectId: 1, isFinal: true }] }
 const changed = { ...base, changeOrders: [{ id: 1, projectId: 1, status: 'approved', amountMinor: 100 }] }
 expect(() => mergeConcurrentSnapshots(wrap(base), wrap(final), wrap(changed))).toThrow(/الختامي/)
 expect(() => mergeConcurrentSnapshots(wrap(base), wrap(changed), wrap(final))).toThrow(/الختامي/)
})
