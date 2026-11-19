import { describe, it, expect, beforeAll, vi } from 'vitest'

vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

const { useDataStore } = await import('../src/data/repo.ts')
const { useAppStore } = await import('../src/stores/app.store.ts')
const { invoicePaymentLabel } = await import('../src/core/invoiceReports.ts')

const S = () => useDataStore.getState()
const balance = (code: string) => S().journal.reduce(
  (sum, entry) => sum + entry.lines.filter((l) => l.accountCode === code).reduce((x, l) => x + l.debit - l.credit, 0),
  0,
)
const journalLines = () => S().journal.reduce((sum, entry) => sum + entry.lines.length, 0)

const item = (over: Record<string, unknown>) => ({
  nameAr: 'صنف حراسة', sku: `GRD-${Math.random().toString(36).slice(2, 8)}`, barcodes: [], categoryId: 1,
  baseUnit: 'كجم', extraUnits: [], costMinor: 0, stockQty: 0, priceMinor: 1200, minQty: 0,
  trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false,
  variantColors: [], variantSizes: [], isActive: true, ...over,
})

beforeAll(() => {
  localStorage.clear()
  const app = useAppStore.getState()
  useAppStore.setState({
    ...app,
    setup: { ...app.setup, completed: true, countryCode: 'SA', activityId: 'grocery', shopName: 'حراسة المدخلات', ownerName: 'م', features: [], modules: ['pos', 'inventory', 'purchases'], accountingMode: 'full' },
  })
  S().addWarehouse('المخزن الرئيسي')
  S().addSupplier({ nameAr: 'مورد حراسة', phone: '', notes: '' } as never)
  S().addCustomer({ nameAr: 'عميل حراسة', phone: '', notes: '' } as never)
})

/**
 * هذه الحراسات وُلدت من الطبقة ④ (تحصين المدخلات) في منهجية الفحص:
 * كل حالة هنا كانت **تُقبل بصمت** قبل الإصلاح وتنتج مستنداً/قيداً بمبالغ ناقصة.
 */
