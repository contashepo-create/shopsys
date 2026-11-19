/**
 * عقد محاسبة البقالة/السوبر ماركت — يدقّق المحرّك المرتبط بالنشاط من الداخل:
 * البيع (شامل/حصري الضريبة، سطور مختلطة النسب، وزن، خصم فاتورة)، الدفع
 * المجزأ، الماكينة، المرتجع، الهالك، الجرد، الشراء بالتكلفة الهابطة، والوردية.
 *
 * كل اختبار يتحقق من **القيد نفسه** لا من رقم الشاشة: 1101/1104 دائناً يقابله
 * 4101 + 2102 + 5101/1103، وكل قيد متوازن، والمخزون وقيمته الدفترية يتحركان
 * بنفس مبلغ التكلفة الذي دخل القيد — فلا ينفصل الدفتر عن الرف.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useDataStore } from '../src/data/repo.ts'
import { STANDARD_COA } from '../src/core/ledger.ts'
import { priceFloorViolations, PriceFloorError } from '../src/core/items.ts'

const original = useDataStore.getState()
const S = () => useDataStore.getState()

const POSTABLE = new Set(STANDARD_COA.filter((a) => a.isPostable).map((a) => a.code))
const GROCERY_ACCOUNTS = ['1101', '1102', '1103', '1104', '2101', '2102', '4101', '4102', '4110', '5101', '5108', '5111', '1107']

const reset = (patch: Record<string, unknown> = {}) =>
  useDataStore.setState({
    ...original,
    items: [], sales: [], saleReturns: [], journal: [], purchases: [], wastages: [], stocktakes: [],
    shifts: [], customers: [], promotions: [], serials: [], openingBalances: {} as never,
    ...patch,
  })

const seedCash = (amountMinor = 500_00) =>
  S().setOpeningBalance({ kind: 'treasury', refId: '1101', amountMinor, label: 'رصيد اختبار' } as never)

const openShift = () => {
  const shift = S().openShift('كاشير بقالة', 200_00)
  seedCash()
  return shift
}

/** addItem يعيد void في المستودع — نلتقط الصنف من الحالة بعد الإضافة */
const addItem = (patch: Record<string, unknown> = {}) => {
  const sku = `SKU-${Math.random().toString(36).slice(2, 8)}`
  S().addItem({
    nameAr: 'صنف بقالة', sku, barcodes: [],
    categoryId: 0, baseUnit: 'قطعة', costMinor: 1000, stockQty: 100, priceMinor: 1500,
    minQty: 0, ...patch,
  } as never)
  const created = S().items.find((i) => i.sku === sku)
  if (!created) throw new Error('لم يُنشأ الصنف')
  return created
}

const entry = (id: number) => S().journal.find((e) => e.id === id)!
const amount = (id: number, code: string) => {
  const lines = entry(id).lines.filter((l) => l.accountCode === code)
  return {
    debit: lines.reduce((s, l) => s + l.debit, 0),
    credit: lines.reduce((s, l) => s + l.credit, 0),
  }
}
const balanced = (id: number) =>
  entry(id).lines.reduce((s, l) => s + l.debit - l.credit, 0) === 0
const itemOf = (id: number) => S().items.find((i) => i.id === id)!

beforeEach(() => reset())
afterEach(() => useDataStore.setState(original))

describe('البقالة — سطح المحاسبة: الحسابات المستخدمة موجودة وقابلة للترحيل', () => {
  it('كل حساب يلمسه البيع/المرتجع/الهالك/الجرد/الشراء/الوردية معرّف في الشجرة', () => {
    for (const code of GROCERY_ACCOUNTS) expect(POSTABLE.has(code), `الحساب ${code}`).toBe(true)
  })
})

