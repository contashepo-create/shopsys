import { beforeEach, expect, it } from 'vitest'
import { EMPTY_EXTENDED, useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'

const initial = useRawDataStore.getState()
const app = useAppStore.getState()
beforeEach(() => {
  useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true } })
  useRawDataStore.setState({ ...initial, branches: [], activeBranchId: null, customers: [], items: [], sales: [], vouchers: [], purchases: [], journal: [], fxConversions: [] })
})

it('يحسب تكلفة دينار كويتي ثلاثي الكسور دون ربح صرف وهمي', () => {
  const s = useDataStore.getState()
  s.addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل', phone: '', creditLimitMinor: 0, notes: '' })
  const customer = useDataStore.getState().customers[0]
  const item = s.ensureServiceItemForFreeLine({ nameAr: 'خدمة' })
  s.postSale({ lines: [{ itemId: item, nameAr: 'خدمة', qty: 1, unitPriceMinor: 10000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }], customerId: customer.id, payment: 'cash', treasury: '1101', paidMinor: 10000, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, fx: { currencyCode: 'KWD', amountMinor: 1000, ratePpm: 100000000, decimals: 3 }, bookDecimals: 2, bookCurrencyCode: 'EGP' })
  expect(s.getFxHoldings().find(h => h.currency === 'KWD')).toMatchObject({ amountMinor: 1000, decimals: 3, bookValueMinor: 10000, avgRatePpm: 100000000 })
  const doc = s.convertFx({ fromCurrency: 'KWD', fromDecimals: 3, fromTreasury: '1101', fromAmountMinor: 1000, toCurrency: 'EGP', toDecimals: 2, toTreasury: '1101', fromRatePpm: 100000000, toRatePpm: 1000000, feeMinor: 0 })
  expect(doc.gainMinor).toBe(0)
  expect(doc.lossMinor).toBe(0)
  expect(s.getFxHoldings().some(h => h.currency === 'KWD')).toBe(false)
})

it('يوقف التحويل الجديد إذا كان متوسط تحويل قديم غير مطابق ولا يمس السجل', () => {
  const s = useDataStore.getState()
  s.addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل', phone: '', creditLimitMinor: 0, notes: '' })
  const itemId = s.ensureServiceItemForFreeLine({ nameAr: 'خدمة' })
  s.postSale({ lines: [{ itemId, nameAr: 'خدمة', qty: 1, unitPriceMinor: 20000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }], customerId: useDataStore.getState().customers[0].id, payment: 'cash', treasury: '1101', paidMinor: 20000, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, fx: { currencyCode: 'KWD', amountMinor: 2000, ratePpm: 100000000, decimals: 3 }, bookDecimals: 2, bookCurrencyCode: 'EGP' })
  const args = { fromCurrency: 'KWD', fromDecimals: 3 as const, fromTreasury: '1101', fromAmountMinor: 1000, toCurrency: 'EGP', toDecimals: 2 as const, toTreasury: '1101', fromRatePpm: 100000000, toRatePpm: 1000000, feeMinor: 0 }
  s.convertFx(args)
  useRawDataStore.setState(state => ({ fxConversions: state.fxConversions.map(row => ({ ...row, acquisitionRatePpm: 10000000, gainMinor: 9000 })) }))
  const journal = useRawDataStore.getState().journal
  const docs = useRawDataStore.getState().fxConversions
  expect(() => s.convertFx(args)).toThrow(/تحويلات عملة سابقة تحتاج مراجعة/)
  expect(useRawDataStore.getState().journal).toBe(journal)
  expect(useRawDataStore.getState().fxConversions).toBe(docs)
})

it('يرفض تغيير خانات الرصيد ويترك اليومية كما هي', () => {
  const s = useDataStore.getState()
  s.addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل', phone: '', creditLimitMinor: 0, notes: '' })
  const itemId = s.ensureServiceItemForFreeLine({ nameAr: 'خدمة' })
  s.postSale({ lines: [{ itemId, nameAr: 'خدمة', qty: 1, unitPriceMinor: 10000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }], customerId: useDataStore.getState().customers[0].id, payment: 'cash', treasury: '1101', paidMinor: 10000, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, fx: { currencyCode: 'KWD', amountMinor: 1000, ratePpm: 100000000, decimals: 3 }, bookDecimals: 2, bookCurrencyCode: 'EGP' })
  const journal = useRawDataStore.getState().journal
  expect(() => s.convertFx({ fromCurrency: 'KWD', fromDecimals: 2, fromTreasury: '1101', fromAmountMinor: 100, toCurrency: 'EGP', toDecimals: 2, toTreasury: '1101', fromRatePpm: 100000000, toRatePpm: 1000000, feeMinor: 0 })).toThrow(/خانات العملة/)
  expect(useRawDataStore.getState().journal).toBe(journal)
})

