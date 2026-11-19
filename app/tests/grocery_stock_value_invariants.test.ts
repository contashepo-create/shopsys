import { describe, it, expect, beforeAll, vi } from 'vitest'

vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

const { useDataStore } = await import('../src/data/repo.ts')
const { useAppStore } = await import('../src/stores/app.store.ts')
const { withdrawStockValue, reconcileStockValue } = await import('../src/core/costing.ts')
const { computeTotals, buildSaleEntry } = await import('../src/core/pos.ts')

const S = () => useDataStore.getState()
const balance = (code: string) => S().journal.reduce(
  (sum, entry) => sum + entry.lines.filter((l) => l.accountCode === code).reduce((x, l) => x + l.debit - l.credit, 0),
  0,
)
const itemsValue = () => S().items.reduce((sum, it) => sum + (Number.isFinite(it.stockValueMinor) ? it.stockValueMinor! : Math.round(it.stockQty * it.costMinor)), 0)

const item = (over: Record<string, unknown>) => ({
  nameAr: 'صنف', sku: `SKU-${Math.random().toString(36).slice(2, 8)}`, barcodes: [], categoryId: 1,
  baseUnit: 'كجم', extraUnits: [], costMinor: 0, stockQty: 0, priceMinor: 4000, minQty: 0,
  trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false,
  variantColors: [], variantSizes: [], isActive: true, ...over,
})

beforeAll(() => {
  localStorage.clear()
  const app = useAppStore.getState()
  useAppStore.setState({
    ...app,
    setup: { ...app.setup, completed: true, countryCode: 'SA', activityId: 'grocery', shopName: 'ثوابت البقالة', ownerName: 'م', features: [], modules: ['pos', 'inventory', 'purchases'], accountingMode: 'full' },
  })
  S().addWarehouse('المخزن الرئيسي')
})

describe('ثابت المخزون: 1103 = مجموع قيم الأصناف بالقرش — تحت كسور الأوزان والحركات العشوائية', () => {
  it('سحب قيمة الوزن لا يتأثر بخطأ الفاصلة العائمة (18.197 − 17.777)', () => {
    // الطرح العشري في JS يعطي 0.419999999999998 ⇒ 1975×0.4199… = 829.4999 ⇒ 829
    // بينما قيد التكلفة بالكمية الحقيقية 0.42 يعطي 830 — فرق قرش في كل حركة وزن.
    const withdrawal = withdrawStockValue(18.197, 35943, 0.42)
    const reconciled = reconcileStockValue(18.197, 1975, 35943, 17.777, 1975)
    expect(withdrawal.remainingValueMinor).toBe(35113)
    expect(reconciled.stockValueMinor).toBe(35113) // كان 35114 قبل الإصلاح
    expect(35943 - reconciled.stockValueMinor).toBe(830)
  })

  it('بيع أوزان متتالية بعد شراء بمصاريف محمّلة: 1103 يساوي قيمة الأصناف بعد كل فاتورة', () => {
    S().addItem(item({ nameAr: 'جبن موزون', sku: 'CHZ-Q', barcodes: ['7770001'], soldByWeight: true }) as never)
    const cheese = S().items.find((it) => it.sku === 'CHZ-Q')!
    S().addSupplier({ nameAr: 'مورد الأوزان' } as never)
    const supplier = S().suppliers.at(-1)!
    // 3 كجم × 1001 + نولون 2 قرش ⇒ قيمة 3005 ومتوسط 1002 — كسر يفضح التقريب
    S().postPurchase({
      supplierId: supplier.id, date: '2026-11-17',
      lines: [{ itemId: cheese.id, qty: 3, unitPriceMinor: 1001, vatPercent: 0 }],
      expenses: [{ nameAr: 'نولون', amountMinor: 2, method: 'qty', paidBy: 'supplier', costTreatment: 'inventory' } as never],
      paidMinor: 0, treasury: '1101', notes: '',
    } as never)
    expect(balance('1103')).toBe(itemsValue())
    for (const qty of [0.42, 0.3, 0.17, 0.11]) {
      S().postSale({
        lines: [{ itemId: cheese.id, nameAr: cheese.nameAr, qty, unitPriceMinor: 4000, unitCostMinor: S().items.find((it) => it.id === cheese.id)!.costMinor, discountPercent: 0, soldByWeight: true }],
        customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 15, taxInclusive: true, treasury: '1101',
      })
      expect(balance('1103')).toBe(itemsValue())
    }
    // استنفاد كامل: تخرج القيمة المتبقية كلها ولا يبقى قرش معلّق في 1103
    const rest = S().items.find((it) => it.id === cheese.id)!
    S().postSale({
      lines: [{ itemId: cheese.id, nameAr: rest.nameAr, qty: rest.stockQty, unitPriceMinor: 4000, unitCostMinor: rest.costMinor, discountPercent: 0, soldByWeight: true }],
      customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 15, taxInclusive: true, treasury: '1101', priceFloorOverrideBy: 'مدير',
    })
    expect(S().items.find((it) => it.id === cheese.id)!.stockQty).toBe(0)
    expect(S().items.find((it) => it.id === cheese.id)!.stockValueMinor).toBe(0)
    expect(balance('1103')).toBe(itemsValue())
    // وقيد كل فاتورة: 5101 = 1103 الخارج بالضبط
    for (const sale of S().sales) {
      const entry = S().journal.find((e) => e.sourceType === 'sale' && e.sourceId === sale.id)!
      const cogs = entry.lines.filter((l) => l.accountCode === '5101').reduce((x, l) => x + l.debit, 0)
      const out = entry.lines.filter((l) => l.accountCode === '1103').reduce((x, l) => x - l.debit + l.credit, 0)
      expect(cogs).toBe(out)
    }
  })
})