describe('البقالة — فاتورة بيع شاملة الضريبة (القالب الافتراضي)', () => {
  it('العميل يدفع الصافي، والضريبة تُفصل بدقة قرش، والقيد متوازن', () => {
    openShift()
    const rice = addItem({ nameAr: 'أرز 5كجم', costMinor: 1800, priceMinor: 2300, stockQty: 40 })
    const oil = addItem({ nameAr: 'زيت 1.5ل', costMinor: 900, priceMinor: 1250, stockQty: 60 })
    const sale = S().postSale({
      lines: [
        { itemId: rice.id, qty: 2, unitPriceMinor: 2300, unitCostMinor: 1800, discountPercent: 0, soldByWeight: false },
        { itemId: oil.id, qty: 1, unitPriceMinor: 1250, unitCostMinor: 900, discountPercent: 10, soldByWeight: false },
      ],
      payment: 'cash', paidMinor: 5_725, treasury: '1101',
      taxPercent: 15, invoiceDiscountPercent: 0, taxInclusive: true,
    } as never)

    expect(balanced(sale.journalEntryId!)).toBe(true)
    expect(sale.totals.taxBaseMinor + sale.totals.taxMinor).toBe(sale.totals.totalMinor)
    expect(amount(sale.journalEntryId!, '1101').debit).toBe(sale.totals.totalMinor)
    expect(amount(sale.journalEntryId!, '4101').credit).toBe(sale.totals.taxBaseMinor)
    expect(amount(sale.journalEntryId!, '2102').credit).toBe(sale.totals.taxMinor)
    // الضريبة = 15/115 من الصافي (شاملة)
    expect(sale.totals.taxMinor).toBe(Math.round((sale.totals.totalMinor * 15) / 115))

    // التكلفة: أرز 2×1800 + زيت 1×900 بعد تسوية المتوسط
    const expectedCogs = 2 * itemOf(rice.id).costMinor + itemOf(oil.id).costMinor
    expect(sale.totals.cogsMinor).toBe(expectedCogs)
    expect(amount(sale.journalEntryId!, '5101').debit).toBe(expectedCogs)
    expect(amount(sale.journalEntryId!, '1103').credit).toBe(expectedCogs)

    // الرف والدفتر متطابقان بعد البيع
    expect(itemOf(rice.id).stockQty).toBe(38)
    expect(itemOf(oil.id).stockQty).toBe(59)
    expect(itemOf(oil.id).stockValueMinor).toBe(59 * itemOf(oil.id).costMinor)
  })

  it('الوزن: 0.75 كجم بسعر الكيلو يُحسب بدقة ولا يقرّب الكمية', () => {
    openShift()
    const dates = addItem({ nameAr: 'تمر سكري', costMinor: 2000, priceMinor: 3000, stockQty: 20, soldByWeight: true, baseUnit: 'كجم' })
    const sale = S().postSale({
      lines: [{ itemId: dates.id, qty: 0.75, unitPriceMinor: 3000, unitCostMinor: 2000, discountPercent: 0, soldByWeight: true }],
      payment: 'cash', paidMinor: 2250, treasury: '1101',
      taxPercent: 15, invoiceDiscountPercent: 0, taxInclusive: true,
    } as never)
    expect(sale.totals.totalMinor).toBe(2250)
    expect(itemOf(dates.id).stockQty).toBeCloseTo(19.25, 6)
    expect(sale.totals.cogsMinor).toBe(1500)
    expect(balanced(sale.journalEntryId!)).toBe(true)
  })

  it('سطور مختلطة النسب (15٪ و5٪ ومعفى): مجموع الأسس والضرائب = إجمالي الفاتورة', () => {
    openShift()
    const a = addItem({ nameAr: 'مياه', costMinor: 100, priceMinor: 200, stockQty: 100, vatOverride: 5 })
    const b = addItem({ nameAr: 'خضار طازج', costMinor: 100, priceMinor: 300, stockQty: 100, vatOverride: 0 })
    const sale = S().postSale({
      lines: [
        { itemId: a.id, qty: 3, unitPriceMinor: 200, unitCostMinor: 100, discountPercent: 0, soldByWeight: false, vatPercentOverride: 5 },
        { itemId: b.id, qty: 1, unitPriceMinor: 300, unitCostMinor: 100, discountPercent: 0, soldByWeight: false, vatPercentOverride: 0 },
        { itemId: a.id, qty: 1, unitPriceMinor: 200, unitCostMinor: 100, discountPercent: 0, soldByWeight: false, vatPercentOverride: 15 },
      ],
      payment: 'cash', paidMinor: 1_100, treasury: '1101',
      taxPercent: 15, invoiceDiscountPercent: 0, taxInclusive: true,
    } as never)
    expect(balanced(sale.journalEntryId!)).toBe(true)
    expect(sale.totals.taxBaseMinor + sale.totals.taxMinor).toBe(sale.totals.totalMinor)
    expect(amount(sale.journalEntryId!, '4101').credit + amount(sale.journalEntryId!, '2102').credit).toBe(sale.totals.totalMinor)
    // السطر المعفى لا ينتج ضريبة
    expect(sale.totals.taxMinor).toBeGreaterThan(0)
    expect(sale.totals.taxMinor).toBeLessThan(Math.round((sale.totals.totalMinor * 15) / 115))
  })

  it('الضريبة الحصرية: الإجمالي = الصافي + الضريبة، والقيد يحمل الاثنين', () => {
    openShift()
    const milk = addItem({ nameAr: 'حليب', costMinor: 300, priceMinor: 500, stockQty: 50 })
    const sale = S().postSale({
      lines: [{ itemId: milk.id, qty: 10, unitPriceMinor: 500, unitCostMinor: 300, discountPercent: 0, soldByWeight: false }],
      payment: 'cash', paidMinor: 57_50, treasury: '1101',
      taxPercent: 15, invoiceDiscountPercent: 0, taxInclusive: false,
    } as never)
    expect(sale.totals.taxBaseMinor).toBe(5000)
    expect(sale.totals.taxMinor).toBe(750)
    expect(sale.totals.totalMinor).toBe(5750)
    expect(amount(sale.journalEntryId!, '2102').credit).toBe(750)
    expect(balanced(sale.journalEntryId!)).toBe(true)
  })
})

