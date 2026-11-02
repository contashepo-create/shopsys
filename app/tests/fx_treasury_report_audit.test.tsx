import { afterEach, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { FxTreasuryTab } from '../src/ui/pages/FxTreasuryTab.tsx'
import { EMPTY_EXTENDED, useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { usePrintPreview } from '../src/ui/components/printPreviewStore.ts'
const initial = useRawDataStore.getState(), app = useAppStore.getState()
const cur = { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: 'جنيه' }
afterEach(() => { cleanup(); useRawDataStore.setState(initial); useAppStore.setState(app); usePrintPreview.getState().closePreview() })

it('يحدث التقرير بعد البيع ويعرض كسور العملة وينبه للأسعار المفقودة ويفتح المعاينة', () => {
  useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true }, fxRates: {} })
  useRawDataStore.setState({ ...initial, branches: [], activeBranchId: null, customers: [], items: [], sales: [], vouchers: [], purchases: [], journal: [], fxConversions: [] })
  const s = useDataStore.getState()
  s.addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل', phone: '', creditLimitMinor: 0, notes: '' })
  const itemId = s.ensureServiceItemForFreeLine({ nameAr: 'خدمة' })
  const { container } = render(<FxTreasuryTab cur={cur} companyName="متجر" />)
  expect(container.querySelector('[data-fx-holding="KWD"]')).toBeNull()
  act(() => { s.postSale({ lines: [{ itemId, nameAr: 'خدمة', qty: 1, unitPriceMinor: 10000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }], customerId: useDataStore.getState().customers[0].id, payment: 'cash', treasury: '1101', paidMinor: 10000, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, fx: { currencyCode: 'KWD', amountMinor: 1000, ratePpm: 100000000, decimals: 3 }, bookDecimals: 2, bookCurrencyCode: 'EGP' }) })
  expect(container.querySelector('[data-fx-holding="KWD"]')?.textContent).toContain('1.000')
  expect(screen.getAllByText('أسعار غير مكتملة')).toHaveLength(2)
  fireEvent.click(screen.getByRole('button', { name: /طباعة/ }))
  const preview = usePrintPreview.getState()
  expect(preview.open).toBe(true)
  expect(preview.handle?.html).toContain('1.000')
  expect(preview.handle?.html).toContain('—')
})

it('يعرض التعارض التاريخي بدلاً من تقرير فارغ أو انهيار الشاشة', () => {
  useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG' }, fxRates: {} })
  useRawDataStore.setState({ ...initial, branches: [], activeBranchId: null, sales: [], purchases: [], journal: [], fxConversions: [], vouchers: [
    { id: 1, voucherNumber: 'V1', kind: 'receipt', treasury: '1101', date: '2026-01-01', journalEntryId: 1, amountMinor: 10, fx: { currencyCode: 'KWD', amountMinor: 100, decimals: 3, ratePpm: 1000000 } },
    { id: 2, voucherNumber: 'V2', kind: 'receipt', treasury: '1101', date: '2026-01-02', journalEntryId: 2, amountMinor: 100, fx: { currencyCode: 'KWD', amountMinor: 100, decimals: 2, ratePpm: 1000000 } },
  ] as never, journal: [
    { id: 1, sourceType: 'receipt_voucher', sourceId: 1, lines: [{ accountCode: '1101', debit: 10, credit: 0 }, { accountCode: '4101', debit: 0, credit: 10 }] },
    { id: 2, sourceType: 'receipt_voucher', sourceId: 2, lines: [{ accountCode: '1101', debit: 100, credit: 0 }, { accountCode: '4101', debit: 0, credit: 100 }] },
  ] as never })
  render(<FxTreasuryTab cur={cur} companyName="متجر" />)
  expect(screen.getByRole('alert').textContent).toContain('خانات العملة')
  expect(screen.queryByRole('button', { name: /طباعة/ })).toBeNull()
})