describe('إجماليات الفاتورة وقيدها — ثوابت لا تُخترق بأي نسبة/تقريب', () => {
  it('الصافي = الإجمالي − الخصم، والأساس + الضريبة = الإجمالي، والقيد متوازن', () => {
    const lines = [
      { itemId: 1, nameAr: 'أ', qty: 0.333, unitPriceMinor: 1999, unitCostMinor: 1234, discountPercent: 33.3, soldByWeight: true },
      { itemId: 2, nameAr: 'ب', qty: 7, unitPriceMinor: 3, unitCostMinor: 1, discountPercent: 0, soldByWeight: false, vatPercentOverride: 0 },
      { itemId: 3, nameAr: 'ج', qty: 1, unitPriceMinor: 1, unitCostMinor: 0, discountPercent: 100, soldByWeight: false, vatPercentOverride: 5 },
    ]
    for (const invoiceDiscountPercent of [0, 7.5, 100]) {
      for (const taxInclusive of [true, false]) {
        const totals = computeTotals(lines, invoiceDiscountPercent, 15, taxInclusive, 2)
        expect(totals.netMinor).toBe(totals.grossMinor - totals.discountMinor)
        expect(totals.taxBaseMinor + totals.taxMinor).toBe(totals.totalMinor)
        if (taxInclusive) expect(totals.totalMinor).toBe(totals.netMinor)
        else expect(totals.totalMinor).toBe(totals.netMinor + totals.taxMinor)
        const entry = buildSaleEntry(totals, 'cash', '1101', totals.totalMinor)
        expect(entry.reduce((s, l) => s + l.debit, 0)).toBe(entry.reduce((s, l) => s + l.credit, 0))
      }
    }
  })
})