describe('البقالة — الدفع المجزأ والماكينة', () => {
  it('نقدي + الباقي آجل: الخزينة والعملاء يقابلان الإجمالي، ورصيد العميل يساوي الباقي', () => {
    openShift()
    S().addCustomer({ nameAr: 'أبو خالد', phone: '', type: 'retail' } as never)
    const customer = S().customers.find((c) => c.nameAr === 'أبو خالد')!
    const item = addItem({ nameAr: 'معلبات', costMinor: 500, priceMinor: 800, stockQty: 50 })
    const sale = S().postSale({
      lines: [{ itemId: item.id, qty: 5, unitPriceMinor: 800, unitCostMinor: 500, discountPercent: 0, soldByWeight: false }],
      payment: 'credit', customerId: customer.id, paidMinor: 1000, treasury: '1101',
      taxPercent: 15, invoiceDiscountPercent: 0, taxInclusive: true,
    } as never)
    expect(sale.totals.totalMinor).toBe(4000)
    expect(amount(sale.journalEntryId!, '1101').debit).toBe(1000)
    expect(amount(sale.journalEntryId!, '1104').debit).toBe(3000)
    expect(balanced(sale.journalEntryId!)).toBe(true)
    expect(S().getCustomerBalance(customer.id)).toBe(3000)
  })

  it('الدفع بالماكينة لا يدخل الدرج: يقيد على حساب الماكينة ويخرج من نقدية الوردية', () => {
    openShift()
    const terminals = S().treasuries
    const bank = terminals.find((t) => t.code === '1102' && (t.kind ?? 'bank') === 'bank')
    const item = addItem({ nameAr: 'منظفات', costMinor: 700, priceMinor: 1000, stockQty: 20 })
    const sale = S().postSale({
      lines: [{ itemId: item.id, qty: 1, unitPriceMinor: 1000, unitCostMinor: 700, discountPercent: 0, soldByWeight: false }],
      payment: 'terminal', paidMinor: 1000, treasury: bank?.code ?? '1102',
      taxPercent: 15, invoiceDiscountPercent: 0, taxInclusive: true,
    } as never)
    expect(amount(sale.journalEntryId!, '1101').debit).toBe(0)
    expect(amount(sale.journalEntryId!, bank?.code ?? '1102').debit).toBe(sale.totals.totalMinor)
    const summary = S().getShiftSummary(S().shifts.find((s) => !s.closedAt)!.id)
    expect(summary.cashSalesMinor ?? 0).toBe(0)
    expect(summary.bankSalesMinor ?? 0).toBeGreaterThan(0)
  })

  it('خدمة بلا مخزون: لا قيد 5101/1103 إطلاقاً', () => {
    openShift()
    const delivery = addItem({ nameAr: 'توصيل', costMinor: 0, priceMinor: 1500, stockQty: 0, isService: true })
    const sale = S().postSale({
      lines: [{ itemId: delivery.id, qty: 1, unitPriceMinor: 1500, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }],
      payment: 'cash', paidMinor: 1500, treasury: '1101',
      taxPercent: 15, invoiceDiscountPercent: 0, taxInclusive: true,
    } as never)
    expect(amount(sale.journalEntryId!, '5101').debit).toBe(0)
    expect(amount(sale.journalEntryId!, '1103').credit).toBe(0)
    expect(balanced(sale.journalEntryId!)).toBe(true)
  })
})

