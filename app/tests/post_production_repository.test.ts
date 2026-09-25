import { beforeEach, describe, expect, it } from 'vitest'
import { useDataStore } from '../src/data/repo.ts'

const original = useDataStore.getState()
const rawItem = { id: 1, nameAr: 'خامة', sku: 'RAW', barcodes: [], categoryId: 1, baseUnit: 'كجم', extraUnits: [], costMinor: 100, stockQty: 10, priceMinor: 150, minQty: 0, trackExpiry: true, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true, isService: false }
const productItem = { ...rawItem, id: 2, nameAr: 'منتج', sku: 'FIN', stockQty: 0, costMinor: 0, trackExpiry: true }

function seed(batches: unknown[] = []) {
  useDataStore.setState({
    ...original,
    items: [rawItem, productItem] as never,
    warehouses: [{ id: 1, nameAr: 'خامات', code: 'RAW', isMain: true }, { id: 2, nameAr: 'منتج تام', code: 'FIN', isMain: false }] as never,
    transfers: [], purchases: [], sales: [], saleReturns: [], purchaseReturns: [],
    productionOrders: [], batches: batches as never, journal: [], recipes: [],
  })
}

beforeEach(() => seed())

describe('postProduction — مسار المستودع المباشر', () => {
  it('يلزم صلاحية الناتج المتتبع قبل أي تعديل', () => {
    expect(() => useDataStore.getState().postProduction({ productItemId: 2, producedQty: 2, ingredients: [{ itemId: 1, qty: 2 }], ingredientWarehouseId: 1, outputWarehouseId: 2, date: '2026-09-24' })).toThrow(/تاريخ انتهاء/)
    expect(useDataStore.getState().productionOrders).toHaveLength(0)
  })

  it('يرفض دفعة خام منتهية ويظل الترحيل ذرياً', () => {
    seed([{ id: 1, itemId: 1, warehouseId: 1, lotNumber: 'EXPIRED', expiryDate: '2026-09-01', qty: 10, purchaseId: 1, receivedAt: '2026-01-01' }])
    expect(() => useDataStore.getState().postProduction({ productItemId: 2, producedQty: 2, ingredients: [{ itemId: 1, qty: 2 }], ingredientWarehouseId: 1, outputWarehouseId: 2, date: '2026-09-24', outputExpiryDate: '2027-01-01' })).toThrow(/منتهية/)
    expect(useDataStore.getState().items.find(item => item.id === 1)?.stockQty).toBe(10)
  })

  it('يطبق FEFO وينشئ دفعة الناتج بالتشغيلة والمخزن والصلاحية', () => {
    seed([
      { id: 1, itemId: 1, warehouseId: 1, lotNumber: 'FIRST', expiryDate: '2026-10-01', qty: 3, purchaseId: 1, receivedAt: '2026-01-01' },
      { id: 2, itemId: 1, warehouseId: 1, lotNumber: 'SECOND', expiryDate: '2026-12-01', qty: 7, purchaseId: 2, receivedAt: '2026-01-02' },
    ])
    const order = useDataStore.getState().postProduction({ productItemId: 2, producedQty: 4, ingredients: [{ itemId: 1, qty: 4 }], ingredientWarehouseId: 1, outputWarehouseId: 2, date: '2026-09-24', outputExpiryDate: '2027-01-01', outputLotNumber: 'LOT-FIN-01' })
    const state = useDataStore.getState()
    expect(state.batches.find(batch => batch.id === 1)).toBeUndefined()
    expect(state.batches.find(batch => batch.id === 2)?.qty).toBe(6)
    expect(state.batches.find(batch => batch.itemId === 2)).toMatchObject({ warehouseId: 2, lotNumber: 'LOT-FIN-01', expiryDate: '2027-01-01', qty: 4 })
    expect(order).toMatchObject({ ingredientWarehouseId: 1, outputWarehouseId: 2, outputLotNumber: 'LOT-FIN-01' })
  })

  it('لا يسمح باستخدام رصيد موجود في مخزن آخر', () => {
    useDataStore.setState({ transfers: [{ id: 1, transferNumber: 'TR-1', date: '2026-09-24', fromWarehouseId: 1, toWarehouseId: 2, lines: [{ itemId: 1, qty: 8 }], status: 'posted', notes: '' }] as never })
    expect(() => useDataStore.getState().postProduction({ productItemId: 2, producedQty: 3, ingredients: [{ itemId: 1, qty: 3 }], ingredientWarehouseId: 1, outputWarehouseId: 2, date: '2026-09-24', outputExpiryDate: '2027-01-01' })).toThrow(/خامات غير كافية/)
  })

  it('يقبل مخزناً مختلفاً لكل خامة عند اختيار كل المخازن', () => {
    useDataStore.setState({ transfers: [{ id: 1, transferNumber: 'TR-1', date: '2026-09-24', fromWarehouseId: 1, toWarehouseId: 2, lines: [{ itemId: 1, qty: 8 }], status: 'posted', notes: '' }] as never })
    const order = useDataStore.getState().postProduction({ productItemId: 2, producedQty: 4, ingredients: [{ itemId: 1, qty: 4, warehouseId: 2 }], ingredientWarehouseId: null, outputWarehouseId: 1, date: '2026-09-24', outputExpiryDate: '2027-01-01' })
    expect(order.ingredientItems?.[0]).toMatchObject({ itemId: 1, warehouseId: 2, qty: 4 })
  })

  it('يسمح بخامة سالبة فقط عند تفعيل إعداد التصنيع', () => {
    useDataStore.setState({ transfers: [{ id: 1, transferNumber: 'TR-1', date: '2026-09-24', fromWarehouseId: 1, toWarehouseId: 2, lines: [{ itemId: 1, qty: 8 }], status: 'posted', notes: '' }] as never })
    expect(() => useDataStore.getState().postProduction({ productItemId: 2, producedQty: 3, ingredients: [{ itemId: 1, qty: 3, warehouseId: 1 }], ingredientWarehouseId: null, outputWarehouseId: 2, date: '2026-09-24', outputExpiryDate: '2027-01-01' })).toThrow(/خامات غير كافية/)
    const order = useDataStore.getState().postProduction({ productItemId: 2, producedQty: 3, ingredients: [{ itemId: 1, qty: 3, warehouseId: 1 }], allowNegativeIngredients: true, ingredientWarehouseId: null, outputWarehouseId: 2, date: '2026-09-24', outputExpiryDate: '2027-01-01' })
    expect(order.ingredientItems?.[0]).toMatchObject({ warehouseId: 1, qty: 3 })
  })

  it('يعمم مخزن الصرف والمخزن المستلم على أوامر التجهيز', () => {
    useDataStore.setState({ transfers: [{ id: 1, transferNumber: 'TR-1', date: '2026-09-24', fromWarehouseId: 1, toWarehouseId: 2, lines: [{ itemId: 1, qty: 8 }], status: 'posted', notes: '' }] as never })
    const order = useDataStore.getState().postProcessing({ kind: 'butcher', sourceItemId: 1, sourceQty: 3, sourceWarehouseId: 2, outputWarehouseId: 1, outputs: [{ itemId: 2, qty: 3 }], overheadMinor: 0 })
    expect(order).toMatchObject({ sourceWarehouseId: 2, outputWarehouseId: 1 })
  })
})