it('يظهر تنبيه التحويل التاريخي في الشاشة والمعاينة ويحجب التحويل الجديد', () => {
  useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true }, fxRates: {} })
  useRawDataStore.setState({ ...initial, branches: [], activeBranchId: null, customers: [], items: [], sales: [], vouchers: [], purchases: [], journal: [], fxConversions: [] })
  const s = useDataStore.getState()
  s.addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل', phone: '', creditLimitMinor: 0, notes: '' })
  const itemId = s.ensureServiceItemForFreeLine({ nameAr: 'خدمة' })
  s.postSale({ lines: [{ itemId, nameAr: 'خدمة', qty: 1, unitPriceMinor: 20000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }], customerId: useDataStore.getState().customers[0].id, payment: 'cash', treasury: '1101', paidMinor: 20000, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, fx: { currencyCode: 'KWD', amountMinor: 2000, ratePpm: 100000000, decimals: 3 }, bookDecimals: 2, bookCurrencyCode: 'EGP' })
  const args = { fromCurrency: 'KWD', fromDecimals: 3 as const, fromTreasury: '1101', fromAmountMinor: 1000, toCurrency: 'EGP', toDecimals: 2 as const, toTreasury: '1101', fromRatePpm: 100000000, toRatePpm: 1000000, feeMinor: 0 }
  const doc = s.convertFx(args)
  useRawDataStore.setState(state => ({ fxConversions: state.fxConversions.map(row => ({ ...row, acquisitionRatePpm: 10000000 })) }))
  render(<FxTreasuryTab cur={cur} companyName="متجر" />)
  expect(screen.getByRole('alert').textContent).toContain(doc.docNumber)
  fireEvent.click(screen.getByRole('button', { name: /طباعة/ }))
  expect(usePrintPreview.getState().handle?.html).toContain('حركات عملة سابقة تحتاج مراجعة')
  expect(usePrintPreview.getState().handle?.html).toContain(doc.docNumber)
  expect(() => s.convertFx(args)).toThrow(/مراجعة محاسبية/)
})

it('ينبه في الشاشة والمعاينة إلى سند أجنبي سابق بتكلفة غير مطابقة', () => {
  useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true }, fxRates: {} })
  useRawDataStore.setState({ ...initial, branches: [], activeBranchId: null, customers: [], items: [], sales: [], vouchers: [], purchases: [], journal: [], fxConversions: [] })
  const s = useDataStore.getState()
  s.addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل', phone: '', creditLimitMinor: 0, notes: '' })
  const itemId = s.ensureServiceItemForFreeLine({ nameAr: 'خدمة' })
  s.postSale({ lines: [{ itemId, nameAr: 'خدمة', qty: 1, unitPriceMinor: 2000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }], customerId: useDataStore.getState().customers[0].id, payment: 'cash', treasury: '1101', paidMinor: 2000, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, fx: { currencyCode: 'USD', amountMinor: 200, ratePpm: 10000000, decimals: 2 }, bookDecimals: 2, bookCurrencyCode: 'EGP' })
  const voucher = s.postVoucher({ kind: 'payment', treasury: '1101', counterAccountCode: '5108', amountMinor: 1500, description: 'صرف', fx: { currencyCode: 'USD', amountMinor: 100, ratePpm: 15000000, decimals: 2 }, bookDecimals: 2, bookCurrencyCode: 'EGP' })
  // محاكاة مستند تاريخي كان يرحّل كامل سعر السداد على الخزينة بلا قيد فرق.
  useRawDataStore.setState(state => ({ vouchers: state.vouchers.map(v => v.id === voucher.id ? { ...v, fxOutBookValueMinor: undefined } : v), journal: state.journal.map(e => e.id === voucher.journalEntryId ? { ...e, lines: e.lines.filter(l => l.accountCode !== '4117').map(l => l.accountCode === '1101' ? { ...l, credit: 1500 } : l) } : e) }))
  render(<FxTreasuryTab cur={cur} companyName="متجر" />)
  expect(screen.getByRole('alert').textContent).toContain(voucher.voucherNumber)
  fireEvent.click(screen.getByRole('button', { name: /طباعة/ }))
  expect(usePrintPreview.getState().handle?.html).toContain(voucher.voucherNumber)
})