describe('البقالة — حماية الهامش (أرضية السعر)', () => {
  it('خصم فاتورة يهبط بالسعر تحت التكلفة مرفوض — كان يمر سابقاً لأن الفحص يقرأ خصم السطر وحده', () => {
    openShift()
    const item = addItem({ nameAr: 'زبدة', costMinor: 1000, priceMinor: 1200, stockQty: 20 })
    expect(() => S().postSale({
      lines: [{ itemId: item.id, qty: 1, unitPriceMinor: 1200, unitCostMinor: 1000, discountPercent: 0, soldByWeight: false }],
      payment: 'cash', paidMinor: 0, treasury: '1101',
      taxPercent: 0, invoiceDiscountPercent: 20, taxInclusive: true,
    } as never)).toThrow(PriceFloorError)
    // بلا خصم: يمر
    const ok = S().postSale({
      lines: [{ itemId: item.id, qty: 1, unitPriceMinor: 1200, unitCostMinor: 1000, discountPercent: 0, soldByWeight: false }],
      payment: 'cash', paidMinor: 1200, treasury: '1101',
      taxPercent: 0, invoiceDiscountPercent: 0, taxInclusive: true,
    } as never)
    expect(balanced(ok.journalEntryId!)).toBe(true)
  })

  it('priceFloorViolations تحسب الخصمين معاً وبالوحدة الأساسية', () => {
    const items = [{ id: 1, nameAr: 'كرتونة', costMinor: 1000, minSalePriceMinor: 0 }]
    expect(priceFloorViolations([{ itemId: 1, unitPriceMinor: 6000, unitFactor: 6, discountPercent: 0 }], items)).toEqual([])
    // 10٪ خصم فاتورة على سعر يساوي التكلفة بالضبط ⇒ تحت التكلفة
    expect(priceFloorViolations([{ itemId: 1, unitPriceMinor: 6000, unitFactor: 6, discountPercent: 0 }], items, 10)).toEqual(['كرتونة'])
    // 5٪ خصم فاتورة على سعر أعلى من التكلفة بقليل ⇒ يبقى فوق الأرضية
    expect(priceFloorViolations([{ itemId: 1, unitPriceMinor: 6600, unitFactor: 6, discountPercent: 0 }], items, 5)).toEqual([])
    expect(() => priceFloorViolations([], items, 101)).toThrow(RangeError)
  })
})

