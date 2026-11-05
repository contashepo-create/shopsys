import { beforeEach, expect, it } from 'vitest'
import { EMPTY_EXTENDED, useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'

const initial = useRawDataStore.getState(), app = useAppStore.getState()
beforeEach(() => {
  useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true } })
  useRawDataStore.setState({ ...initial, branches: [], activeBranchId: null, customers: [], suppliers: [], items: [], sales: [], vouchers: [], purchases: [], journal: [], fxConversions: [] })
})
const incoming = () => useDataStore.getState().postVoucher({ kind: 'receipt', treasury: '1101', counterAccountCode: '4101', amountMinor: 2000, description: 'حيازة', fx: { currencyCode: 'USD', amountMinor: 200, ratePpm: 10000000, decimals: 2 }, bookDecimals: 2, bookCurrencyCode: 'EGP' })
const payment = (rate = 15000000) => useDataStore.getState().postVoucher({ kind: 'payment', treasury: '1101', counterAccountCode: '5108', amountMinor: rate / 10000, description: 'صرف', fx: { currencyCode: 'USD', amountMinor: 100, ratePpm: rate, decimals: 2 }, bookDecimals: 2, bookCurrencyCode: 'EGP' })

it.each([[15000000, 4117, 500, 'credit'], [5000000, 5119, 500, 'debit'], [10000000, 0, 0, 'credit']] as const)('يرحل سند الصرف بتكلفة الحيازة والفارق مع السعر %i', (rate, account, difference, side) => {
  incoming()
  const doc = payment(rate), s = useDataStore.getState()
  const entry = s.journal.find(row => row.id === doc.journalEntryId)!
  expect(entry.lines.find(l => l.accountCode === '1101')?.credit).toBe(1000)
  if (account) expect(entry.lines.find(l => l.accountCode === String(account))?.[side]).toBe(difference)
  expect(entry.lines.reduce((sum, l) => sum + l.debit - l.credit, 0)).toBe(0)
  expect(s.getFxHoldings()).toEqual(expect.arrayContaining([expect.objectContaining({ amountMinor: 100, bookValueMinor: 1000 })]))
  expect(() => s.convertFx({ fromCurrency: 'USD', fromDecimals: 2, fromTreasury: '1101', fromAmountMinor: 100, toCurrency: 'EGP', toDecimals: 2, toTreasury: '1101', fromRatePpm: 10000000, toRatePpm: 1000000, feeMinor: 0 })).not.toThrow()
})

it('يرفض صرف عملة لا يثبت رصيدها دون كتابة', () => {
  const before = useRawDataStore.getState()
  expect(() => payment()).toThrow(/رصيد.*عملة|رصيد.*USD/)
  expect(useRawDataStore.getState().journal).toBe(before.journal)
})

it('يسجل فاتورة الشراء بتكلفة الحيازة ويترك دين المورد بالسعر المتفق', () => {
  incoming(); const s = useDataStore.getState()
  s.addSupplier({ ...EMPTY_EXTENDED, nameAr: 'مورد', phone: '', notes: '' })
  const item = s.ensureServiceItemForFreeLine({ nameAr: 'صنف' })
  const doc = s.postPurchase({ supplierId: s.suppliers.at(-1)?.id ?? useDataStore.getState().suppliers.at(-1)!.id, date: '2026-01-01', lines: [{ itemId: item, qty: 1, unitPriceMinor: 3000 }], expenses: [], paidMinor: 1500, treasury: '1101', notes: '', fx: { currencyCode: 'USD', amountMinor: 100, ratePpm: 15000000, decimals: 2 }, bookDecimals: 2, bookCurrencyCode: 'EGP' })
  const entry = useDataStore.getState().journal.find(row => row.id === doc.journalEntryId)!
  expect(entry.lines.find(l => l.accountCode === '1101')?.credit).toBe(1000)
  expect(entry.lines.find(l => l.accountCode === '4117')?.credit).toBe(500)
  expect(entry.lines.find(l => l.accountCode === '2101')?.credit).toBe(1500)
})

it('يمنع عكس سند عملة قبل إعادة معالجة الحركات اللاحقة من نفس الرصيد', () => {
  const receipt = incoming(); payment(10000000)
  const s = useDataStore.getState(), before = useRawDataStore.getState()
  expect(() => s.reverseEntry(receipt.journalEntryId, 'تصحيح')).toThrow(/حركات.*لاحقة/)
  expect(useRawDataStore.getState().journal).toBe(before.journal)
  expect(useRawDataStore.getState().vouchers).toBe(before.vouchers)
})

