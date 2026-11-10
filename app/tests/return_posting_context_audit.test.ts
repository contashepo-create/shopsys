import { afterEach, beforeEach, expect, it } from 'vitest'
import { EMPTY_EXTENDED, useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { todayLocalIso } from '../src/core/time.ts'

const initial = useRawDataStore.getState(), app = useAppStore.getState()
beforeEach(() => {
 useAppStore.setState({ ...app, fiscalYears: [], approvals: { ...app.approvals, enabled: false }, setup: { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true } })
 useRawDataStore.setState({ ...initial, branches: [], activeBranchId: null, currentUserId: null, items: [], suppliers: [], purchases: [], purchaseReturns: [], sales: [], saleReturns: [], journal: [] })
})
afterEach(() => { useRawDataStore.setState(initial); useAppStore.setState(app) })
function fixture() {
 const s = useDataStore.getState()
 s.addSupplier({ ...EMPTY_EXTENDED, nameAr: 'مورد', phone: '', notes: '' })
 s.addItem({ nameAr: 'صنف', sku: '', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 0, stockQty: 0, priceMinor: 500, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
 const item = useDataStore.getState().items[0], supplier = useDataStore.getState().suppliers[0]
 const purchase = s.postPurchase({ supplierId: supplier.id, date: todayLocalIso(), lines: [{ itemId: item.id, qty: 3, unitPriceMinor: 100 }], expenses: [], paidMinor: 0, treasury: '1101', notes: '' })
 const sale = s.postSale({ lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 1, unitPriceMinor: 500, unitCostMinor: 100, discountPercent: 0, soldByWeight: false }], customerId: null, payment: 'cash', treasury: '1101', paidMinor: 500, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false })
 return { item, purchase, sale }
}
function attempts(f: ReturnType<typeof fixture>) {
 const s = useDataStore.getState()
 return [() => s.postSaleReturn({ saleId: f.sale.id, qtyByItem: new Map([[f.item.id, 1]]), refund: 'cash', reason: 'رد' }), () => s.postPurchaseReturn({ purchaseId: f.purchase.id, qtyByItem: new Map([[f.item.id, 1]]), refund: 'debt', reason: 'رد' })]
}
function assertNoEffect(before: ReturnType<typeof useRawDataStore.getState>) {
 const after = useRawDataStore.getState()
 for (const key of ['journal', 'items', 'saleReturns', 'purchaseReturns', 'approvalRequests'] as const) expect(after[key]).toBe(before[key])
}
it('يرفض المرتجعين في فترة اليوم المقفلة بلا تغيير مالي أو مخزني', () => {
 const f = fixture(), day = todayLocalIso()
 useAppStore.setState({ fiscalYears: [{ id: 1, nameAr: 'مقفلة', startDate: day, endDate: day, status: 'closed' }] })
 for (const run of attempts(f)) { const before = useRawDataStore.getState(); expect(run).toThrow(/المقفلة/); assertNoEffect(before) }
})
it('يرفض الأصل ذا التاريخ الفاسد أو اللاحق لليوم بلا أثر', () => {
 const f = fixture()
 useRawDataStore.setState(state => ({ sales: state.sales.map(row => ({ ...row, date: '9999-01-01' })), purchases: state.purchases.map(row => ({ ...row, date: 'تاريخ مجهول' })) }))
 for (const run of attempts(f)) { const before = useRawDataStore.getState(); expect(run).toThrow(/تاريخ/); assertNoEffect(before) }
})
it('يرفض تاريخ مرتجع سابق قبل فاتورته أو بعد اليوم', () => {
 const f = fixture()
 useRawDataStore.setState(state => ({
  saleReturns: [{ id: 100, saleId: f.sale.id, date: '9999-01-01' } as never],
  purchaseReturns: [{ id: 101, purchaseId: f.purchase.id, date: '0001-01-01' } as never],
  sales: state.sales, purchases: state.purchases,
 }))
 for (const run of attempts(f)) { const before = useRawDataStore.getState(); expect(run).toThrow(/تاريخ/); assertNoEffect(before) }
})
it('يرفض مصدر فرع آخر حتى بالاستدعاء المباشر ولا يفتح طلب موافقة', () => {
 const f = fixture()
 const branches = [{ id: 1, nameAr: 'الأول', isMain: true, active: true, warehouseId: 1, treasuryCode: '1101' }, { id: 2, nameAr: 'الثاني', isMain: false, active: true, warehouseId: 2, treasuryCode: '1102' }]
 useRawDataStore.setState(state => ({ branches, activeBranchId: 2, sales: state.sales.map(row => ({ ...row, branchId: 1 })), purchases: state.purchases.map(row => ({ ...row, branchId: 1 })) }))
 for (const run of attempts(f)) { const before = useRawDataStore.getState(); expect(run).toThrow(/الفرع/); assertNoEffect(before) }
 useRawDataStore.setState({ activeBranchId: null })
 for (const run of attempts(f)) { const before = useRawDataStore.getState(); expect(run).toThrow(/الفرع/); assertNoEffect(before) }
})
it('يسجل تاريخ اليوم ذاته للمستند وقيده عندما يكون الأصل والفرع صالحين', () => {
 const f = fixture(), [saleReturn, purchaseReturn] = attempts(f)
 const sr = saleReturn(), pr = purchaseReturn(), journal = useRawDataStore.getState().journal
 for (const ret of [sr, pr]) { expect(ret.date.slice(0, 10)).toBe(todayLocalIso()); expect(journal.find(row => row.id === ret.journalEntryId)?.date).toBe(todayLocalIso()) }
})
