import { beforeEach, expect, it } from 'vitest'
import { EMPTY_EXTENDED, useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const initial = useRawDataStore.getState(), app = useAppStore.getState()
beforeEach(() => { useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true } }); useRawDataStore.setState({ ...initial, branches: [], activeBranchId: null, items: [], customers: [], suppliers: [], sales: [], saleReturns: [], purchases: [], journal: [] }) })
function item() {
  const s = useDataStore.getState()
  s.addItem({ nameAr: 'صنف مجاني', sku: '', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 0, stockQty: 1, priceMinor: 1000, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
  return useDataStore.getState().items[0]
}
it('لا يعيد تقييم مخزون لاحق عند رد قطعة مباعة بتكلفة صفر', () => {
  const it = item(), s = useDataStore.getState()
  const sale = s.postSale({ lines: [{ itemId: it.id, nameAr: it.nameAr, qty: 1, unitPriceMinor: 1000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }], customerId: null, payment: 'cash', treasury: '1101', paidMinor: 1000, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false })
  useRawDataStore.setState(state => ({ items: state.items.map(i => ({ ...i, stockQty: 2, costMinor: 51, stockValueMinor: 101 })) }))
  s.postSaleReturn({ saleId: sale.id, qtyByItem: new Map([[it.id, 1]]), refund: 'cash', reason: 'رد' })
  expect(useRawDataStore.getState().items[0]).toMatchObject({ stockQty: 3, stockValueMinor: 101, costMinor: 34 })
})
it('لا يعيد تقييم رصيد المخزون إذا اشترى قطعة مجانية', () => {
  const it = item(), s = useDataStore.getState()
  s.addSupplier({ ...EMPTY_EXTENDED, nameAr: 'مورد', phone: '', notes: '' })
  useRawDataStore.setState(state => ({ items: state.items.map(i => ({ ...i, stockQty: 2, costMinor: 51, stockValueMinor: 101 })) }))
  s.addItem({ ...it, nameAr: 'صنف إضافي', sku: 'second', stockQty: 0, stockValueMinor: 0 })
  const second = useRawDataStore.getState().items.at(-1)!
  s.postPurchase({ supplierId: useRawDataStore.getState().suppliers[0].id, date: '2026-01-01', lines: [{ itemId: it.id, qty: 1, unitPriceMinor: 0 }, { itemId: second.id, qty: 1, unitPriceMinor: 10 }], expenses: [], paidMinor: 0, treasury: '1101', notes: '' })
  expect(useRawDataStore.getState().items[0]).toMatchObject({ stockQty: 3, stockValueMinor: 101, costMinor: 34 })
})
