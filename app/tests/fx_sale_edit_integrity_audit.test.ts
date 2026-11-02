import { beforeEach, expect, it } from 'vitest'
import { EMPTY_EXTENDED, useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const initial = useRawDataStore.getState(), app = useAppStore.getState()
beforeEach(() => { useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true, allowNegativeStock: true } }); useRawDataStore.setState({ ...initial, branches: [], activeBranchId: null, customers: [], items: [], sales: [], vouchers: [], purchases: [], journal: [], fxConversions: [], employeeAdvances: [] }) })
function fixture() {
  const s = useDataStore.getState()
  s.addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل', phone: '', creditLimitMinor: 0, notes: '' })
  const customerId = useDataStore.getState().customers[0].id, item = s.ensureServiceItemForFreeLine({ nameAr: 'خدمة' })
  const line = { itemId: item, nameAr: 'خدمة', qty: 1, unitPriceMinor: 2000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }
  const sale = s.postSale({ lines: [line], customerId, payment: 'cash', treasury: '1101', paidMinor: 2000, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, fx: { currencyCode: 'USD', amountMinor: 200, ratePpm: 10000000, decimals: 2 }, bookDecimals: 2, bookCurrencyCode: 'EGP' })
  return { s, sale, line, customerId }
}
it('يعدل مضمون فاتورة مع الحفاظ على الساق الأجنبية والتحصيل نفسه حين لا توجد حركات لاحقة', () => {
  const { s, sale, line, customerId } = fixture()
  const edited = s.editSale({ saleId: sale.id, lines: [{ ...line, unitPriceMinor: 3000 }], customerId, payment: 'credit', paidMinor: 2000, treasury: '1101', invoiceDiscountPercent: 0, reason: 'تصحيح', einvoiceActive: false, allowNegativeStock: true })
  expect(edited.fx).toEqual(sale.fx)
  expect(s.getFxHoldings()[0]).toMatchObject({ amountMinor: 200, bookValueMinor: 2000 })
  expect(s.getFxFlows()[0].seq).toBe(edited.journalEntryId)
  expect(useDataStore.getState().journal.find(row => row.id === sale.journalEntryId)?.reversedByEntryId).toBeTruthy()
})
it('يرفض تعديل تحصيل العملة أو تقديم الساق على حركات لاحقة', () => {
  const { s, sale, line, customerId } = fixture()
  const args = { saleId: sale.id, lines: [line], customerId, payment: 'cash' as const, paidMinor: 2000, treasury: '1101' as const, invoiceDiscountPercent: 0, reason: 'تصحيح', einvoiceActive: false, allowNegativeStock: true }
  expect(() => s.editSale({ ...args, paidMinor: 1000 })).toThrow(/عملة أجنبية/)
  s.postVoucher({ kind: 'payment', treasury: '1101', counterAccountCode: '5108', amountMinor: 1000, description: '', fx: { currencyCode: 'USD', amountMinor: 100, ratePpm: 10000000, decimals: 2 }, bookDecimals: 2, bookCurrencyCode: 'EGP' })
  const before = useRawDataStore.getState()
  expect(() => s.editSale(args)).toThrow(/عملة أجنبية|حركات.*لاحقة/)
  expect(useRawDataStore.getState().sales).toBe(before.sales)
  expect(useRawDataStore.getState().journal).toBe(before.journal)
})