it('يحسب كسور العملة والدفتر معاً في متوسط التكلفة وفي التدفقات المختلطة', async () => {
  const { fxHoldingsFromFlows, fxConversionFlows } = await import('../src/core/fxTreasury.ts')
  const flow = { date: '2026-01-01', seq: 1, treasury: '1101', currency: 'USD', decimals: 2 as const, amountMinor: 200, bookValueMinor: 2600, kind: 'in' as const, ref: 'A' }
  // 2 USD = 2600 IQD، عملة الدفتر بلا كسور؛ المتوسط 1300 IQD/USD.
  expect(fxHoldingsFromFlows([flow], 0)[0]).toMatchObject({ decimals: 2, avgRatePpm: 1300000000 })
  const doc = { id: 1, docNumber: 'FXC-1', date: '2026-01-01', fromCurrency: 'USD', fromDecimals: 2 as const, toCurrency: 'KWD', toDecimals: 3 as const, fromTreasury: '1101', toTreasury: '1102', fromAmountMinor: 100, toAmountMinor: 300, fromRatePpm: 1300000000, toRatePpm: 4333333333, acquisitionRatePpm: 1300000000, feeMinor: 0, gainMinor: 0, lossMinor: 0, journalEntryId: 2, createdBy: '', createdAt: '' }
  const conversions = fxConversionFlows(doc, 'IQD', 0)
  expect(conversions.map(x => x.decimals)).toEqual([2, 3])
  expect(fxHoldingsFromFlows([flow, ...conversions], 0)).toEqual(expect.arrayContaining([expect.objectContaining({ currency: 'USD', amountMinor: 100, avgRatePpm: 1300000000 }), expect.objectContaining({ currency: 'KWD', decimals: 3, amountMinor: 300, bookValueMinor: 1300 })]))
  expect(() => fxHoldingsFromFlows([flow, { ...flow, seq: 3, decimals: 3 }], 0)).toThrow(/خانات العملة/)
})

it('يطابق قيمة خروج التحويل مع الحيازة بالتناسب حتى عند تقريب سعر المتوسط', async () => {
  const { computeFxConversion, fxHoldingsFromFlows } = await import('../src/core/fxTreasury.ts')
  const amount = 1927823, book = 63248585, out = 566346
  const flow = { date: '2026-01-01', seq: 1, treasury: '1101', currency: 'USD', decimals: 2 as const, amountMinor: amount, bookValueMinor: book, kind: 'in' as const, ref: 'A' }
  const holding = fxHoldingsFromFlows([flow], 2)[0]
  const exact = 18580846
  expect(exact).toBe(18580846)
  const computed = computeFxConversion({ fromCurrency: 'USD', fromDecimals: 2, toCurrency: 'EGP', toDecimals: 2, fromTreasury: '1101', toTreasury: '1101', fromAmountMinor: out, fromRatePpm: 32808295, toRatePpm: 1000000, feeMinor: 0, bookDecimals: 2, bookCurrencyCode: 'EGP', acquisitionRatePpm: holding.avgRatePpm, acquisitionBookValueMinor: exact })
  expect(computed.outBookValueMinor).toBe(exact)
  const after = fxHoldingsFromFlows([flow, { ...flow, seq: 2, kind: 'out', amountMinor: out, bookValueMinor: exact, ref: 'B' }], 2)[0]
  expect(after.bookValueMinor + computed.outBookValueMinor).toBe(book)
})

it('يسجل تكلفة التحويل الدقيقة في المستند والقيد ويعيد بناء الرصيد منها', () => {
  const s = useDataStore.getState()
  s.addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل', phone: '', creditLimitMinor: 0, notes: '' })
  const itemId = s.ensureServiceItemForFreeLine({ nameAr: 'خدمة' })
  s.postSale({ lines: [{ itemId, nameAr: 'خدمة', qty: 1, unitPriceMinor: 43578542, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }], customerId: useDataStore.getState().customers[0].id, payment: 'cash', treasury: '1101', paidMinor: 43578542, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, fx: { currencyCode: 'USD', amountMinor: 2052296, ratePpm: 21234043, decimals: 2 }, bookDecimals: 2, bookCurrencyCode: 'EGP' })
  const doc = s.convertFx({ fromCurrency: 'USD', fromDecimals: 2, fromTreasury: '1101', fromAmountMinor: 1485066, toCurrency: 'EGP', toDecimals: 2, toTreasury: '1101', fromRatePpm: 21234043, toRatePpm: 1000000, feeMinor: 0 })
  expect(doc.outBookValueMinor).toBe(31533956)
  expect(useDataStore.getState().journal.find(e => e.id === doc.journalEntryId)?.lines.some(l => l.accountCode === '1101' && l.credit === 31533956)).toBe(true)
  expect(s.getFxFlows().find(f => f.ref === doc.docNumber)?.bookValueMinor).toBe(31533956)
  expect(s.getFxHoldings().find(h => h.currency === 'USD')?.bookValueMinor).toBe(43578542 - 31533956)
  expect(() => s.convertFx({ fromCurrency: 'USD', fromDecimals: 2, fromTreasury: '1101', fromAmountMinor: 100, toCurrency: 'EGP', toDecimals: 2, toTreasury: '1101', fromRatePpm: 21234043, toRatePpm: 1000000, feeMinor: 0 })).not.toThrow()
})

it('لا يخفي صرفاً أجنبياً يفوق التدفقات المتاحة قبل دخول لاحق', async () => {
  const { fxHoldingsFromFlows } = await import('../src/core/fxTreasury.ts')
  const out = { date: '2026-01-01', seq: 1, treasury: '1101', currency: 'USD', decimals: 2 as const, amountMinor: 1000, bookValueMinor: 1000, kind: 'out' as const, ref: 'PAY-1' }
  const later = { ...out, seq: 2, amountMinor: 2000, bookValueMinor: 2000, kind: 'in' as const, ref: 'SAL-1' }
  expect(() => fxHoldingsFromFlows([out, later], 2)).toThrow(/رصيد.*غير مثبت/)
})
