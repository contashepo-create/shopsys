import { beforeEach, expect, it } from 'vitest'
import { EMPTY_EXTENDED, useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'

const initial = useRawDataStore.getState(), app = useAppStore.getState()
beforeEach(() => {
  localStorage.setItem('shopsys-app', JSON.stringify({ state: { setup: { allowNegativeTreasury: true } } }))
  useAppStore.getState().setActiveBranchContext(null)
  const setup = { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true }
  useAppStore.setState({ ...app, setup, companySetup: setup })
  useRawDataStore.setState({ ...initial, currentUserId: null, branches: [], activeBranchId: null, items: [], suppliers: [], purchases: [], purchaseReturns: [], sales: [], saleReturns: [], journal: [], batches: [], serials: [], warehouses: [{ id: 1, nameAr: 'الرئيسي', isMain: true }] as never })
})

function setup() {
  const store = useDataStore.getState()
  store.addSupplier({ ...EMPTY_EXTENDED, nameAr: 'مورد', phone: '', notes: '' })
  store.addItem({ nameAr: 'صنف', sku: '', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 0, stockQty: 0, priceMinor: 1000, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
  return { store, item: useDataStore.getState().items[0], supplier: useDataStore.getState().suppliers[0] }
}

it.each(['supplier', 'treasury', 'payable'] as const)('يمنع ترحيل ضريبة مصروف محمل ومدفوع من %s ضمن مرتجع البضاعة دون أي كتابة', (paidBy) => {
  const { store, item, supplier } = setup()
  const p = store.postPurchase({ supplierId: supplier.id, date: '2026-01-01', lines: [{ itemId: item.id, qty: 1, unitPriceMinor: 10000, warehouseId: 1 }], expenses: [{ nameAr: 'شحن', amountMinor: 1000, method: 'value', costTreatment: 'inventory', paidBy, taxTreatment: 'exclusive', taxPercent: 14, payAccount: '1101', beneficiaryName: paidBy === 'payable' ? 'شركة النقل' : undefined }], paidMinor: 0, inputVatMinor: 0, purchaseExpenseTaxRecoverable: true, treasury: '1101', notes: '' })
  expect(p.inputVatMinor).toBe(140)
  const before = useRawDataStore.getState()
  expect(() => store.postPurchaseReturn({ purchaseId: p.id, lineSpecs: [{ lineIndex: 0, qty: 1, warehouseId: 1 }], refund: 'debt', reason: 'تصحيح' })).toThrow(/ضريبة.*مصاريف|ضريبة.*المصاريف/)
  const after = useRawDataStore.getState()
  expect(after.purchases).toBe(before.purchases)
  expect(after.purchaseReturns).toBe(before.purchaseReturns)
  expect(after.items).toBe(before.items)
  expect(after.journal).toBe(before.journal)
  expect(after.purchaseExpensePayables).toBe(before.purchaseExpensePayables)
})

it('لا يمنع مرتجع بضاعة مع مصروف محمل عندما لا توجد ضريبة مدخلات', () => {
  const { store, item, supplier } = setup()
  const p = store.postPurchase({ supplierId: supplier.id, date: '2026-01-01', lines: [{ itemId: item.id, qty: 1, unitPriceMinor: 10000, warehouseId: 1 }], expenses: [{ nameAr: 'شحن', amountMinor: 1000, method: 'value', costTreatment: 'inventory', paidBy: 'supplier' }], paidMinor: 0, treasury: '1101', notes: '' })
  const r = store.postPurchaseReturn({ purchaseId: p.id, lineSpecs: [{ lineIndex: 0, qty: 1, warehouseId: 1 }], refund: 'debt', reason: 'تصحيح' })
  expect(r.supplierValueMinor).toBe(10000)
  expect(useDataStore.getState().journal.find(entry => entry.id === r.journalEntryId)?.lines.find(line => line.accountCode === '5111')?.debit).toBe(1000)
})

it('لا يمنع مصروف فترة غير محمل على المخزون مع ضريبة البضاعة', () => {
  const { store, item, supplier } = setup()
  const p = store.postPurchase({ supplierId: supplier.id, date: '2026-01-01', lines: [{ itemId: item.id, qty: 1, unitPriceMinor: 10000, warehouseId: 1 }], expenses: [{ nameAr: 'مصروف فترة', amountMinor: 1000, method: 'value', costTreatment: 'period', paidBy: 'payable', beneficiaryName: 'شركة النقل' }], paidMinor: 0, inputVatMinor: 1400, treasury: '1101', notes: '' })
  const r = store.postPurchaseReturn({ purchaseId: p.id, lineSpecs: [{ lineIndex: 0, qty: 1, warehouseId: 1 }], refund: 'debt', reason: 'تصحيح' })
  expect(r.inputVatShareMinor).toBe(1400)
})
