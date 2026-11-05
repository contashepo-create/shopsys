import { beforeEach, expect, it } from 'vitest'
import { EMPTY_EXTENDED, useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const initial = useRawDataStore.getState(), app = useAppStore.getState()
beforeEach(() => {
 useAppStore.getState().setActiveBranchContext(null)
 useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true } })
 useRawDataStore.setState({ ...initial, branches: [], activeBranchId: null, items: [], suppliers: [], purchases: [], purchaseReturns: [], sales: [], saleReturns: [], journal: [], batches: [], serials: [], transfers: [], warehouses: [{ id: 1, nameAr: 'أ', isMain: true }, { id: 2, nameAr: 'ب', isMain: false }] as never })
})
function fixture() {
 const s = useDataStore.getState()
 s.addSupplier({ ...EMPTY_EXTENDED, nameAr: 'مورد', phone: '', notes: '' })
 s.addItem({ nameAr: 'دواء', sku: '', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 0, stockQty: 0, priceMinor: 1000, minQty: 0, trackExpiry: true, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
 const item = useRawDataStore.getState().items[0]
 const p = s.postPurchase({ supplierId: useRawDataStore.getState().suppliers[0].id, date: '2026-01-01', lines: [{ itemId: item.id, qty: 3, unitPriceMinor: 100, warehouseId: 1, expiryDate: '2098-01-01', lotNumber: 'A' }, { itemId: item.id, qty: 2, unitPriceMinor: 120, warehouseId: 2, expiryDate: '2099-01-01', lotNumber: 'B' }], expenses: [], paidMinor: 0, notes: '' })
 const batchA = p.purchaseExpiryBatches![0].batch, batchB = p.purchaseExpiryBatches![1].batch
 return { s, item, p, batchA, batchB }
}
function submit(purchaseId: number, lineIndex: number, warehouseId: number, batchId: number, qty: number) {
 return useDataStore.getState().postPurchaseReturn({ purchaseId, lineSpecs: [{ lineIndex, qty, warehouseId, batchAllocations: [{ batchId, qty }] }], refund: 'debt', reason: 'رد فعلي' } as never)
}
it('يخصم الدفعة المختارة من المخزن المحدد ويثبتها في المرتجع والقيد', () => {
 const { p, batchA, batchB } = fixture()
 const ret = submit(p.id, 1, 2, batchB.id, 1)
 const state = useRawDataStore.getState()
 expect(state.batches.find(b => b.id === batchA.id)?.qty).toBe(3)
 expect(state.batches.find(b => b.id === batchB.id)?.qty).toBe(1)
 expect(ret.lines[0]).toMatchObject({ purchaseLineIndex: 1, warehouseId: 2, qty: 1, expiryBatchAllocation: { batchId: batchB.id, sourceBatchId: batchB.id, qty: 1 } })
 expect(state.journal.find(e => e.id === ret.journalEntryId)?.purchaseReturnExpiryBatches).toEqual([{ purchaseLineIndex: 1, itemId: batchB.itemId, warehouseId: 2, batchId: batchB.id, sourceBatchId: batchB.id, qty: 1 }])
})
it('يرفض دفعة سطر آخر أو مخزن آخر بلا قيد أو حركة', () => {
 const { p, batchA, batchB } = fixture(), before = useRawDataStore.getState()
 expect(() => submit(p.id, 1, 2, batchA.id, 1)).toThrow(/دفعة|مخزن/)
 expect(() => submit(p.id, 1, 1, batchB.id, 1)).toThrow(/دفعة|مخزن/)
 expect(useRawDataStore.getState().journal).toBe(before.journal)
 expect(useRawDataStore.getState().batches).toBe(before.batches)
})
it('يرفض الدليل الأصلي المتعارض أو السجل التاريخي غير المثبت', () => {
 const { p, batchB } = fixture(), state = useRawDataStore.getState()
 useRawDataStore.setState({ journal: state.journal.map(e => e.id === p.journalEntryId ? { ...e, purchaseExpiryBatches: [] } : e) })
 const before = useRawDataStore.getState()
 expect(() => submit(p.id, 1, 2, batchB.id, 1)).toThrow(/دفعة|إثبات/)
 expect(useRawDataStore.getState().journal).toBe(before.journal)
})
it('يرفض استكمال الرد عند تلف إثبات المرتجع السابق', () => {
 const { p, batchB } = fixture()
 const ret = submit(p.id, 1, 2, batchB.id, 1), current = useRawDataStore.getState()
 useRawDataStore.setState({ journal: current.journal.map(e => e.id === ret.journalEntryId ? { ...e, purchaseReturnExpiryBatches: [] } : e) })
 const before = useRawDataStore.getState()
 expect(() => submit(p.id, 1, 2, batchB.id, 1)).toThrow(/دفعة|إثبات/)
 expect(useRawDataStore.getState().journal).toBe(before.journal)
})
it('يعالج مرتجعين متتابعين دون تجاوز الأصل ويثبت قيد كل منهما', () => {
 const { p, batchB } = fixture()
 submit(p.id, 1, 2, batchB.id, 1)
 submit(p.id, 1, 2, batchB.id, 1)
 expect(useRawDataStore.getState().batches.some(b => b.id === batchB.id)).toBe(false)
 const before = useRawDataStore.getState()
 expect(() => submit(p.id, 1, 2, batchB.id, 1)).toThrow()
 expect(useRawDataStore.getState().journal).toBe(before.journal)
})
it('يرفض الكمية أو المعرف المتعارضين والتلاعب بهوية الدفعة', () => {
 const { p, batchB } = fixture(), state = useRawDataStore.getState()
 expect(() => useDataStore.getState().postPurchaseReturn({ purchaseId: p.id, lineSpecs: [{ lineIndex: 1, qty: 1, warehouseId: 2, batchAllocations: [{ batchId: batchB.id, qty: 0.5 }] }], refund: 'debt', reason: 'رد' })).toThrow(/دفعة/)
 useRawDataStore.setState({ batches: state.batches.map(b => b.id === batchB.id ? { ...b, lotNumber: 'آخر' } : b) })
 const before = useRawDataStore.getState()
 expect(() => submit(p.id, 1, 2, batchB.id, 1)).toThrow(/دفعة/)
 expect(useRawDataStore.getState().journal).toBe(before.journal)
})
it('لا يتجاوز دليل الشراء بتعطيل علم الصلاحية بعد الاستلام', () => {
 const { p, batchB, item } = fixture()
 useRawDataStore.setState(state => ({ items: state.items.map(i => i.id === item.id ? { ...i, trackExpiry: false } : i) }))
 const ret = submit(p.id, 1, 2, batchB.id, 1)
 expect(ret.lines[0].expiryBatchAllocation?.qty).toBe(1)
 expect(useRawDataStore.getState().batches.find(b => b.id === batchB.id)?.qty).toBe(1)
})
it('يحجب الرد التاريخي غير المثبت بدلاً من استنتاج توزيع دفعاته', () => {
 const { p, batchB } = fixture()
 useRawDataStore.setState(state => ({ purchaseReturns: [{ id: 99, returnNumber: 'قديم', refCode: 'old', date: '2026-01-01', purchaseId: p.id, refund: 'debt', lines: [{ itemId: batchB.itemId, nameAr: 'دواء', qty: 1, landedUnitCostMinor: 120 }], totalMinor: 120, journalEntryId: 999, reason: '' }, ...state.purchaseReturns] }))
 const before = useRawDataStore.getState()
 expect(() => submit(p.id, 1, 2, batchB.id, 1)).toThrow(/دفعة|إثبات/)
 expect(useRawDataStore.getState().journal).toBe(before.journal)
})
it('يرد سطرين من الصنف نفسه في مخزنين مختلفين في مستند واحد', () => {
 const { p, batchA, batchB } = fixture()
 const ret = useDataStore.getState().postPurchaseReturn({ purchaseId: p.id, lineSpecs: [{ lineIndex: 0, qty: 1, warehouseId: 1, batchAllocations: [{ batchId: batchA.id, qty: 1 }] }, { lineIndex: 1, qty: 1, warehouseId: 2, batchAllocations: [{ batchId: batchB.id, qty: 1 }] }], refund: 'debt', reason: 'رد فعلي' })
 const state = useRawDataStore.getState()
 expect(ret.lines.map(l => l.expiryBatchAllocation?.batchId)).toEqual([batchA.id, batchB.id])
 expect(state.batches.map(b => b.qty)).toEqual([2, 1])
 expect(state.journal.find(e => e.id === ret.journalEntryId)?.purchaseReturnExpiryBatches).toHaveLength(2)
})
it('لا يخفي دليل القيد بحذف دليل الشراء وتعطيل العلم والدفعة', () => {
 const { p, batchB, item } = fixture()
 useRawDataStore.setState(state => ({ purchases: state.purchases.map(row => row.id === p.id ? { ...row, purchaseExpiryBatches: undefined } : row), batches: state.batches.filter(b => b.itemId !== item.id), items: state.items.map(i => i.id === item.id ? { ...i, trackExpiry: false } : i) }))
 const before = useRawDataStore.getState()
 expect(() => submit(p.id, 1, 2, batchB.id, 1)).toThrow(/دفعة|إثبات/)
 expect(useRawDataStore.getState().journal).toBe(before.journal)
})
it('يرفض تصادم معرف الدفعة حتى إذا كان لصنف آخر', () => {
 const { p, batchB } = fixture()
 useRawDataStore.setState(state => ({ batches: [...state.batches, { ...batchB, itemId: 999 }] }))
 const before = useRawDataStore.getState()
 expect(() => submit(p.id, 1, 2, batchB.id, 1)).toThrow(/دفعة/)
 expect(useRawDataStore.getState().journal).toBe(before.journal)
})
it('يحافظ على إثبات المرتجع في النسخ والاستعادة', async () => {
 const { p, batchB } = fixture(), r = submit(p.id, 1, 2, batchB.id, 1)
 const { flushSecureStorageWrites, secureStorage } = await import('../src/data/secureStorage.ts')
 const { buildBackup, parseBackup } = await import('../src/core/backup.ts')
 await flushSecureStorageWrites('shopsys-data')
 const saved = await secureStorage.getItem('shopsys-data')
 const restored = parseBackup(JSON.stringify(buildBackup({ appState: {}, storeState: JSON.parse(saved!), appDataVersion: 1, shopName: 'اختبار' })))
 useRawDataStore.setState({ purchaseReturns: [], journal: [], batches: [] })
 await flushSecureStorageWrites('shopsys-data')
 await secureStorage.setItem('shopsys-data', JSON.stringify(restored.data.store))
 await useRawDataStore.persist.rehydrate()
 const state = useRawDataStore.getState()
 expect(state.purchaseReturns.find(row => row.id === r.id)?.lines[0].expiryBatchAllocation).toEqual(r.lines[0].expiryBatchAllocation)
 expect(state.journal.find(row => row.id === r.journalEntryId)?.purchaseReturnExpiryBatches).toHaveLength(1)
 expect(() => submit(p.id, 1, 2, batchB.id, 1)).not.toThrow()
})
it('يرفض هوية صنف مكررة قبل أن تخصم حركة المرتجع من الصنفين', () => {
 const { p, batchB, item } = fixture()
 useRawDataStore.setState(state => ({ items: [...state.items, { ...item, nameAr: 'مكرر' }] }))
 const before = useRawDataStore.getState()
 expect(() => submit(p.id, 1, 2, batchB.id, 1)).toThrow(/صنف|فريد/)
 expect(useRawDataStore.getState().items).toBe(before.items)
 expect(useRawDataStore.getState().journal).toBe(before.journal)
})
it('يرفض فاتورتي شراء تحملان المعرف نفسه قبل كتابة المرتجع', () => {
 const { p, batchB } = fixture()
 useRawDataStore.setState(state => ({ purchases: [...state.purchases, { ...p, invoiceNumber: 'مكرر' }] }))
 const before = useRawDataStore.getState()
 expect(() => submit(p.id, 1, 2, batchB.id, 1)).toThrow(/فاتورة|فريد/)
 expect(useRawDataStore.getState().journal).toBe(before.journal)
})
it('يرفض الإخراج من مخزن خارج فرع المستخدم ولو عُرض الصنف في فرعه', () => {
 const { p, batchB, item } = fixture()
 useRawDataStore.setState(state => ({
  branches: [{ id: 1, nameAr: 'رئيسي', isMain: true, warehouseId: 1, treasuryCode: '1101', active: true }, { id: 2, nameAr: 'آخر', isMain: false, warehouseId: 2, treasuryCode: '1102', active: true }], activeBranchId: 1,
  warehouses: state.warehouses.map(w => ({ ...w, branchId: w.id })),
  items: state.items.map(i => i.id === item.id ? { ...i, branchId: 1, warehouseId: 1 } : i),
 }))
 const before = useRawDataStore.getState()
 expect(() => submit(p.id, 1, 2, batchB.id, 1)).toThrow(/مخزن|فرع/)
 expect(useRawDataStore.getState().journal).toBe(before.journal)
})
it('لا يتجاوز ربط السيريال بالدفعة بعد تعطيل العلم وحذف رابط الوحدة', () => {
 const s = useDataStore.getState()
 useRawDataStore.setState({ warehouses: [{ id: 1, nameAr: 'أ', isMain: true }] as never })
 s.addSupplier({ ...EMPTY_EXTENDED, nameAr: 'مورد', phone: '', notes: '' })
 s.addItem({ nameAr: 'جهاز', sku: '', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 0, stockQty: 0, priceMinor: 1000, minQty: 0, trackExpiry: true, trackSerial: true, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
 const item = useRawDataStore.getState().items[0]
 const p = s.postPurchase({ supplierId: useRawDataStore.getState().suppliers[0].id, date: '2026-01-01', lines: [{ itemId: item.id, qty: 1, unitPriceMinor: 100, warehouseId: 1, expiryDate: '2099-01-01', serialsRaw: 'SER-1' }], expenses: [], paidMinor: 0, notes: '' })
 useRawDataStore.setState(state => ({ items: state.items.map(i => i.id === item.id ? { ...i, trackExpiry: false } : i), serials: state.serials.map(unit => ({ ...unit, expiryBatch: undefined, batchId: undefined })) }))
 const before = useRawDataStore.getState()
 expect(() => s.postPurchaseReturn({ purchaseId: p.id, lineSpecs: [{ lineIndex: 0, qty: 1, warehouseId: 1, serials: ['SER-1'] }], refund: 'debt', reason: 'رد' })).toThrow(/سيريال|دفعة/)
 expect(useRawDataStore.getState().journal).toBe(before.journal)
 expect(useRawDataStore.getState().batches).toBe(before.batches)
})
it('لا يقبل ربط سيريال السطر بدفعة سطر آخر من فاتورة الشراء نفسها', () => {
 const s = useDataStore.getState()
 useRawDataStore.setState({ warehouses: [{ id: 1, nameAr: 'أ', isMain: true }] as never })
 s.addSupplier({ ...EMPTY_EXTENDED, nameAr: 'مورد', phone: '', notes: '' })
 s.addItem({ nameAr: 'جهاز', sku: '', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 0, stockQty: 0, priceMinor: 1000, minQty: 0, trackExpiry: true, trackSerial: true, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
 const item = useRawDataStore.getState().items[0]
 const p = s.postPurchase({ supplierId: useRawDataStore.getState().suppliers[0].id, date: '2026-01-01', lines: [{ itemId: item.id, qty: 1, unitPriceMinor: 100, warehouseId: 1, expiryDate: '2098-01-01', serialsRaw: 'SER-A' }, { itemId: item.id, qty: 1, unitPriceMinor: 100, warehouseId: 1, expiryDate: '2099-01-01', serialsRaw: 'SER-B' }], expenses: [], paidMinor: 0, notes: '' })
 const first = p.purchaseExpiryBatches![0].batch
 useRawDataStore.setState(state => ({ serials: state.serials.map(unit => unit.serial === 'SER-A' ? { ...unit, status: 'sold' } : { ...unit, expiryBatch: { ...first }, batchId: first.id }) }))
 const before = useRawDataStore.getState()
 expect(() => s.postPurchaseReturn({ purchaseId: p.id, lineSpecs: [{ lineIndex: 1, qty: 1, warehouseId: 1, serials: ['SER-B'] }], refund: 'debt', reason: 'رد' })).toThrow(/سيريال|دفعة/)
 expect(useRawDataStore.getState().journal).toBe(before.journal)
 expect(useRawDataStore.getState().batches).toBe(before.batches)
})
