/**
 * تدقيق ممنهج لدورة نشاط البقالة — لا يعتمد على أي تقرير مراجعة سابق.
 *
 * المنهج: تنفيذ يوم عمل كامل على مستودع حقيقي (useDataStore، أي عبر البوابات
 * المركزية) ثم إثبات الثوابت المحاسبية والمخزنية بعد **كل** خطوة:
 *   ث1  كل قيد في الدفتر مدين = دائن (لا استثناء).
 *   ث2  حساب المخزون 1103 في الدفتر = Σ قيمة المخزون الدقيقة للأصناف.
 *   ث3  رصيد الصنف الفعلي = المتوقع رياضياً بعد كل حركة.
 *   ث4  كل قيد مربوط بمصدره (sourceType/sourceId) وبرقم غير مكرر.
 *   ث5  الرفض لا يترك أثراً (المراجع لا تتغير عند رفض العملية).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { EMPTY_EXTENDED, useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { STANDARD_COA } from '../src/core/ledger.ts'
import { buildWarehouseDocs, computeWarehouseStock } from '../src/core/transfers.ts'

const initial = useRawDataStore.getState()
const app = useAppStore.getState()

const S = () => useDataStore.getState()
const R = () => useRawDataStore.getState()

/* ─── الثوابت ─── */
const unbalanced = (journal: typeof initial.journal) =>
  journal.filter((entry) => entry.lines.reduce((sum, line) => sum + line.debit - line.credit, 0) !== 0)

const ledgerBalance = (code: string) =>
  R().journal.reduce((sum, entry) => sum + entry.lines.reduce(
    (row, line) => row + (line.accountCode === code ? line.debit - line.credit : 0), 0), 0)

const stockValue = () => R().items.reduce((sum, item) => sum + (item.stockValueMinor ?? Math.round(item.stockQty * item.costMinor)), 0)
const qtyOf = (id: number) => R().items.find((item) => item.id === id)?.stockQty ?? Number.NaN

const expectInvariants = () => {
  expect(unbalanced(R().journal), 'قيد غير متوازن في الدفتر').toEqual([])
  expect(Math.abs(ledgerBalance('1103') - stockValue()), 'انفصل 1103 عن قيمة المخزون').toBeLessThanOrEqual(1)
  const numbers = R().journal.map((entry) => entry.entryNumber)
  expect(new Set(numbers).size, 'رقم قيد مكرر').toBe(numbers.length)
  for (const entry of R().journal) {
    expect(entry.sourceType, `قيد #${entry.id} بلا نوع مصدر`).toBeTruthy()
  }
}

/* ─── تهيئة بيئة بقالة نظيفة ─── */
beforeEach(() => {
  useAppStore.setState({
    ...app,
    activeBranchContext: null,
    fiscalYears: [],
    setup: {
      ...app.setup,
      completed: true, countryCode: 'SA', activityId: 'grocery', shopName: 'بقالة التدقيق',
      ownerName: 'المالك', features: [], modules: ['pos', 'inventory'], accountingMode: 'full',
      allowNegativeStock: false, allowNegativeTreasury: true, requireOpenShiftForSales: true,
      requirePurchaseExpiry: undefined, taxInclusive: true, vatPercent: 15, taxRegistrationStatus: 'registered',
    },
  })
  useRawDataStore.setState({
    ...initial,
    branches: [], activeBranchId: null, currentUserId: null,
    items: [], suppliers: [], purchases: [], purchaseReturns: [], sales: [], saleReturns: [],
    journal: [], batches: [], serials: [], transfers: [], shifts: [], stocktakes: [], wastages: [],
    warehouses: [{ id: 1, nameAr: 'المخزن', code: 'MAIN', isMain: true }, { id: 2, nameAr: 'مخزن ثانٍ', code: 'S2', isMain: false }] as never,
  })
  // سياسة اختبار صريحة: لا اعتماد مستندات ولا بوابات مشرف تُعطّل الدورة
  // الإعداد الحقيقي في المتجر اسمه `approvals` (لا `approvalPolicy`) — كانت تسمية قديمة تُسقط فحص الأنواع
  useAppStore.setState({ ...useAppStore.getState(), approvals: { ...useAppStore.getState().approvals, enabled: false } })
})