it('لا يعتمد تكلفة ساق جديدة إذا ضاع قيدها أو تغيّرت بنوده', () => {
  incoming(); const doc = payment(); const state = useRawDataStore.getState()
  useRawDataStore.setState({ journal: state.journal.filter(entry => entry.id !== doc.journalEntryId) })
  expect(() => useDataStore.getState().getFxFlows()).toThrow(/قيد.*الصرف|قيد.*السند|قيد.*عملة/)
  useRawDataStore.setState({ journal: state.journal.map(entry => entry.id !== doc.journalEntryId ? entry : { ...entry, lines: entry.lines.map(line => line.accountCode === '1101' ? { ...line, credit: line.credit + 1 } : line) }) })
  expect(() => useDataStore.getState().getFxFlows()).toThrow(/قيد.*الصرف|قيد.*السند|قيد.*عملة/)
})

it('يسمح بعكس آخر صرف ثم عكس آخر قبض ويحافظ على الرصيد', () => {
  const receipt = incoming(), pay = payment(), s = useDataStore.getState()
  s.reverseVoucher(pay.id, 'تصحيح الصرف')
  expect(s.getFxHoldings()[0]).toMatchObject({ amountMinor: 200, bookValueMinor: 2000 })
  s.reverseVoucher(receipt.id, 'تصحيح القبض')
  expect(s.getFxHoldings()).toEqual([])
})

it('لا يصرف بناء على قبض أجنبي فقد قيده', () => {
  const receipt = incoming()
  useRawDataStore.setState(state => ({ journal: state.journal.filter(e => e.id !== receipt.journalEntryId) }))
  const before = useRawDataStore.getState()
  expect(() => payment()).toThrow(/قيد.*عملة/)
  expect(useRawDataStore.getState().vouchers).toBe(before.vouchers)
  expect(useRawDataStore.getState().journal).toBe(before.journal)
})

it('لا يعتمد تحويل عملة فقد قيده عند احتساب الرصيد', () => {
  incoming(); const s = useDataStore.getState()
  const conversion = s.convertFx({ fromCurrency: 'USD', fromDecimals: 2, fromTreasury: '1101', fromAmountMinor: 100, toCurrency: 'EGP', toDecimals: 2, toTreasury: '1101', fromRatePpm: 10000000, toRatePpm: 1000000, feeMinor: 0 })
  useRawDataStore.setState(state => ({ journal: state.journal.filter(e => e.id !== conversion.journalEntryId) }))
  expect(() => s.getFxHoldings()).toThrow(/قيد.*عملة/)
})

it('لا يخفي سند عملة بعلامة عكس بلا قيد عاكس مثبت', () => {
  const receipt = incoming()
  useRawDataStore.setState(state => ({ vouchers: state.vouchers.map(v => v.id === receipt.id ? { ...v, reversalEntryId: 999 } : v) }))
  expect(() => useDataStore.getState().getFxFlows()).toThrow(/عكس.*عملة|عملة.*عكس/)
})

it('لا يعتمد قيود تحويل متوازنة لكنها لا تطابق مستند العملة', () => {
  incoming(); const s = useDataStore.getState()
  const conversion = s.convertFx({ fromCurrency: 'USD', fromDecimals: 2, fromTreasury: '1101', fromAmountMinor: 100, toCurrency: 'EGP', toDecimals: 2, toTreasury: '1101', fromRatePpm: 10000000, toRatePpm: 1000000, feeMinor: 0 })
  useRawDataStore.setState(state => ({ journal: state.journal.map(e => e.id !== conversion.journalEntryId ? e : { ...e, lines: e.lines.map(line => ({ ...line, debit: line.debit ? line.debit + 1 : 0, credit: line.credit ? line.credit + 1 : 0 })) }) }))
  expect(() => s.getFxHoldings()).toThrow(/قيد.*عملة/)
})

it('يرفض مستند عملة على حساب مقابل يساوي الخزينة فلا ينشئ رصيداً وهمياً', () => {
  const before = useRawDataStore.getState()
  expect(() => useDataStore.getState().postVoucher({ kind: 'receipt', treasury: '1101', counterAccountCode: '1101', amountMinor: 2000, description: '', fx: { currencyCode: 'USD', amountMinor: 200, ratePpm: 10000000, decimals: 2 }, bookDecimals: 2, bookCurrencyCode: 'EGP' })).toThrow(/الخزينة|الحساب/)
  expect(useRawDataStore.getState().vouchers).toBe(before.vouchers)
})
