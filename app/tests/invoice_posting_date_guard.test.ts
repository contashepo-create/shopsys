import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRawDataStore } from '../src/data/repo.ts'
import { draftFromCategory } from '../src/core/items.ts'
import { useAppStore } from '../src/stores/app.store.ts'

const original = useRawDataStore.getState(), app = useAppStore.getState()
const sale = (date: string) => ({ lines: [{ itemId: 1, nameAr: 'صنف', qty: 1, unitPriceMinor: 1000, unitCostMinor: 100, discountPercent: 0, soldByWeight: false }], customerId: null, payment: 'cash' as const, invoiceDiscountPercent: 0, taxPercent: 15, taxInclusive: false, documentDate: date })
const purchase = (date: string) => ({ supplierId: 0, date, lines: [{ itemId: 1, qty: 1, unitPriceMinor: 100, vatPercent: 15 }], expenses: [], paidMinor: 115, notes: '' })
beforeEach(() => {
 vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 5, 12))
 const setup = { ...app.setup, completed: true, requireOpenShiftForSales: false, allowNegativeTreasury: true }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [], approvals: { ...app.approvals, enabled: false } })
 useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: null, branches: [], items: [{ ...draftFromCategory(undefined, 'A'), id: 1, nameAr: 'صنف', costMinor: 100, priceMinor: 1000, stockQty: 10, isService: false }], sales: [], purchases: [], journal: [], shifts: [], warehouses: [], treasuries: [{ code: '1101', nameAr: 'الخزينة', kind: 'cash', openingBalanceMinor: 100000, isDefault: true }] as never, serials: [], batches: [] })
})
afterEach(() => { useRawDataStore.setState(original); useAppStore.setState(app); vi.useRealTimers() })
describe('تاريخ ترحيل فواتير البيع والشراء', () => {
 it.each(['2026-11-06', '2099-01-01', '2026-02-30', '2026-11-05garbage'])('يرفض مستقبلاً أو تاريخاً غير صالح %s بلا فاتورة أو قيد', date => {
  const state = useRawDataStore.getState()
  expect(() => state.postSale(sale(date))).toThrow(/تاريخ الفاتورة/)
  expect(() => state.postPurchase(purchase(date))).toThrow(/تاريخ الفاتورة/)
  expect(useRawDataStore.getState().sales).toHaveLength(0)
  expect(useRawDataStore.getState().purchases).toHaveLength(0)
  expect(useRawDataStore.getState().journal).toHaveLength(0)
 })
 it.each(['2026-11-05', '2026-11-04', '2026-11-03'])('يقبل اليوم أو الماضي المفتوح %s ويؤرخ القيد', date => {
  const state = useRawDataStore.getState()
  const sold = state.postSale(sale(date)), bought = state.postPurchase(purchase(date))
  expect(sold.date.slice(0, 10)).toBe(date); expect(bought.date).toBe(date)
  expect(useRawDataStore.getState().journal.filter(row => row.sourceType === 'sale' || row.sourceType === 'purchase').map(row => row.date)).toEqual([date, date])
  expect(useRawDataStore.getState().journal.find(row => row.sourceType === 'sale')?.createdAt.slice(0, 10)).toBe('2026-11-05')
  expect(useRawDataStore.getState().journal.find(row => row.sourceType === 'purchase')?.createdAt.slice(0, 10)).toBe('2026-11-05')
 })
 it('يسمح بختم شراء قديم صحيح ويحرس يومه ويطبع يوم القيد', () => {
  const state = useRawDataStore.getState()
  expect(() => state.postSale(sale('2026-11-05T00:00:00Z'))).toThrow(/غير صالح/)
  expect(() => state.postPurchase(purchase('2026-11-06T00:00:00Z'))).toThrow(/المستقبل/)
  expect(() => state.postPurchase(purchase('2026-02-30T00:00:00Z'))).toThrow(/غير صالح/)
  const doc = state.postPurchase(purchase('2026-11-04T23:59:00Z'))
  expect(doc.date).toBe('2026-11-04T23:59:00Z')
  expect(useRawDataStore.getState().journal[0].date).toBe('2026-11-04')
 })
 it('يرفض الماضي داخل السنة المقفلة قبل إنشاء طلب اعتماد أو حركة', () => {
  useAppStore.setState({ fiscalYears: [{ id: 1, nameAr: 'مقفلة', startDate: '2026-01-01', endDate: '2026-11-04', status: 'closed' }], approvals: { ...app.approvals, enabled: true, scope: ['sale', 'purchase'], thresholdMinor: 0 } })
  const state = useRawDataStore.getState()
  expect(() => state.postSale(sale('2026-11-04'))).toThrow(/مقفلة/)
  expect(() => state.postPurchase(purchase('2026-11-04'))).toThrow(/مقفلة/)
  expect(() => state.postPurchase(purchase('2026-11-04T23:59:00Z'))).toThrow(/مقفلة/)
  expect(useRawDataStore.getState().docApprovals).toEqual(original.docApprovals)
  expect(useRawDataStore.getState().journal).toHaveLength(0)
 })
})