const seed = () => {
  S().addSupplier({ ...EMPTY_EXTENDED, nameAr: 'مورد الألبان', phone: '', notes: '' })
  S().addItem({ nameAr: 'جبنة رومي', sku: 'CHE-1', barcodes: ['6281000000017'], categoryId: 1, baseUnit: 'كجم', extraUnits: [], costMinor: 0, stockQty: 0, priceMinor: 2500, minQty: 0, trackExpiry: true, trackSerial: false, warrantyMonths: 0, soldByWeight: true, variantColors: [], variantSizes: [], isActive: true })
  S().addItem({ nameAr: 'مياه 600مل', sku: 'WAT-1', barcodes: ['6281000000024'], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 0, stockQty: 0, priceMinor: 150, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
  const item = R().items.find((row) => row.sku === 'CHE-1')!
  const water = R().items.find((row) => row.sku === 'WAT-1')!
  return { item, water, supplierId: R().suppliers[0].id }
}

const purchase = (supplierId: number, lines: { itemId: number; qty: number; unitPriceMinor: number; expiryDate?: string }[], paidMinor?: number) =>
  S().postPurchase({
    supplierId, date: new Date().toISOString().slice(0, 10), lines, expenses: [], notes: '',
    paidMinor: paidMinor ?? lines.reduce((sum, line) => sum + Math.round(line.qty * line.unitPriceMinor), 0),
    warehouseId: 1,
  } as never)

const sale = (lines: { itemId: number; nameAr: string; qty: number; unitPriceMinor: number; unitCostMinor: number; soldByWeight: boolean }[], over: Record<string, unknown> = {}) =>
  S().postSale({
    lines: lines.map((line) => ({ ...line, discountPercent: 0 })),
    customerId: null, payment: 'cash', treasury: '1101',
    invoiceDiscountPercent: 0, taxPercent: 15, taxInclusive: true,
    ...over,
  } as never)

describe('تدقيق ممنهج: ثوابت الدفتر والمخزون عبر دورة بقالة كاملة', () => {
  it('الدورة الكاملة (شراء→بيع→مرتجع→جرد→إتلاف→تحويل→وردية) تُبقي ث1..ث5', () => {
    const { item, water, supplierId } = seed()

    /* ① شراء أول: 10 كجم بسعر 12.00/كجم مع تاريخ صلاحية — بداية المخزون */
    purchase(supplierId, [{ itemId: item.id, qty: 10, unitPriceMinor: 1200, expiryDate: '2099-12-31' }])
    expect(qtyOf(item.id)).toBe(10)
    expect(R().items.find((row) => row.id === item.id)!.costMinor).toBe(1200)
    expectInvariants()

    /* ② شراء ثانٍ بضعف السعر: المتوسط المرجح يجب أن يتحرك لا آخر سعر */
    purchase(supplierId, [{ itemId: item.id, qty: 10, unitPriceMinor: 2400, expiryDate: '2099-12-31' }])
    expect(qtyOf(item.id)).toBe(20)
    expect(R().items.find((row) => row.id === item.id)!.costMinor).toBe(1800)
    expectInvariants()

    /* ③ وردية: لا بيع بلا وردية مفتوحة (سياسة المستخدم) */
    expect(() => sale([{ itemId: water.id, nameAr: water.nameAr, qty: 1, unitPriceMinor: 150, unitCostMinor: 0, soldByWeight: false }])).toThrow()
    S().openShift('كاشير', 0)

    /* ④ بيع نقدي شامل الضريبة لصنف موزون: الإيراد صافياً والضريبة مفصولة */
    const inv = sale([{ itemId: item.id, nameAr: item.nameAr, qty: 3, unitPriceMinor: 2500, unitCostMinor: 1800, soldByWeight: true }])
    expect(qtyOf(item.id)).toBe(17)
    expect(inv.totals.totalMinor).toBe(7500)
    expect(inv.totals.taxMinor).toBe(Math.round(7500 * 15 / 115))
    expectInvariants()

    /* ⑤ مرتجع: سليم يعود للمخزون، تالف يُقيَّد هالكاً بلا مخزون.
       ملاحظة مدققة: سطر الفاتورة الواحد لا يقبل حالتين في مستند واحد (حارس التكرار)،
       فالفصل بين السليم والتالف يتم بمستندين متتاليين — سلوك موثق لا ثغرة محاسبية. */
    const soldBatch = R().sales.find((row) => row.id === inv.id)!.saleExpiryBatches![0]
    S().postSaleReturn({ saleId: inv.id, lineSpecs: [{ lineIndex: 0, qty: 1, condition: 'resellable', batchAllocations: [{ batchId: soldBatch.id, qty: 1 }] }], refund: 'cash', reason: 'مرتجع سليم' } as never)
    S().postSaleReturn({ saleId: inv.id, lineSpecs: [{ lineIndex: 0, qty: 0.5, condition: 'damaged', batchAllocations: [{ batchId: soldBatch.id, qty: 0.5 }] }], refund: 'cash', reason: 'جزء تالف' } as never)
    expect(qtyOf(item.id)).toBe(18)
    expectInvariants()

    /* ⑥ جرد: عدّ 16 ⇒ عجز 2 يُقيَّد بقيد تسوية واحد متوازن */
    const variance = S().postStocktake(
      [{ itemId: item.id, nameAr: item.nameAr, expectedQty: 18, countedQty: 16, unitCostMinor: 1800 }],
      'جرد التدقيق',
    )
    expect(qtyOf(item.id)).toBe(16)
    expect(variance.journalEntryId).not.toBeNull()
    expectInvariants()

    /* ⑦ إتلاف 1 كجم: يخصم الرصيد ويقيّد 5111 بتكلفة المتوسط */
    S().postWastage({ reason: 'تلف تدقيق', lines: [{ itemId: item.id, qty: 1 }], notes: '' })
    expect(qtyOf(item.id)).toBe(15)
    expectInvariants()

    /* ⑧ تحويل بين مخزنين: الرصيد الكلي لا يتغير */
    S().postTransfer({ date: new Date().toISOString().slice(0, 10), fromWarehouseId: 1, toWarehouseId: 2, lines: [{ itemId: item.id, qty: 5 }], notes: 'تحويل تدقيق' } as never)
    expect(qtyOf(item.id)).toBe(15)
    expectInvariants()

    /* ⑨ إقفال الوردية بجرد نقدي: لا فرق غير مفسَّر */
    const shift = R().shifts.find((row) => row.closedAt == null)
    expect(shift).toBeTruthy()
    S().closeShift(R().sales.reduce((sum, row) => sum + row.totals.totalMinor, 0) - (R().saleReturns.reduce((sum, row) => sum + row.totals.totalMinor, 0)))
    expect(R().shifts.every((row) => row.closedAt != null)).toBe(true)
    expectInvariants()
  })

  it('ث5: الرفض لا يترك أثراً — بيع يتجاوز الرصيد وبضاعة منتهية الصلاحية', () => {
    const { item, supplierId } = seed()
    purchase(supplierId, [{ itemId: item.id, qty: 2, unitPriceMinor: 1000, expiryDate: '2020-01-01' }])
    S().openShift('كاشير', 0)
    const before = R()

    // كمية أكبر من الرصيد
    expect(() => sale([{ itemId: item.id, nameAr: item.nameAr, qty: 50, unitPriceMinor: 2500, unitCostMinor: 1000, soldByWeight: true }])).toThrow()
    expect(R().journal).toBe(before.journal)
    expect(qtyOf(item.id)).toBe(2)

    // بضاعة منتهية الصلاحية: البيع محظور ما لم يُذكر معتمد صريح
    expect(() => sale([{ itemId: item.id, nameAr: item.nameAr, qty: 1, unitPriceMinor: 2500, unitCostMinor: 1000, soldByWeight: true }])).toThrow()
    expect(R().sales).toHaveLength(0)
    expect(qtyOf(item.id)).toBe(2)
    expectInvariants()
  })

  it('ث4: كل مستودع يولّد قيده الخاص بمصدر مطابق — لا قيود يتيمة', () => {
    const { water, supplierId } = seed()
    purchase(supplierId, [{ itemId: water.id, qty: 10, unitPriceMinor: 100 }])
    S().openShift('كاشير', 0)
    const inv = sale([{ itemId: water.id, nameAr: water.nameAr, qty: 2, unitPriceMinor: 150, unitCostMinor: 100, soldByWeight: false }])

    const entry = R().journal.find((row) => row.id === inv.journalEntryId)!
    expect(entry.sourceType).toBe('sale')
    expect(entry.sourceId).toBe(inv.id)
    const purchaseEntry = R().journal.find((row) => row.sourceType === 'purchase')
    expect(purchaseEntry?.sourceId).toBe(R().purchases[0].id)
    // لا قيد بلا مستند (ما عدا الافتتاح/اليدوي/الإهلاك الدوري المسموح)
    const orphans = R().journal.filter((row) => row.sourceId == null && !['manual', 'opening', 'depreciation'].includes(row.sourceType))
    expect(orphans).toEqual([])
  })

  it('شجرة الحسابات: كل حساب مستخدم في الدفتر موجود وقابل للترحيل', () => {
    const { item, supplierId } = seed()
    purchase(supplierId, [{ itemId: item.id, qty: 1, unitPriceMinor: 1000 }])
    S().openShift('كاشير', 0)
    sale([{ itemId: item.id, nameAr: item.nameAr, qty: 1, unitPriceMinor: 2500, unitCostMinor: 1000, soldByWeight: false }])
    const postable = new Map(STANDARD_COA.map((account) => [account.code, account.isPostable !== false]))
    for (const entry of R().journal) {
      for (const line of entry.lines) {
        expect(postable.has(line.accountCode), `حساب غير معروف ${line.accountCode} في القيد #${entry.id}`).toBe(true)
        expect(postable.get(line.accountCode), `حساب تجميعي ${line.accountCode} استُخدم في الترحيل`).toBe(true)
      }
    }
  })
})

describe('جرد الفرع: لا يُقبل رصيد الشركة مكان رصيد الفرع ولا يمس بقية الفروع', () => {
  const branchSetup = () => {
    useRawDataStore.setState({
      branches: [
        { id: 1, nameAr: 'الرئيسي', isMain: true, warehouseId: 1, treasuryCode: '1101', active: true, customModulesMode: 'all', enabledModules: [] },
        { id: 2, nameAr: 'فرع', isMain: false, warehouseId: 2, treasuryCode: '1102', active: true, customModulesMode: 'all', enabledModules: [] },
      ] as never,
      warehouses: [{ id: 1, nameAr: 'رئيسي', code: 'M1', isMain: true }, { id: 2, nameAr: 'فرع', code: 'M2', isMain: false }] as never,
      activeBranchId: null,
      treasuries: [
        { code: '1101', nameAr: 'خزينة الرئيسي', kind: 'cash', isDefault: true },
        { code: '1102', nameAr: 'خزينة الفرع', kind: 'cash', isDefault: false },
      ] as never,
    })
    const item = seed().item
    purchase(useRawDataStore.getState().suppliers[0].id, [{ itemId: item.id, qty: 10, unitPriceMinor: 1000 }])
    S().postTransfer({ date: new Date().toISOString().slice(0, 10), fromWarehouseId: 1, toWarehouseId: 2, lines: [{ itemId: item.id, qty: 5 }], notes: 'توزيع' } as never)
    return item
  }
  const whQty = (warehouseId: number, itemId: number) => {
    const state = useRawDataStore.getState()
    const stock = computeWarehouseStock(state.items, state.warehouses, state.transfers, buildWarehouseDocs(state.purchases, state.sales, state.saleReturns, state.purchaseReturns, state.productionOrders, state.processingOrders, state.stocktakes))
    return stock.get(warehouseId)?.get(itemId) ?? 0
  }

  it('عدّ 5 في الفرع ومعدود 3 يخصم 2 من مخزن الفرع وحده', () => {
    const item = branchSetup()
    useRawDataStore.setState({ activeBranchId: 2 })
    expect(S().items.find((row) => row.id === item.id)!.stockQty).toBe(5) // ما يراه كاشير الفرع
    const st = S().postStocktake([{ itemId: item.id, nameAr: item.nameAr, expectedQty: 5, countedQty: 3, unitCostMinor: 1000 }], 'جرد فرع')
    expect(st.warehouseId).toBe(2)
    expect(useRawDataStore.getState().items.find((row) => row.id === item.id)!.stockQty).toBe(8) // الرصيد الكلي تغيّر بالفارق فقط
    expect(whQty(1, item.id)).toBe(5)
    expect(whQty(2, item.id)).toBe(3)
    expect(useRawDataStore.getState().items.find((row) => row.id === item.id)!.stockQty)
      .toBe(whQty(1, item.id) + whQty(2, item.id))
    expect(unbalanced(useRawDataStore.getState().journal)).toEqual([])
    // قيد واحد بقيمة الفارق وحده
    const entry = useRawDataStore.getState().journal.find((row) => row.id === st.journalEntryId)!
    const debit = entry.lines.reduce((sum, line) => sum + line.debit, 0)
    expect(debit).toBe(2000)
  })

  it('زيادة الجرد تُثبت دفعة في المخزن المعدود فيبقى الصنف قابلاً للبيع', () => {
    const item = branchSetup()
    useRawDataStore.setState({ activeBranchId: 2 })
    S().postStocktake([{ itemId: item.id, nameAr: item.nameAr, expectedQty: 5, countedQty: 7, unitCostMinor: 1000 }], 'زيادة جرد')
    const batches = useRawDataStore.getState().batches.filter((batch) => batch.itemId === item.id)
    expect(batches.reduce((sum, batch) => sum + batch.qty, 0)).toBe(12) // 7 في المخزن 2 + 5 في المخزن 1
    expect(batches.filter((batch) => batch.warehouseId === 2).reduce((sum, batch) => sum + batch.qty, 0)).toBe(7)
    // البيع من مخزن الفرع يجد دفعة تغطي الكمية (لا رفض «دفعات المخزن لا تغطي»)
    S().openShift('كاشير', 0)
    const invoice = sale([{ itemId: item.id, nameAr: item.nameAr, qty: 1, unitPriceMinor: 2500, unitCostMinor: 1000, soldByWeight: true }], { warehouseId: 2, treasury: '1102' })
    expect(invoice.totals.totalMinor).toBe(2500)
    expect(useRawDataStore.getState().items.find((row) => row.id === item.id)!.stockQty).toBe(11)
    expectInvariants()
  })

  it('يرفض الدفتري الكلي (10) لأن الفرع يرى 5 — برسالة تعرض رصيد الفرع', () => {
    const item = branchSetup()
    useRawDataStore.setState({ activeBranchId: 2 })
    const journalBefore = useRawDataStore.getState().journal.length
    let message = ''
    try {
      S().postStocktake([{ itemId: item.id, nameAr: item.nameAr, expectedQty: 10, countedQty: 8, unitCostMinor: 1000 }], 'جرد خاطئ')
    } catch (error) { message = (error as Error).message }
    expect(message).toContain('(5 حالياً)')
    expect(useRawDataStore.getState().items.find((row) => row.id === item.id)!.stockQty).toBe(10)
    expect(useRawDataStore.getState().journal.length).toBe(journalBefore)
  })
})

describe('نقل بضاعة الصلاحية بين المخازن (كان مرفوضاً قطعاً)', () => {
  it('يقسم الدفعة وينقلها موثقة بلا تغيير الرصيد الكلي ولا قيمة 1103', () => {
    const { item, supplierId } = seed()
    purchase(supplierId, [{ itemId: item.id, qty: 10, unitPriceMinor: 1000, expiryDate: '2099-06-30' }])
    const valueBefore = stockValue()
    const transfer = S().postTransfer({ date: new Date().toISOString().slice(0, 10), fromWarehouseId: 1, toWarehouseId: 2, lines: [{ itemId: item.id, qty: 4 }], notes: 'نقل مبرد' } as never)

    expect(qtyOf(item.id)).toBe(10)
    expect(stockValue()).toBe(valueBefore)
    const whQty = (warehouseId: number) => {
      const state = useRawDataStore.getState()
      return computeWarehouseStock(state.items, state.warehouses, state.transfers, buildWarehouseDocs(state.purchases, state.sales, state.saleReturns, state.purchaseReturns, state.productionOrders, state.processingOrders, state.stocktakes)).get(warehouseId)?.get(item.id) ?? 0
    }
    expect(whQty(1)).toBe(6)
    expect(whQty(2)).toBe(4)
    // الدفعات هي دليل النقل: مصدر 6 ووجهة 4، وكلتاهما تحمل نفس الصلاحية
    const batches = useRawDataStore.getState().batches.filter((batch) => batch.itemId === item.id)
    expect(batches.reduce((sum, batch) => sum + batch.qty, 0)).toBe(10)
    expect(batches.find((batch) => batch.warehouseId === 1)!.qty).toBe(6)
    const moved = batches.find((batch) => batch.warehouseId === 2)!
    expect(moved.qty).toBe(4)
    expect(moved.expiryDate).toBe('2099-06-30')
    expect(transfer.lines[0].batchAllocations?.reduce((sum, row) => sum + row.qty, 0)).toBe(4)
    expectInvariants()
  })

  it('يرفض كمية تفوق دفعات المخزن المصدر ولو كفى رصيد الصنف', () => {
    const { item, supplierId } = seed()
    purchase(supplierId, [{ itemId: item.id, qty: 5, unitPriceMinor: 1000, expiryDate: '2099-06-30' }])
    // رصيد الصنف 5 لكن الدفعة كلها في المخزن 1: طلب 5 من المخزن 2 يجب أن يُرفض
    expect(() => S().postTransfer({ date: new Date().toISOString().slice(0, 10), fromWarehouseId: 2, toWarehouseId: 1, lines: [{ itemId: item.id, qty: 5 }], notes: '' } as never)).toThrow()
  })
})
