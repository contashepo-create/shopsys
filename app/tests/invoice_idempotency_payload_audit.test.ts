import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EMPTY_EXTENDED, useRawDataStore } from '../src/data/repo.ts'
import { draftFromCategory } from '../src/core/items.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const original = useRawDataStore.getState(), app = useAppStore.getState()
const S = () => useRawDataStore.getState()
const purchase = (id: string, qty: number) => S().postPurchase({ sourceDraftId: id, supplierId: 7, date: '2026-01-01', lines: [{ itemId: 1, qty, unitPriceMinor: 1000 }], expenses: [], paidMinor: 0, notes: '' })
const sale = (id: string, qty: number) => S().postSale({ sourceDraftId: id, lines: [{ itemId: 1, nameAr: 'صنف', qty, unitPriceMinor: 1500, unitCostMinor: 1000, discountPercent: 0, soldByWeight: false }], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false })
beforeEach(() => {
  const setup = { ...app.setup, taxRegistrationStatus: 'not_registered' as const, vatPercent: 0, requireOpenShiftForSales: false }
  useAppStore.setState({ setup, companySetup: setup, approvals: { enabled: false, scope: ['purchase', 'sale'], thresholdMinor: 0, approverUserIds: [], autoApprovedUserIds: [] } })
  useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: null, branches: [], suppliers: [{ ...EMPTY_EXTENDED, id: 7, nameAr: 'مورد', phone: '', active: true }] as never, items: [{ ...draftFromCategory(undefined, 'A'), id: 1, nameAr: 'صنف', costMinor: 1000, priceMinor: 1500, stockQty: 10, isService: false }], purchases: [], sales: [], purchaseReturns: [], saleReturns: [], journal: [], docApprovals: [], warehouses: [], serials: [], batches: [], variantStocks: [] })
})
afterEach(() => { useRawDataStore.setState(original); useAppStore.setState(app) })
describe('إعادة إرسال مسودة بمحتوى مختلف', () => {
  it.each(['purchase', 'sale'] as const)('لا يدّعي نجاح تغييرات مسودة رُحلت (%s)', kind => {
    const post = kind === 'purchase' ? purchase : sale
    const first = post('draft', 1)
    expect(post('draft', 1).id).toBe(first.id)
    const before = S()
    expect(() => post('draft', 2)).toThrow(/تغير|تغيّر|مختلف|راجع/)
    expect(S().journal).toBe(before.journal)
    expect(S().items).toBe(before.items)
  })
  it('بعد اعتماد المسودة لا تظهر تغييراتها المحلية كأنها رُحلت', () => {
    useAppStore.setState({ approvals: { enabled: true, scope: ['purchase'], thresholdMinor: 0, approverUserIds: [], autoApprovedUserIds: [] } })
    useRawDataStore.setState({ currentUserId: 5, appUsers: [{ id: 5, nameAr: 'موظف', roleId: 'cashier', pinHash: '0'.repeat(64), active: true, branchId: null }] as never })
    expect(() => purchase('approval', 1)).toThrow(/الاعتماد/)
    const request = S().docApprovals[0]
    useRawDataStore.setState({ currentUserId: null })
    S().decideDocApproval(request.id, { status: 'approved', by: null, byName: 'المالك' })
    expect(purchase('approval', 1).id).toBe(S().purchases[0].id)
    expect(() => purchase('approval', 2)).toThrow(/تغير|تغيّر|مختلف|راجع/)
    expect(S().purchases).toHaveLength(1)
  })
  it('يبقى دليل مدخل البيع نفسه صالحاً بعد إضافة تاريخ التقديم أثناء الاعتماد', () => {
    useAppStore.setState({ approvals: { enabled: true, scope: ['sale'], thresholdMinor: 0, approverUserIds: [], autoApprovedUserIds: [] } })
    useRawDataStore.setState({ currentUserId: 5, appUsers: [{ id: 5, nameAr: 'موظف', roleId: 'cashier', pinHash: '0'.repeat(64), active: true, branchId: null }] as never })
    expect(() => sale('approval-sale', 1)).toThrow(/الاعتماد/)
    const request = S().docApprovals[0]
    useRawDataStore.setState({ currentUserId: null })
    S().decideDocApproval(request.id, { status: 'approved', by: null, byName: 'المالك' })
    expect(sale('approval-sale', 1).id).toBe(S().sales[0].id)
    expect(() => sale('approval-sale', 2)).toThrow(/تغيّر|تغير/)
  })
  it('فاتورة عُدلت بعد ترحيلها لا تُعرض كأنها استجابة مطابقة للأصل', () => {
    const invoice = purchase('edited', 1)
    S().editPurchase({ purchaseId: invoice.id, lines: [{ itemId: 1, qty: 2, unitPriceMinor: 1000 }], expenses: [], paidMinor: 0, treasury: '1101', reason: 'تصحيح', einvoiceActive: false })
    expect(() => purchase('edited', 1)).toThrow(/عُدلت|راجع/)
    expect(S().purchases).toHaveLength(1)
  })
  it('الفاتورة التاريخية التي لم تحتفظ بدليل المدخل لا تفترض تطابقه', () => {
    purchase('old', 1)
    useRawDataStore.setState(state => ({ purchases: state.purchases.map(row => ({ ...row, sourceDraftEvidence: undefined })) }))
    expect(() => purchase('old', 1)).toThrow(/مراجعة|راجع/)
    expect(S().purchases).toHaveLength(1)
  })
})