describe('البقالة — المرتجع', () => {
  it('مرتجع جزئي بعد ارتفاع السعر يُرد بسعر الفاتورة الأصلية ويعيد التكلفة الأصلية للمخزون', () => {
    openShift()
    const item = addItem({ nameAr: 'عصير', costMinor: 400, priceMinor: 600, stockQty: 30 })
    const sale = S().postSale({
      lines: [{ itemId: item.id, qty: 10, unitPriceMinor: 600, unitCostMinor: 400, discountPercent: 0, soldByWeight: false }],
      payment: 'cash', paidMinor: 6000, treasury: '1101',
      taxPercent: 15, invoiceDiscountPercent: 0, taxInclusive: true,
    } as never)
    // رفع متوسط التكلفة بشراء لاحق (تعديل الصنف ممنوع بعد الحركات) — المرتجع
    // يجب أن يعيد التكلفة الأصلية 400 لا المتوسط الجديد
    S().postPurchase({
      supplierId: 0, date: new Date().toISOString().slice(0, 10),
      lines: [{ itemId: item.id, qty: 30, unitPriceMinor: 700 }],
      expenses: [], paidMinor: 21_000, treasury: '1101',
    } as never)
    expect(itemOf(item.id).costMinor).toBeGreaterThan(400)
    const ret = S().postSaleReturn({
      saleId: sale.id, lineSpecs: [{ lineIndex: 0, qty: 2, condition: 'resellable' }],
      refund: 'cash', reason: 'بضاعة تالفة من المورد', treasury: '1101',
    } as never)
    expect(balanced(ret.journalEntryId!)).toBe(true)
    // الرد بقيمة الفاتورة الأصلية (2 × 600 شاملة الضريبة) لا بسعر اليوم
    expect(ret.totals.totalMinor).toBe(1200)
    // المرتجع يقيد على حساب مقابل المبيعات 4102 (لا يخفض إيراد 4101 نفسه)
    expect(amount(ret.journalEntryId!, '4102').debit + amount(ret.journalEntryId!, '2102').debit).toBe(1200)
    expect(amount(ret.journalEntryId!, '1101').credit).toBe(1200)
    // المخزون يعود بتكلفة البيع الأصلية (400) لا بتكلفة اليوم (700)
    expect(amount(ret.journalEntryId!, '1103').debit).toBe(800) // 2 × 400 التكلفة الأصلية
    // 30 شراء − 10 بيع + 30 شراء لاحق + 2 مرتجع = 52
    expect(itemOf(item.id).stockQty).toBe(52)
  })

  it('مرتجع تالف لا يعود للمخزون ولا يولّد قيد مخزون', () => {
    openShift()
    const item = addItem({ nameAr: 'بيض', costMinor: 800, priceMinor: 1000, stockQty: 20 })
    const sale = S().postSale({
      lines: [{ itemId: item.id, qty: 4, unitPriceMinor: 1000, unitCostMinor: 800, discountPercent: 0, soldByWeight: false }],
      payment: 'cash', paidMinor: 4000, treasury: '1101',
      taxPercent: 0, invoiceDiscountPercent: 0, taxInclusive: true,
    } as never)
    const ret = S().postSaleReturn({
      saleId: sale.id, lineSpecs: [{ lineIndex: 0, qty: 1, condition: 'damaged' }],
      refund: 'cash', reason: 'كسر أثناء النقل', treasury: '1101',
    } as never)
    expect(itemOf(item.id).stockQty).toBe(16)
    expect(amount(ret.journalEntryId!, '1103').debit).toBe(0)
    expect(balanced(ret.journalEntryId!)).toBe(true)
  })
})

describe('البقالة — الهالك والجرد', () => {
  it('هالك منتهي الصلاحية: 5111 مدين / 1103 دائن بالمتوسط المرجح، والمخزون ينقص', () => {
    const item = addItem({ nameAr: 'لبن', costMinor: 250, priceMinor: 400, stockQty: 12 })
    const doc = S().postWastage({ reason: 'انتهاء صلاحية', lines: [{ itemId: item.id, qty: 3 }], notes: '' } as never)
    const id = (doc as never as { journalEntryId: number }).journalEntryId
    expect(balanced(id)).toBe(true)
    expect(amount(id, '5111').debit).toBe(750)
    expect(amount(id, '1103').credit).toBe(750)
    expect(itemOf(item.id).stockQty).toBe(9)
    expect(itemOf(item.id).stockValueMinor).toBe(9 * itemOf(item.id).costMinor)
  })

  it('الجرد: العجز مصروف 5111 والزيادة إيراد 4110 — والقيدان متوازنان', () => {
    const short = addItem({ nameAr: 'سكر', costMinor: 500, priceMinor: 700, stockQty: 10 })
    const over = addItem({ nameAr: 'شاي', costMinor: 900, priceMinor: 1200, stockQty: 5 })
    const doc = S().postStocktake([
      { itemId: short.id, nameAr: 'سكر', expectedQty: 10, countedQty: 8, unitCostMinor: 500 },
      { itemId: over.id, nameAr: 'شاي', expectedQty: 5, countedQty: 7, unitCostMinor: 900 },
    ], 'جرد أسبوعي')
    const id = (doc as never as { journalEntryId: number }).journalEntryId
    expect(balanced(id)).toBe(true)
    expect(amount(id, '5111').debit).toBe(1000)
    expect(amount(id, '4110').credit).toBe(1800)
    expect(amount(id, '1103').credit - amount(id, '1103').debit).toBe(-800)
    expect(itemOf(short.id).stockQty).toBe(8)
    expect(itemOf(over.id).stockQty).toBe(7)
  })
})

