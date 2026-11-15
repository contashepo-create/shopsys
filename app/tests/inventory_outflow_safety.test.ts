import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'

const original = useRawDataStore.getState(), app = useAppStore.getState()
const S = () => useRawDataStore.getState()
const item = { id: 5, nameAr: 'صنف', sku: 'X', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 33, stockValueMinor: 100, stockQty: 3, priceMinor: 200, minQty: 0, isActive: true }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 5, 12))
  const setup = { ...app.setup, completed: true, activityId: 'supermarket' as const, countryCode: 'EG' }
  useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
  useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: null, branches: [], warehouses: [{ id: 1, nameAr: 'رئيسي', isMain: true }, { id: 2, nameAr: 'ثان', isMain: false }], items: [item] as never, transfers: [], purchases: [], sales: [], saleReturns: [], purchaseReturns: [], productionOrders: [], processingOrders: [], serials: [], batches: [], journal: [], wastages: [], consumptions: [] })
})
afterEach(() => { useRawDataStore.setState(original); useAppStore.setState(app); vi.useRealTimers() })
for (const kind of ['wastage', 'consumption'] as const) describe(kind, () => {
  const post = (qty: number, date?: string) => kind === 'wastage'
    ? S().postWastage({ reason: 'تالف', notes: '', lines: [{ itemId: 5, qty }], date })
    : S().postConsumption({ purpose: 'تشغيل', notes: '', lines: [{ itemId: 5, qty }], date })
  it('يطابق القيد والمستند تغير القيمة الدقيقة عند الصرف الجزئي والنفاد', () => {
    const first = post(1, '2026-11-05')
    expect(first.totalCostMinor).toBe(33); expect(first.lines[0].costTotalMinor).toBe(33)
    expect(S().items[0]).toMatchObject({ stockQty: 2, stockValueMinor: 67 })
    const last = post(2)
    expect(last.totalCostMinor).toBe(67); expect(last.lines[0].costTotalMinor).toBe(67)
    expect(S().items[0]).toMatchObject({ stockQty: 0, stockValueMinor: 0 })
    expect(S().journal.map(j => j.lines.find(l => l.accountCode === '1103')?.credit)).toEqual([33, 67])
  })
  it.each(['', '2026-02-30', '2026-11-04', '2026-11-06'])('يرفض التاريخ غير المتاح %s دون تغيير', date => {
    const before = S(); expect(() => post(1, date)).toThrow(/تاريخ/)
    expect(S()).toBe(before)
  })
  it.each([NaN, Infinity, 0, -1, 0.0001, 1.0001, 4])('يرفض كمية غير صالحة %s بلا تغيير', qty => {
    const before = S(); expect(() => post(qty)).toThrow(); expect(S()).toBe(before)
  })
  it('يرفض الفترة المقفلة والصلاحية المفقودة', () => {
    useAppStore.setState({ fiscalYears: [{ id: 1, nameAr: 'مقفلة', startDate: '2026-01-01', endDate: '2026-12-31', status: 'closed' }] })
    const before = S(); expect(() => post(1)).toThrow(/مقفلة/); expect(S()).toBe(before)
    useAppStore.setState({ fiscalYears: [] }); useRawDataStore.setState({ currentUserId: 999 })
    const before2 = S(); expect(() => post(1)).toThrow(/صلاحية/); expect(S()).toBe(before2)
  })
  it('لا يصرف رصيد المخزن الآخر أو دفعاته', () => {
    useRawDataStore.setState({ transfers: [{ fromWarehouseId: 1, toWarehouseId: 2, lines: [{ itemId: 5, qty: 2 }] }] as never })
    const before = S(); expect(() => post(2)).toThrow(/المخزن/); expect(S()).toBe(before)
    useRawDataStore.setState({ transfers: [], items: [{ ...item, trackExpiry: true }] as never, batches: [{ id: 10, itemId: 5, warehouseId: 2, expiryDate: '2026-10-01', qty: 3, purchaseId: null, receivedAt: '2026-01-01' }] })
    const before2 = S(); expect(() => post(1)).toThrow(/دفعات/); expect(S()).toBe(before2)
  })
  it('يخصم الدفعة الأقرب في المخزن ويحفظ أثرها', () => {
    useRawDataStore.setState({ items: [{ ...item, trackExpiry: true }] as never, batches: [{ id: 10, itemId: 5, warehouseId: 1, expiryDate: '2026-10-01', qty: 1, purchaseId: null, receivedAt: '2026-01-01' }, { id: 11, itemId: 5, warehouseId: 1, expiryDate: '2026-12-01', qty: 2, purchaseId: null, receivedAt: '2026-01-01' }] })
    const doc = post(1); expect(doc.lines[0].batchAllocations).toEqual([{ batchId: 10, qty: 1 }]); expect(S().batches.map(b => b.qty)).toEqual([0, 2])
  })
  it('يحجب السيريال والدفعات القديمة مجهولة المخزن', () => {
    useRawDataStore.setState({ items: [{ ...item, trackSerial: true }] as never }); const before = S()
    expect(() => post(1)).toThrow(/السيريال/); expect(S()).toBe(before)
    useRawDataStore.setState({ items: [item] as never, batches: [{ id: 10, itemId: 5, expiryDate: null, qty: 3, purchaseId: null, receivedAt: '2026-01-01' }] }); const before2 = S()
    expect(() => post(1)).toThrow(/دفعات/); expect(S()).toBe(before2)
  })
})

it('يقرأ المستند القديم بلا تكلفة سطر دقيقة دون تغيير حسابه', async () => {
  const { wastageTotalMinor } = await import('../src/core/wastage.ts')
  const { consumptionTotalMinor } = await import('../src/core/consumption.ts')
  const legacy = [{ itemId: 5, nameAr: 'صنف', qty: 2, unitCostMinor: 33 }]
  expect(wastageTotalMinor(legacy)).toBe(66); expect(consumptionTotalMinor(legacy)).toBe(66)
})
it('يرفض نطاق كل الفروع دون فرع محدد', () => {
  useRawDataStore.setState({ branches: [{ id: 1, nameAr: 'رئيسي', isMain: true, active: true, warehouseId: 1, treasuryCode: '1101' }, { id: 2, nameAr: 'آخر', isMain: false, active: true, warehouseId: 2, treasuryCode: '1121' }] as never, activeBranchId: null })
  const before = S(); expect(() => S().postWastage({ reason: 'تالف', notes: '', lines: [{ itemId: 5, qty: 1 }] })).toThrow(/الفرع/); expect(S()).toBe(before)
})
