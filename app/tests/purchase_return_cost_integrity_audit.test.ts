import { beforeEach, expect, it } from 'vitest'
import { EMPTY_EXTENDED, useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const initial = useRawDataStore.getState(), app = useAppStore.getState()
beforeEach(() => {
  useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true } })
  useRawDataStore.setState({ ...initial, branches: [], activeBranchId: null, items: [], suppliers: [], purchases: [], purchaseReturns: [], sales: [], saleReturns: [], journal: [] })
})
function fixture() {
  const s = useDataStore.getState()
  s.addSupplier({ ...EMPTY_EXTENDED, nameAr: 'مورد', phone: '', notes: '' })
  s.addItem({ nameAr: 'صنف', sku: '', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 0, stockQty: 0, priceMinor: 1000, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
  const state = useDataStore.getState(), item = state.items[0], supplier = state.suppliers[0]
  const purchase = (amount: number) => s.postPurchase({ supplierId: supplier.id, date: '2026-01-01', lines: [{ itemId: item.id, qty: 1, unitPriceMinor: amount }], expenses: [], paidMinor: 0, treasury: '1101', notes: '' })
  const expensive = purchase(100), cheap = purchase(1)
  return { s, item, supplier, expensive, cheap }
}
it('يسحب تكلفة المخزون الفعلية ويفصل فرق تكلفة مرتجع الشراء من مستحق المورد', () => {
  const { s, item, supplier, expensive, cheap } = fixture()
  const first = s.postPurchaseReturn({ purchaseId: expensive.id, qtyByItem: new Map([[item.id, 1]]), refund: 'debt', reason: 'رد' })
  const entry = useDataStore.getState().journal.find(e => e.id === first.journalEntryId)!
  expect(entry.lines.find(l => l.accountCode === '2101')?.debit).toBe(100)
  expect(entry.lines.find(l => l.accountCode === '1103')?.credit).toBe(51)
  expect(entry.lines.find(l => l.accountCode === '5101')?.credit).toBe(49)
  expect(useDataStore.getState().items[0]).toMatchObject({ stockQty: 1, stockValueMinor: 50 })
  expect(s.getSupplierBalance(supplier.id)).toBe(1)
  const second = s.postPurchaseReturn({ purchaseId: cheap.id, qtyByItem: new Map([[item.id, 1]]), refund: 'debt', reason: 'رد' })
  const entry2 = useDataStore.getState().journal.find(e => e.id === second.journalEntryId)!
  expect(entry2.lines.find(l => l.accountCode === '2101')?.debit).toBe(1)
  expect(entry2.lines.find(l => l.accountCode === '1103')?.credit).toBe(50)
  expect(entry2.lines.find(l => l.accountCode === '5101')?.debit).toBe(49)
  expect(useDataStore.getState().items[0]).toMatchObject({ stockQty: 0, stockValueMinor: 0 })
  expect(s.getSupplierBalance(supplier.id)).toBe(0)
})
it('يرفض قيمة مخزون تالفة دون تقريـبها أو كتابة مرتجع', () => {
  const { s, item, expensive } = fixture()
  useRawDataStore.setState(state => ({ items: state.items.map(row => ({ ...row, stockValueMinor: -10 })) }))
  const before = useRawDataStore.getState()
  expect(() => s.postPurchaseReturn({ purchaseId: expensive.id, qtyByItem: new Map([[item.id, 1]]), refund: 'debt', reason: 'رد' })).toThrow(/قيمة المخزون/)
  expect(useRawDataStore.getState().journal).toBe(before.journal)
  expect(useRawDataStore.getState().purchaseReturns).toBe(before.purchaseReturns)
})
it('يحافظ على قيمة المخزون عندما يكون الجزء المسحوب بتكلفة مقربة صفر', () => {
  const { s, item, expensive } = fixture()
  useRawDataStore.setState(state => ({ items: state.items.map(row => row.id === item.id ? { ...row, stockQty: 200, stockValueMinor: 1, costMinor: 0 } : row) }))
  const ret = s.postPurchaseReturn({ purchaseId: expensive.id, qtyByItem: new Map([[item.id, 1]]), refund: 'debt', reason: 'رد' })
  expect(ret.inventoryOutMinor).toBe(0)
  expect(useDataStore.getState().items[0]).toMatchObject({ stockQty: 199, stockValueMinor: 1 })
  const lines = useDataStore.getState().journal.find(entry => entry.id === ret.journalEntryId)!.lines
  expect(lines.find(line => line.accountCode === '5101')?.credit).toBe(100)
  expect(lines.reduce((n, line) => n + line.debit - line.credit, 0)).toBe(0)
})
it('لا يرحّل استرداداً نقدياً لخزينة شبح أو متكررة', () => {
 const { s, item, expensive } = fixture(), before = useRawDataStore.getState()
 expect(() => s.postPurchaseReturn({ purchaseId: expensive.id, qtyByItem: new Map([[item.id, 1]]), refund: 'cash', treasury: '5101', reason: 'رد' })).toThrow(/خزينة|الخزينة/)
 expect(useRawDataStore.getState().journal).toBe(before.journal)
 expect(useRawDataStore.getState().items).toBe(before.items)
})
it('لا يتجاوز سقف ذمة المورد بتمرير نوع استرداد غير صالح', () => {
 const { s, item, expensive } = fixture(), before = useRawDataStore.getState()
 expect(() => s.postPurchaseReturn({ purchaseId: expensive.id, qtyByItem: new Map([[item.id, 1]]), refund: 'invalid', reason: 'رد' } as never)).toThrow(/استرداد|رد/)
 expect(useRawDataStore.getState().journal).toBe(before.journal)
 expect(useRawDataStore.getState().items).toBe(before.items)
})
it('يرفض حساب خزينة مكرراً دون أثر مالي أو مخزني', () => {
 const { s, item, expensive } = fixture()
 useRawDataStore.setState(state => ({ treasuries: [...state.treasuries, { ...state.treasuries.find(t => t.code === '1101')! }] }))
 const before = useRawDataStore.getState()
 expect(() => s.postPurchaseReturn({ purchaseId: expensive.id, qtyByItem: new Map([[item.id, 1]]), refund: 'cash', treasury: '1101', reason: 'رد' })).toThrow(/خزينة|فريدة/)
 expect(useRawDataStore.getState().journal).toBe(before.journal)
})
it('يقبل استرداداً لخزينة مسجلة بعد تحديد الصنف والكمية', () => {
 const { s, item, expensive } = fixture()
 const ret = s.postPurchaseReturn({ purchaseId: expensive.id, qtyByItem: new Map([[item.id, 1]]), refund: 'cash', treasury: '1101', reason: 'رد' })
 expect(useRawDataStore.getState().journal.find(entry => entry.id === ret.journalEntryId)?.lines.some(line => line.accountCode === '1101' && line.debit === 100)).toBe(true)
})