describe('البقالة — الشراء والتكلفة الهابطة', () => {
  it('شراء بضريبة مدخلات ومصاريف شحن: 1103 بالتكلفة كاملة بلا ضريبة، و2102 تُخصم لاحقاً', () => {
    seedCash()
    const item = addItem({ nameAr: 'زيت جملة', costMinor: 1000, priceMinor: 1500, stockQty: 10 })
    const before = itemOf(item.id).costMinor
    const purchase = S().postPurchase({
      supplierId: 0, date: new Date().toISOString().slice(0, 10),
      lines: [{ itemId: item.id, qty: 10, unitPriceMinor: 1100, vatPercent: 15, inputVatMinor: 1650 }],
      expenses: [{ nameAr: 'نولون شحن', amountMinor: 500, method: 'value', paidBy: 'treasury', payAccount: '1101' }],
      paidMinor: 12_650, treasury: '1101',
    } as never)
    const id = (purchase as never as { journalEntryId: number }).journalEntryId
    expect(balanced(id)).toBe(true)
    // بضاعة 11000 + شحن 500 = 11500 على 1103
    expect(amount(id, '1103').debit).toBe(11_500)
    expect(amount(id, '2102').debit).toBe(1650)
    // متوسط جديد = (10 × 1000 + 11500) ÷ 20
    const expected = Math.round((10 * before + 11_500) / 20)
    expect(itemOf(item.id).costMinor).toBe(expected)
    expect(itemOf(item.id).stockQty).toBe(20)
    // بيع بعد الشراء: COGS بالمتوسط الجديد لا القديم
    openShift()
    const sale = S().postSale({
      lines: [{ itemId: item.id, qty: 1, unitPriceMinor: 1500, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }],
      payment: 'cash', paidMinor: 1500, treasury: '1101',
      taxPercent: 0, invoiceDiscountPercent: 0, taxInclusive: true,
    } as never)
    expect(sale.totals.cogsMinor).toBe(expected)
    expect(amount(sale.journalEntryId!, '5101').debit).toBe(expected)
  })
})

describe('البقالة — الوردية (X/Z)', () => {
  it('المتوقع = افتتاحي + نقدي − مرتجع نقدي، والماكينة خارج الدرج، والفرق يُسوّى بقيد', () => {
    const shift = openShift()
    const item = addItem({ nameAr: 'مكسرات', costMinor: 1000, priceMinor: 2000, stockQty: 100 })
    S().postSale({
      lines: [{ itemId: item.id, qty: 1, unitPriceMinor: 2000, unitCostMinor: 1000, discountPercent: 0, soldByWeight: false }],
      payment: 'cash', paidMinor: 2000, treasury: '1101',
      taxPercent: 0, invoiceDiscountPercent: 0, taxInclusive: true,
    } as never)
    const card = S().postSale({
      lines: [{ itemId: item.id, qty: 2, unitPriceMinor: 2000, unitCostMinor: 1000, discountPercent: 0, soldByWeight: false }],
      payment: 'terminal', paidMinor: 4000, treasury: '1102',
      taxPercent: 0, invoiceDiscountPercent: 0, taxInclusive: true,
    } as never)
    const cashSale = S().sales.find((s) => s.id !== card.id)!
    S().postSaleReturn({
      saleId: cashSale.id, lineSpecs: [{ lineIndex: 0, qty: 1, condition: 'resellable' }],
      refund: 'cash', reason: 'خطأ في المسح', treasury: '1101',
    } as never)

    const summary = S().getShiftSummary(shift.id)
    expect(summary.cashSalesMinor).toBe(2000)
    expect(summary.cashRefundsMinor).toBe(2000)
    expect(summary.expectedCashMinor).toBe(200_00 + 2000 - 2000)

    // عدّ أقل بـ 500 ⇒ عجز يُسوّى مصروفاً على 5108
    const closed = S().closeShift(summary.expectedCashMinor - 500, null, null)
    expect(closed.status).toBe('closed')
    expect(S().getShiftSummary(shift.id).varianceMinor).toBe(-500)
    const settled = S().settleShiftVariance({ shiftId: shift.id, mode: 'expense' })
    expect(settled.varianceSettledMode).toBe('expense')
    const id = S().journal[S().journal.length - 1].id
    expect(balanced(id)).toBe(true)
    expect(amount(id, '5108').debit).toBe(500)
    expect(amount(id, '1101').credit).toBe(500)
  })
})