describe('مرتجع مجزأ بعد بيع بتكلفة دقيقة — لا حجب ولا انحراف', () => {
  it('تجزئة الإرجاع مرتين تمرّ، ومجموع تكلفة المرتجعين = تكلفة السطر المثبتة بالقرش', () => {
    S().addItem(item({ nameAr: 'عدس موزون', sku: 'LNT-SPLIT', barcodes: ['7770002'], soldByWeight: true }) as never)
    const lentil = S().items.find((it) => it.sku === 'LNT-SPLIT')!
    S().addSupplier({ nameAr: 'مورد العدس' } as never)
    const supplier = S().suppliers.at(-1)!
    // 3 كجم × 1001 + نولون 2 ⇒ قيمة 3005 ومتوسط مقرب 1002: التكلفة الدقيقة تلزمها حصة
    S().postPurchase({
      supplierId: supplier.id, date: '2026-11-17',
      lines: [{ itemId: lentil.id, qty: 3, unitPriceMinor: 1001, vatPercent: 0, warehouseId: S().warehouses[0]?.id ?? 1 }],
      expenses: [{ nameAr: 'نولون', amountMinor: 2, method: 'qty', paidBy: 'supplier', costTreatment: 'inventory' } as never],
      paidMinor: 0, treasury: '1101', notes: '',
    } as never)
    const sale = S().postSale({
      lines: [{ itemId: lentil.id, nameAr: 'عدس موزون', qty: 1.5, unitPriceMinor: 4000, unitCostMinor: S().items.find((it) => it.id === lentil.id)!.costMinor, discountPercent: 0, soldByWeight: true }],
      customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 15, taxInclusive: true, treasury: '1101',
    })
    const saleEntry = S().journal.find((e) => e.sourceType === 'sale' && e.sourceId === sale.id)!
    const saleCogs = saleEntry.lines.filter((l) => l.accountCode === '5101').reduce((x, l) => x + l.debit, 0)
    expect(saleCogs).toBe(sale.lines[0].costTotalMinor)
    expect(balance('1103')).toBe(itemsValue())

    // إرجاعان مجزآن (0.7 ثم 0.8) — كان الثاني/الأول يُحجب بحارس «تقريب تكلفة المرتجع المجزأ»
    const r1 = S().postSaleReturn({ saleId: sale.id, lineSpecs: [{ lineIndex: 0, qty: 0.7, condition: 'good' }], refund: 'cash' } as never)
    expect(balance('1103')).toBe(itemsValue())
    const r2 = S().postSaleReturn({ saleId: sale.id, lineSpecs: [{ lineIndex: 0, qty: 0.8, condition: 'good' }], refund: 'cash' } as never)
    expect(balance('1103')).toBe(itemsValue())

    const returnCogs = [r1, r2].map((ret) => {
      const entry = S().journal.find((e) => e.sourceType === 'sale_return' && e.sourceId === ret.id)!
      return entry.lines.filter((l) => l.accountCode === '5101').reduce((x, l) => x - l.debit + l.credit, 0)
    })
    // لا قرش يضيع ولا يتكرر: تكلفة المرتجعين = كامل تكلفة السطر، والقيمة عادت للمخزون بنفسها
    expect(returnCogs.reduce((a, b) => a + b, 0)).toBe(sale.lines[0].costTotalMinor)
    expect(S().items.find((it) => it.id === lentil.id)!.stockQty).toBeCloseTo(3, 6)
  })
})