describe('تحصين المدخلات: قيمة مجهولة أو سالبة لا تمضي بصمت', () => {
  it('نسبة ضريبة سالبة في سطر الشراء تُرفض ولا تُقصّ إلى صفر (كانت تُقلّل 2102 و2101)', () => {
    const it1 = item({ nameAr: 'صنف ضريبة' })
    S().addItem(it1 as never)
    const created = S().items.at(-1)!
    const linesBefore = journalLines()
    expect(() => S().postPurchase({
      supplierId: S().suppliers.at(-1)!.id, date: '2026-11-17',
      lines: [{ itemId: created.id, qty: 2, unitPriceMinor: 1000, vatPercent: -5, warehouseId: S().warehouses[0].id }],
      expenses: [], paidMinor: 0, treasury: '1101', notes: '',
    })).toThrow(/نسبة ضريبة/)
    expect(journalLines()).toBe(linesBefore)
    expect(balance('1103')).toBe(S().items.reduce((sum, row) => sum + (Number.isFinite(row.stockValueMinor) ? row.stockValueMinor! : Math.round(row.stockQty * row.costMinor)), 0))
  })

  it('نسبة ضريبة نكرة (NaN) في سطر الشراء تُرفض', () => {
    const it2 = item({ nameAr: 'صنف نكرة' })
    S().addItem(it2 as never)
    const created = S().items.at(-1)!
    expect(() => S().postPurchase({
      supplierId: S().suppliers.at(-1)!.id, date: '2026-11-17',
      lines: [{ itemId: created.id, qty: 1, unitPriceMinor: 500, vatPercent: Number.NaN, warehouseId: S().warehouses[0].id }],
      expenses: [], paidMinor: 0, treasury: '1101', notes: '',
    })).toThrow(/نسبة ضريبة/)
  })

  it('نوع سند مجهول يُرفض — كان يولّد قيداً في 1104 بلا حركة على كشف العميل (كسر ث7)', () => {
    const vouchersBefore = S().vouchers.length
    const linesBefore = journalLines()
    expect(() => S().postVoucher({
      kind: 'نوع-مجهول' as never, partyKind: 'customer', partyId: S().customers.at(-1)!.id,
      treasury: '1101', counterAccountCode: '1104', amountMinor: 500, description: 'سند مجهول', date: '2026-11-17',
    })).toThrow(/نوع السند غير معروف/)
    expect(S().vouchers.length).toBe(vouchersBefore)
    expect(journalLines()).toBe(linesBefore)
  })

  it('نوع دفع فاتورة مجهول يُرفض — كان يمضي كأنه آجل بلا خزينة ولا ذمة', () => {
    const it3 = item({ nameAr: 'صنف دفع', priceMinor: 1000 })
    S().addItem(it3 as never)
    const created = S().items.at(-1)!
    S().postPurchase({
      supplierId: S().suppliers.at(-1)!.id, date: '2026-11-17',
      lines: [{ itemId: created.id, qty: 5, unitPriceMinor: 500, vatPercent: 0, warehouseId: S().warehouses[0].id }],
      expenses: [], paidMinor: 0, treasury: '1101', notes: '',
    })
    const salesBefore = S().sales.length
    expect(() => S().postSale({
      lines: [{ itemId: created.id, nameAr: created.nameAr, qty: 1, unitPriceMinor: 1000, unitCostMinor: created.costMinor, discountPercent: 0, soldByWeight: false, warehouseId: S().warehouses[0].id }],
      customerId: null, payment: 'بطاقة-مجهولة' as never, treasury: '1101', paidMinor: 1000, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true,
    })).toThrow(/نوع دفع/)
    expect(S().sales.length).toBe(salesBefore)
  })

  it('كمية جرد نكرة أو سالبة تُرفض بلا قيد تسوية ولا أثر جزئي', () => {
    const it4 = item({ nameAr: 'صنف جرد' })
    S().addItem(it4 as never)
    const created = S().items.at(-1)!
    S().postPurchase({
      supplierId: S().suppliers.at(-1)!.id, date: '2026-11-17',
      lines: [{ itemId: created.id, qty: 4, unitPriceMinor: 700, vatPercent: 0, warehouseId: S().warehouses[0].id }],
      expenses: [], paidMinor: 0, treasury: '1101', notes: '',
    })
    const stockQty = S().items.find((row) => row.id === created.id)!.stockQty
    const linesBefore = journalLines()
    expect(() => S().postStocktake([{ itemId: created.id, nameAr: created.nameAr, expectedQty: stockQty, countedQty: Number.NaN, unitCostMinor: 700 }], 'جرد نكرة')).toThrow(/الكمية المعدودة/)
    expect(() => S().postStocktake([{ itemId: created.id, nameAr: created.nameAr, expectedQty: stockQty, countedQty: -3, unitCostMinor: 700 }], 'جرد سالب')).toThrow(/الكمية المعدودة/)
    expect(() => S().postStocktake([{ itemId: created.id, nameAr: created.nameAr, expectedQty: stockQty, countedQty: 2, unitCostMinor: Number.NaN }], 'تكلفة نكرة')).toThrow(/تكلفة الوحدة/)
    expect(journalLines()).toBe(linesBefore)
    expect(S().items.find((row) => row.id === created.id)!.stockQty).toBe(stockQty)
  })

  it('طريقة الدفع المطبوعة على الفاتورة تطابق ما دُفع فعلاً (كانت البطاقة تُطبع «آجل»)', () => {
    expect(invoicePaymentLabel('cash')).toBe('نقدي')
    expect(invoicePaymentLabel('credit')).toBe('آجل')
    expect(invoicePaymentLabel('card')).toBe('بطاقة')
    expect(invoicePaymentLabel('terminal')).toBe('ماكينة دفع')

    const it5 = item({ nameAr: 'صنف بطاقة', priceMinor: 1000 })
    S().addItem(it5 as never)
    const created = S().items.at(-1)!
    S().postPurchase({
      supplierId: S().suppliers.at(-1)!.id, date: '2026-11-17',
      lines: [{ itemId: created.id, qty: 3, unitPriceMinor: 600, vatPercent: 0, warehouseId: S().warehouses[0].id }],
      expenses: [], paidMinor: 0, treasury: '1101', notes: '',
    })
    const bankCode = S().treasuries.find((t) => t.code === '1102')?.code ?? '1101'
    const sale = S().postSale({
      lines: [{ itemId: created.id, nameAr: created.nameAr, qty: 1, unitPriceMinor: 1000, unitCostMinor: created.costMinor, discountPercent: 0, soldByWeight: false, warehouseId: S().warehouses[0].id }],
      customerId: null, payment: 'card' as never, treasury: bankCode, paidMinor: 1000, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true,
    })
    expect(String(sale.payment)).toBe('card')
    expect(invoicePaymentLabel(sale.payment)).toBe('بطاقة')
    // لا آجل على بطاقة: الإجمالي محصَّل بالكامل، فلا يزيد رصيد أي عميل
    expect(S().customers.reduce((sum, row) => sum + S().getCustomerBalance(row.id), 0)).toBe(0)
  })
})
