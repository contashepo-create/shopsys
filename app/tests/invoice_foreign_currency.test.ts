/**
 * الفاتورة بعملة ثانية (امتداد عقد السند إلى فاتورتَي البيع والشراء).
 *
 * تحرس هذه الاختبارات ثلاث قواعد لا يجوز كسرها:
 *   ① المرحَّل بعملة الدفتر = حاصل التحويل حرفياً — وأي اختلاف يُرفض قبل الكتابة.
 *   ② الساق الأجنبية توثيق على المستند وفي وصف القيد، ولا تُنشئ أي حساب فروق عملة.
 *   ③ الذمة تنقص بالمحوَّل فقط — لا في الدفتر رقمان لنفس التحصيل.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
const { useDataStore } = await import('../src/data/repo.ts')

const S = () => useDataStore.getState()
const original = useDataStore.getState()
const USD = { currencyCode: 'USD', amountMinor: 10000, ratePpm: 48_500_000, decimals: 2 as const } // 100.00 × 48.5 = 4850.00

let customerId = 0
let supplierId = 0
let itemId = 0

beforeEach(() => {
  localStorage.setItem('shopsys-app', JSON.stringify({ state: { setup: { allowNegativeTreasury: true } } }))
  useDataStore.setState({ ...original, sales: [], purchases: [], journal: [], customers: [], suppliers: [], items: [] })
  S().addCustomer({ nameAr: 'عميل تصدير', phone: '', taxNumber: '', address: '', notes: '', isActive: true, creditLimitMinor: 0 })
  customerId = S().customers[S().customers.length - 1].id
  S().addSupplier({ nameAr: 'مورد استيراد', phone: '', taxNumber: '', address: '', notes: '', isActive: true })
  supplierId = S().suppliers[S().suppliers.length - 1].id
  S().addItem({
    nameAr: 'صنف تصدير', categoryId: null, unit: 'قطعة', priceMinor: 500000, barcode: '', sku: '', isActive: true,
    trackExpiry: false, trackSerial: false, soldByWeight: false, isService: false,
    minSalePriceMinor: 0, costMinor: 200000, stockQty: 100,
  })
  itemId = S().items[S().items.length - 1].id
})
afterEach(() => useDataStore.setState(original))

const saleArgs = (over: Record<string, unknown> = {}) => ({
  lines: [{ itemId, qty: 1, unitPriceMinor: 485000, discountPercent: 0 }],
  customerId, payment: 'cash' as const, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false,
  treasury: '1101' as const, paidMinor: 485000, bookDecimals: 2, bookCurrencyCode: 'EGP', ...over,
})

describe('فاتورة البيع بعملة ثانية', () => {
  it('يرحّل بعملة الدفتر ويحفظ الساق على المستند وفي وصف القيد', () => {
    const sale = S().postSale(saleArgs({ fx: USD }))
    expect(sale.paidMinor).toBe(485000)
    expect(sale.fx).toEqual(USD)
    const entry = S().journal.find((row) => row.id === sale.journalEntryId)!
    expect(entry.description).toContain('100.00 USD × 48.5 = 4850.00')
    expect(entry.lines.reduce((sum, line) => sum + line.debit - line.credit, 0)).toBe(0)
  })

  it('لا يُنشئ حساب فروق عملة ولا يترك ذمة على العميل', () => {
    const sale = S().postSale(saleArgs({ fx: USD }))
    const entry = S().journal.find((row) => row.id === sale.journalEntryId)!
    expect(entry.lines.some((line) => /فروق عملة/.test(line.note ?? ''))).toBe(false)
    expect(S().getCustomerBalance(customerId)).toBe(0)
  })

  it('يرفض المبلغ الذي لا يساوي حاصل التحويل بلا أثر في الدفتر', () => {
    const before = S().journal.length
    expect(() => S().postSale(saleArgs({ fx: USD, paidMinor: 400000 }))).toThrow(/لا يساوي حاصل التحويل/)
    expect(S().journal.length).toBe(before)
    expect(S().sales).toHaveLength(0)
  })

  it('يرفض عملة الدفتر نفسها ويرفض اجتماعها مع ماكينة الدفع', () => {
    expect(() => S().postSale(saleArgs({ fx: { ...USD, currencyCode: 'EGP' } }))).toThrow(/عملة الدفتر/)
    expect(() => S().postSale(saleArgs({ fx: USD, terminalPayment: { terminalId: 'x', providerReference: 'r' } }))).toThrow(/ماكينة الدفع/)
  })

  it('يقبل دفعة مقدَّمة بعملة ثلاثية الخانات على فاتورة آجلة ويترك الباقي بعملة الدفتر', () => {
    const kwd = { currencyCode: 'KWD', amountMinor: 1000, ratePpm: 157_300_000, decimals: 3 as const }
    const sale = S().postSale(saleArgs({ fx: kwd, payment: 'credit', paidMinor: 15730 }))
    expect(sale.paidMinor).toBe(15730)
    expect(S().getCustomerBalance(customerId)).toBe(485000 - 15730)
  })

  it('الفاتورة بلا عملة أجنبية تبقى كما كانت (fx فارغة ووصف القيد نظيف)', () => {
    const sale = S().postSale(saleArgs())
    expect(sale.fx).toBeNull()
    expect(S().journal.find((row) => row.id === sale.journalEntryId)!.description).not.toContain('×')
  })
})

describe('فاتورة الشراء بعملة ثانية', () => {
  const purchaseArgs = (over: Record<string, unknown> = {}) => ({
    supplierId, date: '2026-05-01', lines: [{ itemId, qty: 10, unitPriceMinor: 100000, vatPercent: 0 }],
    expenses: [], paidMinor: 485000, treasury: '1101' as const, notes: '', bookDecimals: 2, bookCurrencyCode: 'EGP', ...over,
  })

  it('ينقص دين المورد بالمحوَّل فقط ويوثق الساق في القيد', () => {
    const invoice = S().postPurchase(purchaseArgs({ fx: USD }))
    expect(invoice.paidMinor).toBe(485000)
    expect(invoice.fx).toEqual(USD)
    expect(S().journal.find((row) => row.id === invoice.journalEntryId)!.description).toContain('100.00 USD × 48.5 = 4850.00')
    expect(S().getSupplierBalance(supplierId)).toBe(1_000_000 - 485000)
  })

  it('يرفض المسدَّد المخالف لحاصل التحويل وسعر الصرف غير المعقول', () => {
    expect(() => S().postPurchase(purchaseArgs({ fx: USD, paidMinor: 100000 }))).toThrow(/لا يساوي حاصل التحويل/)
    expect(() => S().postPurchase(purchaseArgs({ fx: { ...USD, ratePpm: 0 } }))).toThrow(/سعر الصرف/)
    expect(S().purchases).toHaveLength(0)
  })
})