describe('الجرد والأطباق — تقييم الفارق من القيمة المحمولة لا من متوسط مقرَّب', () => {
  it('جرد بعجز كسري على متوسط غير منقسم: 1103 يبقى مساوياً لقيمة الأصناف بالقرش', () => {
    S().addItem(item({ nameAr: 'سكر جرد', sku: 'SUG-STK', barcodes: ['7770003'], soldByWeight: true }) as never)
    const sugar = S().items.find((it) => it.sku === 'SUG-STK')!
    S().addSupplier({ nameAr: 'مورد السكر' } as never)
    const supplier = S().suppliers.at(-1)!
    const warehouseId = S().warehouses[0].id
    // وحدتان بقيمة 3 قروش ⇒ متوسط مقرَّب 2 (بينما القيمة الحقيقية 1.5 للوحدة)
    S().postPurchase({ supplierId: supplier.id, date: '2026-11-17', lines: [{ itemId: sugar.id, qty: 1, unitPriceMinor: 1, vatPercent: 0, warehouseId }], expenses: [], paidMinor: 0, treasury: '1101', notes: '' } as never)
    S().postPurchase({ supplierId: supplier.id, date: '2026-11-17', lines: [{ itemId: sugar.id, qty: 1, unitPriceMinor: 2, vatPercent: 0, warehouseId }], expenses: [], paidMinor: 0, treasury: '1101', notes: '' } as never)
    expect(balance('1103')).toBe(itemsValue())
    // عجز النصف: قيد التسوية بقيمة السحب الفعلية لا round(1 × 2)
    S().postStocktake([{ itemId: sugar.id, nameAr: 'سكر جرد', expectedQty: 2, countedQty: 1, unitCostMinor: S().items.find((it) => it.id === sugar.id)!.costMinor }], 'عجز تجربة')
    expect(balance('1103')).toBe(itemsValue())
    const entry = [...S().journal].reverse().find((e) => e.sourceType === 'adjustment')!
    const stockLine = entry.lines.find((l) => l.accountCode === '1103')!
    expect(stockLine.credit).toBe(2) // السحب الدقيق: 3 × 1/2 ⇒ 2 (لا 3−round(1×2)=1)
    // الزيادة تُقيَّم بمتوسط اللحظة والثابت يبقى صحيحاً
    S().postStocktake([{ itemId: sugar.id, nameAr: 'سكر جرد', expectedQty: 1, countedQty: 2.5, unitCostMinor: S().items.find((it) => it.id === sugar.id)!.costMinor }], 'زيادة تجربة')
    expect(balance('1103')).toBe(itemsValue())
  })

  it('طبق «يُجهَّز عند الطلب»: قيده يسحب تكلفة خاماته الدقيقة، ومرتجعه لا يحرّك مخزوناً ولا تكلفة مبيعات', () => {
    const wh = S().warehouses[0].id
    const raw = (nameAr: string, sku: string, over: Record<string, unknown>) => {
      S().addItem(item({ nameAr, sku, barcodes: [], ...over }) as never)
      return S().items.at(-1)!
    }
    const flour = raw('دقيق طبق', 'FLR-DISH', { baseUnit: 'كجم', soldByWeight: true, priceMinor: 400 })
    const ghee = raw('سمن طبق', 'GHI-DISH', { baseUnit: 'كجم', soldByWeight: true, priceMinor: 900 })
    const plate = raw('فطيرة', 'PLT-DISH', { baseUnit: 'طبق', soldByWeight: false, priceMinor: 5000 })
    S().addSupplier({ nameAr: 'مورد المطبخ' } as never)
    const supplier = S().suppliers.at(-1)!
    S().postPurchase({ supplierId: supplier.id, date: '2026-11-17', lines: [{ itemId: flour.id, qty: 7, unitPriceMinor: 101, vatPercent: 0, warehouseId: wh }], expenses: [], paidMinor: 0, treasury: '1101', notes: '' } as never)
    S().postPurchase({ supplierId: supplier.id, date: '2026-11-17', lines: [{ itemId: ghee.id, qty: 3.3, unitPriceMinor: 213, vatPercent: 0, warehouseId: wh }], expenses: [], paidMinor: 0, treasury: '1101', notes: '' } as never)
    S().addRecipe({ productItemId: plate.id, mode: 'made_to_order', isActive: true, yieldQty: 1, overheadMinor: 0, notes: '', ingredients: [{ itemId: flour.id, qty: 1 }, { itemId: ghee.id, qty: 0.35 }] })
    const recipe = S().recipes.at(-1)!
    const lines = [{ itemId: plate.id, nameAr: 'فطيرة', qty: 3, unitPriceMinor: 5000, unitCostMinor: S().getRecipeUnitCost(recipe.id), discountPercent: 0, soldByWeight: false, warehouseId: wh }]
    const sale = S().postSale({ lines, customerId: null, payment: 'cash', treasury: '1101', paidMinor: computeTotals(lines, 0, 0, false, 2).totalMinor, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false })
    expect(balance('1103')).toBe(itemsValue())
    const entry = S().journal.find((e) => e.sourceType === 'sale' && e.sourceId === sale.id)!
    const cogs = entry.lines.filter((l) => l.accountCode === '5101').reduce((x, l) => x + l.debit, 0)
    // تكلفة الوصفة المقرَّبة 3×176=528 كانت تُقيَّد، والسحب الفعلي 527 — القيد الآن بالسحب
    expect(cogs).toBe(527)
    expect(sale.lines[0].costTotalMinor).toBe(527)
    // مرتجع طبق واحد: لا بضاعة تعود ولا تكلفة مبيعات تتحرك (الخامات استُهلكت فعلاً)
    const cogsBefore = balance('5101')
    const invBefore = balance('1103')
    const wasteBefore = balance('5111')
    S().postSaleReturn({ saleId: sale.id, lineSpecs: [{ lineIndex: 0, qty: 1, condition: 'good' }], refund: 'cash' } as never)
    expect(balance('1103')).toBe(invBefore)
    expect(balance('5101')).toBe(cogsBefore)
    expect(balance('1103')).toBe(itemsValue())
    expect(balance('5111')).toBe(wasteBefore) // لا هالك مزدوج: التكلفة محمَّلة أصلاً في 5101
  })
})

