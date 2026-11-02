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
it('يربط سيريال البيع بدفعة الشراء ويعيد الدفعة المختارة عند رد البيع أو المورد', () => {
  const { s, item } = fixture()
  useRawDataStore.setState({ items: useRawDataStore.getState().items.map(row => row.id === item.id ? { ...row, trackExpiry: true } : row) })
  const supplier = useDataStore.getState().suppliers[0]
  const purchase = s.postPurchase({ supplierId: supplier.id, date: '2026-01-02', lines: [{ itemId: item.id, qty: 1, unitPriceMinor: 100, warehouseId: 1, serialsRaw: 'SER-3', expiryDate: '2098-01-01', lotNumber: 'L3' }, { itemId: item.id, qty: 1, unitPriceMinor: 100, warehouseId: 1, serialsRaw: 'SER-4', expiryDate: '2099-01-01', lotNumber: 'L4' }], expenses: [], paidMinor: 0, treasury: '1101', notes: '' })
  const line = { itemId: item.id, nameAr: item.nameAr, qty: 1, unitPriceMinor: 1000, unitCostMinor: 100, discountPercent: 0, soldByWeight: false, serials: ['SER-4'] }
  const sale = s.postSale({ lines: [line], customerId: null, payment: 'cash', treasury: '1101', paidMinor: 1000, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false })
  expect(useDataStore.getState().batches.map(b => b.lotNumber)).toEqual(['L3'])
  s.postSaleReturn({ saleId: sale.id, lineSpecs: [{ lineIndex: 0, qty: 1, condition: 'resellable', serials: ['SER-4'] }], refund: 'cash', reason: 'رد' })
  expect(useDataStore.getState().batches.find(b => b.lotNumber === 'L4')?.qty).toBe(1)
  s.postPurchaseReturn({ purchaseId: purchase.id, lineSpecs: [{ lineIndex: 1, qty: 1, warehouseId: 1, serials: ['SER-4'] }], refund: 'debt', reason: 'رد للمورد' })
  expect(useDataStore.getState().batches.map(b => b.lotNumber)).toEqual(['L3'])
  expect(useDataStore.getState().serials.find(u => u.serial === 'SER-4')?.status).toBe('returned_supplier')
})
it('لا يُعطّل تتبع السيريال أو الصلاحية مع وجود وحدات مرتبطة بدفعات', () => {
  const { s, item } = fixture()
  useRawDataStore.setState({ items: useRawDataStore.getState().items.map(row => row.id === item.id ? { ...row, trackExpiry: true } : row) })
  s.postPurchase({ supplierId: useDataStore.getState().suppliers[0].id, date: '2026-01-02', lines: [{ itemId: item.id, qty: 1, unitPriceMinor: 100, warehouseId: 1, serialsRaw: 'SER-3', expiryDate: '2099-01-01' }], expenses: [], paidMinor: 0, treasury: '1101', notes: '' })
  expect(() => s.updateItem(item.id, { trackExpiry: false })).toThrow(/تعطيل.*الصلاحية/)
  expect(() => s.updateItem(item.id, { trackSerial: false })).toThrow(/تعطيل.*السيريال/)
})
it('لا يخلط دفعة نفدت وأعيد استعمال رقمها، ويعيد ربط السيريال برقم الدفعة المستعادة', () => {
 const { s, item } = fixture()
 useRawDataStore.setState({ items: useRawDataStore.getState().items.map(row => row.id === item.id ? { ...row, trackExpiry: true } : row) })
 const supplierId = useDataStore.getState().suppliers[0].id
 const purchase = (serial: string, lotNumber: string) => s.postPurchase({ supplierId, date: '2026-01-02', lines: [{ itemId: item.id, qty: 1, unitPriceMinor: 100, warehouseId: 1, serialsRaw: serial, expiryDate: '2099-01-01', lotNumber }], expenses: [], paidMinor: 0, treasury: '1101', notes: '' })
 purchase('SER-3', 'OLD')
 const line = { itemId: item.id, nameAr: item.nameAr, qty: 1, unitPriceMinor: 1000, unitCostMinor: 100, discountPercent: 0, soldByWeight: false, serials: ['SER-3'] }
 const sale = s.postSale({ lines: [line], customerId: null, payment: 'cash', treasury: '1101', paidMinor: 1000, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false })
 purchase('SER-4', 'NEW')
 s.postSaleReturn({ saleId: sale.id, lineSpecs: [{ lineIndex: 0, qty: 1, condition: 'resellable', serials: ['SER-3'] }], refund: 'cash', reason: 'رد' })
 const state = useDataStore.getState(), restored = state.batches.find(b => b.lotNumber === 'OLD')!
 expect(restored.id).not.toBe(state.batches.find(b => b.lotNumber === 'NEW')!.id)
 expect(state.serials.find(u => u.serial === 'SER-3')?.batchId).toBe(restored.id)
 expect(() => s.postSale({ lines: [line], customerId: null, payment: 'cash', treasury: '1101', paidMinor: 1000, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false })).not.toThrow()
})
it('لا يستبدل تاريخ صلاحية مفقود أو رابطاً متعارضاً بالتخمين', () => {
 const { s, item } = fixture()
 useRawDataStore.setState({ items: useRawDataStore.getState().items.map(row => row.id === item.id ? { ...row, trackExpiry: true } : row) })
 const before = useRawDataStore.getState()
 const line = { itemId: item.id, nameAr: item.nameAr, qty: 1, unitPriceMinor: 1000, unitCostMinor: 100, discountPercent: 0, soldByWeight: false, serials: ['SER-1'] }
 expect(() => s.postSale({ lines: [line], customerId: null, payment: 'cash', treasury: '1101', paidMinor: 1000, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false })).toThrow(/السيريال.*الصلاحية/)
 expect(useRawDataStore.getState().journal).toBe(before.journal)
})
it('يرفض شراء صنف مزدوج التتبع دون إدخال سيريال كل وحدة', () => {
 const { s, item } = fixture()
 useRawDataStore.setState({ items: useRawDataStore.getState().items.map(row => row.id === item.id ? { ...row, trackExpiry: true } : row) })
 const before = useRawDataStore.getState()
 expect(() => s.postPurchase({ supplierId: useDataStore.getState().suppliers[0].id, date: '2026-01-02', lines: [{ itemId: item.id, qty: 1, unitPriceMinor: 100, warehouseId: 1, expiryDate: '2099-01-01' }], expenses: [], paidMinor: 0, treasury: '1101', notes: '' })).toThrow(/سيريال.*الصلاحية/)
 expect(useRawDataStore.getState().journal).toBe(before.journal)
})
it('يسمح بربط سيريال تاريخي متاح بدفعة شرائه بعد تأكيد ومرجع دون تغيير كمية أو قيد', () => {
 const { s, item } = fixture()
 useRawDataStore.setState({ items: useRawDataStore.getState().items.map(row => row.id === item.id ? { ...row, trackExpiry: true } : row) })
 const p = s.postPurchase({ supplierId: useDataStore.getState().suppliers[0].id, date: '2026-01-02', lines: [{ itemId: item.id, qty: 1, unitPriceMinor: 100, warehouseId: 1, serialsRaw: 'SER-3', expiryDate: '2099-01-01', lotNumber: 'L3' }], expenses: [], paidMinor: 0, treasury: '1101', notes: '' })
 const batch = useDataStore.getState().batches.find(b => b.purchaseId === p.id)!, unit = useDataStore.getState().serials.find(u => u.serial === 'SER-3')!
 useRawDataStore.setState(state => ({ serials: state.serials.map(u => u.id === unit.id ? { ...u, expiryBatch: undefined, batchId: undefined } : u) }))
 const before = useRawDataStore.getState()
 expect(() => s.linkLegacySerialBatch({ serial: unit.serial, batchId: batch.id, reason: 'فاتورة وتغليف', confirmed: false })).toThrow(/تأكيد/)
 s.linkLegacySerialBatch({ serial: unit.serial, batchId: batch.id, reason: 'فاتورة 123 وتغليف الصنف', confirmed: true })
 const after = useRawDataStore.getState()
 expect(after.journal).toBe(before.journal)
 expect(after.batches).toBe(before.batches)
 expect(after.serials.find(u => u.id === unit.id)).toMatchObject({ batchId: batch.id, expiryLinkEvidence: { reason: 'فاتورة 123 وتغليف الصنف' } })
})
it('يحجب مسارات لا تحفظ السيريال والدفعة قبل أي أثر مخزوني', () => {
 const { s, item } = fixture()
 useRawDataStore.setState({ items: useRawDataStore.getState().items.map(row => row.id === item.id ? { ...row, trackExpiry: true } : row) })
 const before = useRawDataStore.getState()
 expect(() => s.postWastage({ reason: 'تالف', lines: [{ itemId: item.id, qty: 1 }] })).toThrow(/السيريال ودفعة صلاحيته/)
 expect(() => s.postStocktake([{ itemId: item.id, nameAr: item.nameAr, expectedQty: 2, countedQty: 1, unitCostMinor: 100 }], '')).toThrow(/السيريال ودفعة صلاحيته/)
 expect(useRawDataStore.getState().journal).toBe(before.journal)
 expect(useRawDataStore.getState().items).toBe(before.items)
})
it('يحجب الربط التاريخي إذا كانت الدفعة من فاتورة شراء أخرى', () => {
 const { s, item } = fixture()
 useRawDataStore.setState({ items: useRawDataStore.getState().items.map(row => row.id === item.id ? { ...row, trackExpiry: true } : row) })
 const purchase = (serial: string, lotNumber: string) => s.postPurchase({ supplierId: useDataStore.getState().suppliers[0].id, date: '2026-01-02', lines: [{ itemId: item.id, qty: 1, unitPriceMinor: 100, warehouseId: 1, serialsRaw: serial, expiryDate: '2099-01-01', lotNumber }], expenses: [], paidMinor: 0, treasury: '1101', notes: '' })
 purchase('SER-3','L3'); const other = purchase('SER-4','L4')
 useRawDataStore.setState(state => ({ serials: state.serials.map(u => u.serial === 'SER-3' ? { ...u, expiryBatch: undefined, batchId: undefined } : u) }))
 expect(() => s.linkLegacySerialBatch({ serial: 'SER-3', batchId: useDataStore.getState().batches.find(b => b.purchaseId === other.id)!.id, reason: 'مستند', confirmed: true })).toThrow(/دفعة الشراء/)
})
it('يرفض صرف دفعة عندما يتجاوز عدد السيريالات المرتبطة رصيدها', () => {
 const { s, item } = fixture()
 useRawDataStore.setState({ items: useRawDataStore.getState().items.map(row => row.id === item.id ? { ...row, trackExpiry: true } : row) })
 s.postPurchase({ supplierId: useDataStore.getState().suppliers[0].id, date: '2026-01-02', lines: [{ itemId: item.id, qty: 2, unitPriceMinor: 100, warehouseId: 1, serialsRaw: 'SER-3\nSER-4', expiryDate: '2099-01-01', lotNumber: 'L3' }], expenses: [], paidMinor: 0, treasury: '1101', notes: '' })
 useRawDataStore.setState(state => ({ batches: state.batches.map(batch => ({ ...batch, qty: 1 })) }))
 const before = useRawDataStore.getState()
 expect(() => s.postSale({ lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 1, unitPriceMinor: 1000, unitCostMinor: 100, discountPercent: 0, soldByWeight: false, serials: ['SER-3'] }], customerId: null, payment: 'cash', treasury: '1101', paidMinor: 1000, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false })).toThrow(/رصيد دفعة/)
 expect(useRawDataStore.getState().journal).toBe(before.journal)
})
