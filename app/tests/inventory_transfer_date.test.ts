import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
const args = { fromWarehouseId: 1, toWarehouseId: 2, lines: [{ itemId: 5, qty: 2 }], notes: '' }
beforeEach(() => {
 vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 5, 12))
 const setup = { ...app.setup, completed: true, activityId: 'supermarket' as const, countryCode: 'EG' }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] }); useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: null, branches: [], warehouses: [{ id: 1, nameAr: 'رئيسي', isMain: true }, { id: 2, nameAr: 'ثان', isMain: false }], items: [{ id: 5, nameAr: 'صنف', sku: 'X', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 100, stockValueMinor: 1000, stockQty: 10, priceMinor: 200, minQty: 0, isActive: true }] as never, transfers: [], purchases: [], sales: [], saleReturns: [], purchaseReturns: [], productionOrders: [], processingOrders: [], serials: [], batches: [] })
})
afterEach(() => { useRawDataStore.setState(original); useAppStore.setState(app); vi.useRealTimers() })
it('يسجل تحويل اليوم دون تغيير قيمة المخزون أو اليومية', () => {
 const before = S(); const doc = S().postTransfer({ ...args, date: '2026-11-05' }); expect(doc).toMatchObject({ date: expect.stringContaining('2026-11-05'), createdAt: expect.stringContaining('2026-11-05') }); expect(S().journal).toBe(before.journal); expect(S().items).toBe(before.items)
})
it.each(['', '2026-02-30', '2026-11-06', '2026-11-04', '2026-11-05T12:00:00Z'])('يرفض تاريخاً لا يثبت به الرصيد %s دون تسجيل', date => { const before = S(); expect(() => S().postTransfer({ ...args, date })).toThrow(/تاريخ/); expect(S().transfers).toBe(before.transfers) })
it('يرفض الفترة المقفلة والمستخدم غير المخول', () => {
 useAppStore.setState({ fiscalYears: [{ id: 1, nameAr: 'مقفلة', startDate: '2026-01-01', endDate: '2026-12-31', status: 'closed' }] }); expect(() => S().postTransfer(args)).toThrow(/مقفلة/)
 useAppStore.setState({ fiscalYears: [] }); useRawDataStore.setState({ currentUserId: 999 }); const before = S(); expect(() => S().postTransfer(args)).toThrow(/صلاحية/); expect(S().transfers).toBe(before.transfers)
})
it('يتحقق من فترة كلا الفرعين عند تحويل المالك من نطاق كل الفروع', () => {
 const branches = [{ id: 1, nameAr: 'رئيسي', isMain: true, active: true, warehouseId: 1, treasuryCode: '1101' }, { id: 2, nameAr: 'آخر', isMain: false, active: true, warehouseId: 2, treasuryCode: '1121' }]
 useRawDataStore.setState({ branches: branches as never, activeBranchId: null, warehouses: [{ id: 1, nameAr: 'رئيسي', isMain: true, branchId: 1 }, { id: 2, nameAr: 'ثان', isMain: false, branchId: 2 }] })
 useAppStore.setState({ fiscalYears: [{ id: 1, nameAr: 'مقفلة بالفرع الثاني', branchId: 2, startDate: '2026-01-01', endDate: '2026-12-31', status: 'closed' }] })
 const before = S(); expect(() => S().postTransfer(args)).toThrow(/مقفلة/); expect(S().transfers).toBe(before.transfers)
 useAppStore.setState({ fiscalYears: [] }); expect(S().postTransfer(args).totalQty).toBe(2)
})
