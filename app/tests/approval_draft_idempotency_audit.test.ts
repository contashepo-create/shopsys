import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EMPTY_EXTENDED, useRawDataStore } from '../src/data/repo.ts'
import { draftFromCategory } from '../src/core/items.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const original = useRawDataStore.getState(), app = useAppStore.getState()
const S = () => useRawDataStore.getState()
const purchase = (id: string, qty = 1) => S().postPurchase({ sourceDraftId: id, supplierId: 7, date: '2026-01-01', lines: [{ itemId: 1, qty, unitPriceMinor: 1000 }], expenses: [], paidMinor: 0, notes: '' })
const sale = (id: string) => S().postSale({ sourceDraftId: id, lines: [{ itemId: 1, nameAr: 'صنف', qty: 1, unitPriceMinor: 1500, unitCostMinor: 1000, discountPercent: 0, soldByWeight: false }], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false })
beforeEach(() => {
  const setup = { ...app.setup, taxRegistrationStatus: 'registered' as const, vatPercent: 0, requireOpenShiftForSales: false }
  useAppStore.setState({ setup, companySetup: setup, approvals: { enabled: true, scope: ['purchase', 'sale'], thresholdMinor: 0, approverUserIds: [], autoApprovedUserIds: [] } })
  useRawDataStore.setState({ ...original, currentUserId: 5, appUsers: [{ id: 5, nameAr: 'موظف', roleId: 'cashier', pinHash: '0'.repeat(64), active: true, branchId: null }] as never, activeBranchId: null, branches: [], suppliers: [{ ...EMPTY_EXTENDED, id: 7, nameAr: 'مورد', phone: '', active: true }] as never, items: [{ ...draftFromCategory(undefined, 'A'), id: 1, nameAr: 'صنف', costMinor: 1000, priceMinor: 1500, stockQty: 10, isService: false }], purchases: [], sales: [], purchaseReturns: [], saleReturns: [], journal: [], docApprovals: [], warehouses: [], serials: [], batches: [], variantStocks: [] })
})
afterEach(() => { useRawDataStore.setState(original); useAppStore.setState(app) })
describe('طلب اعتماد فريد لمسودة الفاتورة', () => {
  it.each(['purchase', 'sale'] as const)('إعادة التقديم لا تنشئ طلب اعتماد ثانياً لنفس المسودة (%s)', kind => {
    const submit = () => kind === 'purchase' ? purchase('same') : sale('same')
    expect(submit).toThrow(/الاعتماد/)
    expect(submit).toThrow(/طلب.*اعتماد|الاعتماد.*مسبق/)
    expect(S().docApprovals).toHaveLength(1)
    expect(S().journal).toHaveLength(0)
  })
  it('مسودات مختلفة ونوعا البيع والشراء المستقلان لا يمنع بعضها بعضاً', () => {
    expect(() => purchase('one')).toThrow(/الاعتماد/)
    expect(() => purchase('two')).toThrow(/الاعتماد/)
    expect(() => sale('one')).toThrow(/الاعتماد/)
    expect(S().docApprovals).toHaveLength(3)
  })
  it('لا تسمح مسودة تنتظر الاعتماد بترحيل مباشر معدّل حتى بعد تعطيل الاعتمادات', () => {
    expect(() => purchase('pending', 1)).toThrow(/الاعتماد/)
    useRawDataStore.setState({ currentUserId: null })
    useAppStore.setState({ approvals: { ...useAppStore.getState().approvals, enabled: false } })
    expect(() => purchase('pending', 2)).toThrow(/طلب.*اعتماد|الاعتماد.*مسبق/)
    expect(S().purchases).toHaveLength(0)
  })
  it('يمكن إعادة التقديم بعد رفض الطلب السابق', () => {
    expect(() => purchase('rejected')).toThrow(/الاعتماد/)
    const id = S().docApprovals[0].id
    useRawDataStore.setState({ currentUserId: null })
    S().decideDocApproval(id, { status: 'rejected', by: null, byName: 'المالك', reason: 'تصحيح' })
    useRawDataStore.setState({ currentUserId: 5 })
    expect(() => purchase('rejected', 2)).toThrow(/الاعتماد/)
    expect(S().docApprovals).toHaveLength(2)
  })
  it('لا يُعتمد طلب تاريخي مكرر بالادعاء بترحيل فاتورة طلب آخر', () => {
    expect(() => purchase('legacy')).toThrow(/الاعتماد/)
    const first = S().docApprovals[0]
    useRawDataStore.setState({ docApprovals: [first, { ...first, id: first.id + 1 }] })
    useRawDataStore.setState({ currentUserId: null })
    S().decideDocApproval(first.id, { status: 'approved', by: null, byName: 'المالك' })
    expect(() => S().decideDocApproval(first.id + 1, { status: 'approved', by: null, byName: 'المالك' })).toThrow(/مسودة|فاتورة|مسبق/)
    expect(S().docApprovals[1].status).toBe('pending')
    expect(S().purchases).toHaveLength(1)
  })
})
