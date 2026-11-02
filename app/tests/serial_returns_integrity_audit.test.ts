import { beforeEach, expect, it } from 'vitest'
import { EMPTY_EXTENDED, useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const initial = useRawDataStore.getState(), app = useAppStore.getState()
beforeEach(() => { useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true } }); useRawDataStore.setState({ ...initial, branches: [], activeBranchId: null, items: [], suppliers: [], purchases: [], purchaseReturns: [], sales: [], saleReturns: [], serials: [], journal: [], warehouses: [{ id: 1, nameAr: 'الرئيسي', code: 'MAIN', isMain: true }] as never }) })
function fixture() {
  const s = useDataStore.getState()
  s.addSupplier({ ...EMPTY_EXTENDED, nameAr: 'مورد', phone: '', notes: '' })
  s.addItem({ nameAr: 'جهاز', sku: '', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 0, stockQty: 0, priceMinor: 1000, minQty: 0, trackExpiry: false, trackSerial: true, warrantyMonths: 12, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
  const item = useDataStore.getState().items[0], supplier = useDataStore.getState().suppliers[0]
  const purchase = s.postPurchase({ supplierId: supplier.id, date: '2026-01-01', lines: [{ itemId: item.id, qty: 2, unitPriceMinor: 100, warehouseId: 1, serialsRaw: 'SER-1\nSER-2' }], expenses: [], paidMinor: 0, treasury: '1101', notes: '' })
  return { s, item, purchase }
}
it('يسترجع السيريال المختار من البيع فقط دون اختيار وحدة أخرى تلقائياً', () => {
  const { s, item } = fixture()
  const sale = s.postSale({ lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 2, unitPriceMinor: 1000, unitCostMinor: 100, discountPercent: 0, soldByWeight: false, serials: ['SER-1', 'SER-2'] }], customerId: null, payment: 'cash', treasury: '1101', paidMinor: 2000, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false })
  const before = useRawDataStore.getState()
  expect(() => s.postSaleReturn({ saleId: sale.id, lineSpecs: [{ lineIndex: 0, qty: 1, condition: 'resellable' }], refund: 'cash', reason: 'رد' })).toThrow(/سيريال/)
  expect(useRawDataStore.getState().journal).toBe(before.journal)
  const ret = s.postSaleReturn({ saleId: sale.id, lineSpecs: [{ lineIndex: 0, qty: 1, condition: 'resellable', serials: ['SER-2'] }], refund: 'cash', reason: 'رد' })
  expect(ret.lines[0].serials).toEqual(['SER-2'])
  expect(useDataStore.getState().serials.map(u => [u.serial, u.status])).toEqual([['SER-1', 'sold'], ['SER-2', 'in_stock']])
  expect(() => s.postSaleReturn({ saleId: sale.id, lineSpecs: [{ lineIndex: 0, qty: 1, condition: 'resellable', serials: ['SER-2'] }], refund: 'cash', reason: 'تكرار' })).toThrow(/سيريال/)
})
it('يسجل السيريال المرتجع تالفاً ولا يعيده متاحاً للبيع أو الضمان', () => {
  const { s, item } = fixture()
  const sale = s.postSale({ lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 2, unitPriceMinor: 1000, unitCostMinor: 100, discountPercent: 0, soldByWeight: false, serials: ['SER-1', 'SER-2'] }], customerId: null, payment: 'cash', treasury: '1101', paidMinor: 2000, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false })
  s.postSaleReturn({ saleId: sale.id, lineSpecs: [{ lineIndex: 0, qty: 1, condition: 'damaged', serials: ['SER-2'] }], refund: 'cash', reason: 'تالف' })
  expect(useDataStore.getState().serials.find(u => u.serial === 'SER-2')).toMatchObject({ status: 'damaged' })
  expect(useDataStore.getState().items[0].stockQty).toBe(0)
})
it('يرجع للمورد السيريال المختار لا الأقدم تلقائياً', () => {
  const { s, item, purchase } = fixture()
  const before = useRawDataStore.getState()
  expect(() => s.postPurchaseReturn({ purchaseId: purchase.id, lineSpecs: [{ lineIndex: 0, qty: 1, warehouseId: 1 }], refund: 'debt', reason: 'رد' })).toThrow(/سيريال/)
  expect(useRawDataStore.getState().journal).toBe(before.journal)
  const ret = s.postPurchaseReturn({ purchaseId: purchase.id, lineSpecs: [{ lineIndex: 0, qty: 1, warehouseId: 1, serials: ['SER-2'] }], refund: 'debt', reason: 'رد' })
  expect(ret.lines[0].serials).toEqual(['SER-2'])
  expect(useDataStore.getState().serials.map(u => [u.serial, u.status])).toEqual([['SER-1', 'in_stock'], ['SER-2', 'returned_supplier']])
})
it('يرفض تاريخ المرتجع التالف القديم الملتبس قبل تعديل أي حالة', () => {
  const { s, item } = fixture()
  const sale = s.postSale({ lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 2, unitPriceMinor: 1000, unitCostMinor: 100, discountPercent: 0, soldByWeight: false, serials: ['SER-1', 'SER-2'] }], customerId: null, payment: 'cash', treasury: '1101', paidMinor: 2000, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false })
  useRawDataStore.setState({ saleReturns: [{ id: 1, saleId: sale.id, lines: [{ ...sale.lines[0], qty: 1, saleLineIndex: 0, condition: 'damaged' }] }] as never })
  const before = useRawDataStore.getState()
  expect(() => s.postSaleReturn({ saleId: sale.id, lineSpecs: [{ lineIndex: 0, qty: 1, condition: 'resellable', serials: ['SER-2'] }], refund: 'cash', reason: 'رد' })).toThrow(/السابق غير مثبتة/)
  expect(useRawDataStore.getState().serials).toBe(before.serials)
})
it('يرفض اختيار سيريال من سطر آخر في فاتورة شراء متعددة السطور', () => {
  const { s, item } = fixture()
  const supplier = useDataStore.getState().suppliers[0]
  const purchase = s.postPurchase({ supplierId: supplier.id, date: '2026-01-02', lines: [{ itemId: item.id, qty: 1, unitPriceMinor: 100, warehouseId: 1, serialsRaw: 'SER-3' }, { itemId: item.id, qty: 1, unitPriceMinor: 100, warehouseId: 1, serialsRaw: 'SER-4' }], expenses: [], paidMinor: 0, treasury: '1101', notes: '' })
  expect(purchase.lines.map(line => line.serials)).toEqual([['SER-3'], ['SER-4']])
  expect(() => s.postPurchaseReturn({ purchaseId: purchase.id, lineSpecs: [{ lineIndex: 0, qty: 1, warehouseId: 1, serials: ['SER-4'] }], refund: 'debt', reason: 'رد' })).toThrow(/السيريال/)
  s.postPurchaseReturn({ purchaseId: purchase.id, lineSpecs: [{ lineIndex: 1, qty: 1, warehouseId: 1, serials: ['SER-4'] }], refund: 'debt', reason: 'رد' })
  expect(useDataStore.getState().serials.find(u => u.serial === 'SER-4')?.status).toBe('returned_supplier')
})
it('يحجب رد سيريال المورد عندما لا يثبت موقعه بين المخازن', () => {
  const { s, purchase } = fixture()
  useRawDataStore.setState({ warehouses: [...useRawDataStore.getState().warehouses, { id: 2, nameAr: 'ثانٍ', code: 'SECOND', isMain: false }] as never })
  expect(() => s.postPurchaseReturn({ purchaseId: purchase.id, lineSpecs: [{ lineIndex: 0, qty: 1, warehouseId: 1, serials: ['SER-2'] }], refund: 'debt', reason: 'رد' })).toThrow(/مخزن السيريال/)
})