describe('تحصين مدخلات مصروف الشراء — لا مبلغ يضيع بلا رسالة', () => {
  it('مصروف بتحميل تكلفة غير معروف يُرفض صراحةً بدل إسقاطه من الدفاتر', () => {
    const wh = S().warehouses[0].id
    S().addItem(item({ nameAr: 'شاي تحصين', sku: 'TEA-GUARD', barcodes: [], baseUnit: 'كجم', soldByWeight: true, priceMinor: 900 }) as never)
    const tea = S().items.find((it) => it.sku === 'TEA-GUARD')!
    S().addSupplier({ nameAr: 'مورد الشاي' } as never)
    const supplier = S().suppliers.at(-1)!
    const before = { journal: S().journal.length, items: S().items.length, value: itemsValue() }
    expect(() => S().postPurchase({
      supplierId: supplier.id, date: '2026-11-17',
      lines: [{ itemId: tea.id, qty: 3, unitPriceMinor: 1000, vatPercent: 0, warehouseId: wh }],
      // قيمة قديمة/مستوردة من إصدار سابق: كانت تُسقط المصروف من التكلفة والدين كليهما
      expenses: [{ nameAr: 'نولون', amountMinor: 7, method: 'qty', paidBy: 'supplier', costTreatment: 'value' } as never],
      paidMinor: 0, treasury: '1101', notes: '',
    } as never)).toThrow(/تحميل تكلفة مصروف/)
    // لا أثر جزئي: لا فاتورة ولا قيد ولا مخزون
    expect(S().journal.length).toBe(before.journal)
    expect(itemsValue()).toBe(before.value)
  })

  it('مصروف «على تكلفة المخزون» بالطريقة الصحيحة يرفع القيمة والدين بالقرش (1 على 3 وحدات)', () => {
    const wh = S().warehouses[0].id
    S().addItem(item({ nameAr: 'قهوة تحصين', sku: 'COF-GUARD', barcodes: [], baseUnit: 'كجم', soldByWeight: true, priceMinor: 900 }) as never)
    const coffee = S().items.find((it) => it.sku === 'COF-GUARD')!
    S().addSupplier({ nameAr: 'مورد القهوة' } as never)
    const supplier = S().suppliers.at(-1)!
    const dueBefore = -balance('2101')
    S().postPurchase({
      supplierId: supplier.id, date: '2026-11-17',
      lines: [{ itemId: coffee.id, qty: 3, unitPriceMinor: 1000, vatPercent: 0, warehouseId: wh }],
      expenses: [{ nameAr: 'نولون', amountMinor: 1, method: 'qty', paidBy: 'supplier', costTreatment: 'inventory' } as never],
      paidMinor: 0, treasury: '1101', notes: '',
    } as never)
    const purchase = S().purchases.at(-1)!
    expect(S().items.find((it) => it.id === coffee.id)!.stockValueMinor).toBe(3001)
    expect(balance('1103')).toBe(itemsValue())
    expect(purchase.grandTotalMinor).toBe(3001)
    expect(-balance('2101') - dueBefore).toBe(3001) // الدين زاد بالمبلغ كاملاً بلا قرش مفقود
  })
})
