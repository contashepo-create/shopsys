import { beforeEach, expect, it, vi } from 'vitest'
vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

const { EMPTY_EXTENDED, useDataStore, useRawDataStore } = await import('../src/data/repo.ts')
const { useAppStore } = await import('../src/stores/app.store.ts')
const { undatedBatches } = await import('../src/core/batches.ts')

const initial = useRawDataStore.getState()
const app = useAppStore.getState()

beforeEach(() => {
  useAppStore.getState().setActiveBranchContext(null)
  useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'SA', allowNegativeTreasury: true } })
  useRawDataStore.setState({
    ...initial, branches: [], activeBranchId: null,
    items: [], suppliers: [], purchases: [], purchaseReturns: [], sales: [], saleReturns: [],
    journal: [], batches: [], serials: [], transfers: [],
    warehouses: [{ id: 1, nameAr: 'مخزن', isMain: true }] as never,
  })
})

const setup = (trackExpiry: boolean) => {
  const s = useDataStore.getState()
  s.addSupplier({ ...EMPTY_EXTENDED, nameAr: 'مورد', phone: '', notes: '' })
  s.addItem({ nameAr: 'لبن', sku: 'MILK-1', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 0, stockQty: 0, priceMinor: 500, minQty: 0, trackExpiry, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
  return useRawDataStore.getState().items[0]
}

const purchase = (itemId: number, expiryDate?: string) => useDataStore.getState().postPurchase({
  supplierId: useRawDataStore.getState().suppliers[0].id,
  date: '2026-01-01',
  lines: [{ itemId, qty: 5, unitPriceMinor: 100, warehouseId: 1, ...(expiryDate ? { expiryDate } : {}) }],
  expenses: [], paidMinor: 0, notes: '',
})

/**
 * الصلاحية ليست إلزامية عند الاستلام (خام يُفرز لاحقاً بتواريخ مخرجات)، لكن
 * الدفعة بلا تاريخ لا تدخل FEFO ولا تنبيهات الانتهاء — فكانت تمرّ بصمت.
 * الحل: تظهر في تقرير «دفعات بلا تاريخ» + تحذير صريح قبل الترحيل.
 */
it('استلام بلا تاريخ مسموح لكن الدفعة تُصنَّف «بلا تاريخ» في التقرير', () => {
  const item = setup(true)
  const p = purchase(item.id)
  const batch = useRawDataStore.getState().batches.find((b) => b.purchaseId === p.id)!
  expect(batch.expiryDate).toBeNull()
  const rows = undatedBatches(useRawDataStore.getState().batches, (id) => (id === item.id ? 'لبن' : '—'))
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ itemId: item.id, nameAr: 'لبن', qty: 5 })
})

it('بتاريخ صالح لا تظهر في «بلا تاريخ»', () => {
  const item = setup(true)
  purchase(item.id, '2099-12-31')
  expect(undatedBatches(useRawDataStore.getState().batches, () => 'لبن')).toEqual([])
})

it('تاريخ غير صالح يُرفض بلا أي أثر', () => {
  const item = setup(true)
  const before = useRawDataStore.getState()
  expect(() => purchase(item.id, '2026-13-45')).toThrow(/تاريخ صلاحية غير صحيح/)
  const after = useRawDataStore.getState()
  expect(after.purchases).toBe(before.purchases)
  expect(after.batches).toBe(before.batches)
  expect(after.journal).toBe(before.journal)
})

it('صنف لا يتتبع الصلاحية لا يظهر في التقرير أصلاً', () => {
  const item = setup(false)
  purchase(item.id)
  expect(undatedBatches(useRawDataStore.getState().batches, () => 'أرز')).toEqual([])
})

it('الدفعة المستهلكة بالكامل لا تُلوّث تقرير «بلا تاريخ»', () => {
  const item = setup(true)
  const p = purchase(item.id)
  const batch = useRawDataStore.getState().batches.find((b) => b.purchaseId === p.id)!
  useRawDataStore.setState((state) => ({ batches: state.batches.map((b) => (b.id === batch.id ? { ...b, qty: 0 } : b)) }))
  expect(undatedBatches(useRawDataStore.getState().batches, () => 'لبن')).toEqual([])
})
