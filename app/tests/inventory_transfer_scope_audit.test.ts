import { afterEach, beforeEach, expect, it } from 'vitest'
import { useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const initial = useRawDataStore.getState(), app = useAppStore.getState()
const item = { id: 5, nameAr: 'صنف', sku: 'X', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 100, stockValueMinor: 1000, stockQty: 10, priceMinor: 200, minQty: 0, isActive: true }
const args = { fromWarehouseId: 1, toWarehouseId: 2, lines: [{ itemId: 5, qty: 1 }], notes: '' }
beforeEach(() => {
 useAppStore.getState().setActiveBranchContext(null)
 useRawDataStore.setState({ ...initial, branches: [], activeBranchId: null, warehouses: [{ id: 1, nameAr: 'رئيسي', isMain: true }, { id: 2, nameAr: 'ثان', isMain: false }] as never, items: [item] as never, transfers: [], purchases: [], sales: [], saleReturns: [], purchaseReturns: [], productionOrders: [], processingOrders: [] })
})
afterEach(() => { useAppStore.setState(app); useRawDataStore.setState(initial) })
it('يرفض هوية صنف مكررة قبل أي تحويل مخزني', () => {
 useRawDataStore.setState({ items: [item, { ...item, nameAr: 'هوية متعارضة' }] as never })
 const before = useRawDataStore.getState()
 expect(() => useDataStore.getState().postTransfer(args)).toThrow(/صنف|فريد/)
 expect(useRawDataStore.getState().transfers).toBe(before.transfers)
})
it('لا يحوّل خدمة حتى إن كان رصيدها القديم موجباً بالخطأ', () => {
 useRawDataStore.setState({ items: [{ ...item, isService: true }] as never })
 const before = useRawDataStore.getState()
 expect(() => useDataStore.getState().postTransfer(args)).toThrow(/خدم/)
 expect(useRawDataStore.getState().transfers).toBe(before.transfers)
})
it('يرفض تحويل أصناف مسلسلة قبل تحديد وحداتها وربطها بالمخازن', () => {
 useRawDataStore.setState({ items: [{ ...item, trackSerial: true }] as never })
 const before = useRawDataStore.getState()
 expect(() => useDataStore.getState().postTransfer(args)).toThrow(/سيريال|مسلسل/)
 expect(useRawDataStore.getState().transfers).toBe(before.transfers)
})
it('يرفض معرف مخزن مكرراً بدلاً من إسناد الحركة إلى مخزن ملتبس', () => {
 useRawDataStore.setState({ warehouses: [{ id: 1, nameAr: 'رئيسي', isMain: true }, { id: 1, nameAr: 'مكرر', isMain: false }, { id: 2, nameAr: 'ثان', isMain: false }] as never })
 const before = useRawDataStore.getState()
 expect(() => useDataStore.getState().postTransfer(args)).toThrow(/مخزن|فريد/)
 expect(useRawDataStore.getState().transfers).toBe(before.transfers)
})
it('لا يحوّل صنف فرع آخر لمجرد تعارض موطن مخزنه مع الفرع الحالي', () => {
 useRawDataStore.setState({
  branches: [{ id: 1, nameAr: 'رئيسي', isMain: true, warehouseId: 1, treasuryCode: '1101', active: true }, { id: 2, nameAr: 'آخر', isMain: false, warehouseId: 3, treasuryCode: '1102', active: true }],
  activeBranchId: 1,
  warehouses: [{ id: 1, nameAr: 'رئيسي', isMain: true, branchId: 1 }, { id: 2, nameAr: 'داخلي', isMain: false, branchId: 1 }, { id: 3, nameAr: 'فرع آخر', isMain: false, branchId: 2 }] as never,
  items: [{ ...item, branchId: 2, warehouseId: 1 }] as never,
 })
 const before = useRawDataStore.getState()
 expect(() => useDataStore.getState().postTransfer(args)).toThrow(/فرع|صنف/)
 expect(useRawDataStore.getState().transfers).toBe(before.transfers)
})
it('يسمح بتحويل صنف مخزني مثبت داخل الفرع ويحتفظ بالقيمة الكلية', () => {
 const before = useRawDataStore.getState()
 const transfer = useDataStore.getState().postTransfer(args)
 const after = useRawDataStore.getState()
 expect(transfer.lines[0].qty).toBe(1)
 expect(after.items).toBe(before.items)
 expect(after.journal).toBe(before.journal)
})
it('لا يتجاهل دفعات مخزنية باقية بعد إيقاف علم الصلاحية — ينقلها بدفعة موثقة', () => {
 useRawDataStore.setState({ batches: [{ id: 1, itemId: item.id, warehouseId: 1, lotNumber: 'أ', expiryDate: '2099-01-01', qty: 5, purchaseId: null, receivedAt: '2026-01-01' }] as never })
 const transfer = useDataStore.getState().postTransfer(args)
 const after = useRawDataStore.getState()
 // لم يعد التحويل مرفوضاً قطعاً (كان يمنع نقل كل بضاعة لها صلاحية)، لكنه لا يتجاهل الدفعة:
 // يخصم من دفعة المصدر وينشئ دفعة الوجهة بنفس الصلاحية والتشغيلة.
 expect(transfer.lines[0].batchAllocations).toEqual([{ batchId: 1, qty: 1 }])
 expect(after.batches.find((batch) => batch.id === 1)!.qty).toBe(4)
 const moved = after.batches.find((batch) => batch.id !== 1)!
 expect(moved).toMatchObject({ itemId: item.id, warehouseId: 2, qty: 1, lotNumber: 'أ', expiryDate: '2099-01-01' })
 expect(after.batches.reduce((sum, batch) => sum + batch.qty, 0)).toBe(5)
})
