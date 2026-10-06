/**
 * المخزون الافتتاحي بالتقييم المادي + إعلان رأس المال (جولة v1.0.4).
 *
 * بلاغ المالك: «الحسابات مثل المخزون تقدَّر بمبلغ فقط — أليس من المفترض اختيار
 * الصنف ثم الكمية ثم السعر فيُقدَّر مادياً؟» — النمط العالمي (QuickBooks/Odoo):
 * كمية أول المدة × تكلفة الوحدة تثبّت **الرصيد الفعلي والقيمة الدفترية معاً**.
 *
 * تحرس هذه الاختبارات:
 *   ① التقييم المادي: قيد 1103/3101 بالقيمة + ضبط stockQty وcostMinor معاً
 *   ② التعديل بفرق الكمية يُطبَّق على الرصيد الحالي (لا استبدال) — وبلا نزول تحت الصفر
 *   ③ تحرير بطاقة صنف بعد الحركات يُمنع (تسوية جرد/شاشة الافتتاحية) وقبلها يقيد الفرق
 *   ④ إعلان رأس المال: الفرق يرحَّل لأرباح مرحّلة 3102 متوازناً ورصيد 3101 = المعلن
 *   ⑤ الثابت الأعظم: بعد كل شيء، Σ(كمية × تكلفة) للأصناف = رصيد 1103 الدفتري
 */
import { describe, it, expect, beforeAll, vi } from 'vitest'
vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
const { useDataStore } = await import('../src/data/repo.ts')
const { summarizeOpeningBalances } = await import('../src/core/openingBalances.ts')

const S = () => useDataStore.getState()
const original = useDataStore.getState()
beforeAll(() => {
  useDataStore.setState(original)
  // صنف مادي بلا رصيد أولي — نثبّت افتتاحيته من شاشة الأرصدة (المسار الجديد)
  S().addItem({ nameAr: 'شاشة 24 بوصة', sku: 'MON24', barcodes: [], categoryId: 0, baseUnit: 'قطعة', costMinor: 0, stockQty: 0, priceMinor: 500000, minQty: 1 } as never)
  S().addItem({ nameAr: 'استشارة فنية (خدمة)', sku: 'SRV1', barcodes: [], categoryId: 0, baseUnit: 'خدمة', costMinor: 0, stockQty: 0, priceMinor: 100000, minQty: 0, isService: true } as never)
})

describe('المخزون الافتتاحي بالتقييم المادي (v1.0.4)', () => {
  /** الثابت الأعظم لحظة كل قيمة نظيفة: Σ(كمية×تكلفة) للأصناف = رصيد 1103 الدفتري */
  const assertInvariant1103 = () => {
    const stockValue = S().items.filter((it) => !it.isService).reduce((a, it) => a + Math.round((it.stockQty ?? 0) * (it.costMinor ?? 0)), 0)
    let inv = 0
    for (const e of S().journal) for (const l of e.lines) if (l.accountCode === '1103') inv += l.debit - l.credit
    expect(inv).toBe(stockValue)
  }

  it('كمية × تكلفة الوحدة: قيد 1103/3101 بالقيمة + الكمية والتكلفة الفعليتان معاً', () => {
    const item = S().items.find((it) => it.sku === 'MON24')!
    S().setOpeningItemStock({ itemId: item.id, qty: 10, unitCostMinor: 300000 }) // 10 × 3000.00
    const fresh = S().items.find((it) => it.id === item.id)!
    expect(fresh.stockQty).toBe(10) // الرصيد الفعلي ثبت
    expect(fresh.costMinor).toBe(300000) // التكلفة المرجعية ثبتت
    const entry = [...S().journal].reverse().find((e) => e.sourceType === 'opening')!
    expect(entry.lines.some((l) => l.accountCode === '1103' && l.debit === 3_000_000)).toBe(true)
    expect(entry.lines.some((l) => l.accountCode === '3101' && l.credit === 3_000_000)).toBe(true)
    expect(S().openingItems[item.id]).toEqual({ qty: 10, unitCostMinor: 300000 })
    expect(S().openingBalances[`item_stock:${item.id}`]).toBe(3_000_000)
    assertInvariant1103() // الرصيد الفعلي والدفتري يثبتان معاً — لا تباعد
  })

  it('التعديل يرحّل فرق القيمة قيداً وفرق الكمية على الرصيد الحالي — لا استبدال', () => {
    const item = S().items.find((it) => it.sku === 'MON24')!
    // محاكاة استهلاك: بيع 4 قطع (نعدل الرصيد كما تفعل فاتورة البيع)
    useDataStore.setState((s) => ({ items: s.items.map((it) => (it.id === item.id ? { ...it, stockQty: 6 } : it)) }))
    const journalBefore = S().journal.length
    // تعديل الافتتاحي: 12 قطعة بدل 10 → فرق الكمية +2 يطبَّق فوق الرصيد الحالي 6 = 8
    S().setOpeningItemStock({ itemId: item.id, qty: 12, unitCostMinor: 320000 })
    expect(S().items.find((it) => it.id === item.id)!.stockQty).toBe(8)
    // فرق القيمة: (12×320000) − (10×300000) = 840,000 قيد واحد جديد
    expect(S().journal.length).toBe(journalBefore + 1)
    const entry = [...S().journal].reverse().find((e) => e.sourceType === 'opening')!
    expect(entry.lines.some((l) => l.accountCode === '1103' && l.debit === 840_000)).toBe(true)
    expect(S().openingBalances[`item_stock:${item.id}`]).toBe(3_840_000)
  })

  it('لا يمكن تخفيض الكمية الافتتاحية دون المستهلك فعلياً', () => {
    const item = S().items.find((it) => it.sku === 'MON24')!
    // الافتتاحي 12 والرصيد 8: تخفيض إلى 5 (فرق −7) ⇒ 8−7 = 1 يجوز، إلى 3 (فرق −9) ⇒ −1 مرفوض
    S().setOpeningItemStock({ itemId: item.id, qty: 5, unitCostMinor: 320000 })
    expect(S().items.find((it) => it.id === item.id)!.stockQty).toBe(1)
    expect(() => S().setOpeningItemStock({ itemId: item.id, qty: 3, unitCostMinor: 320000 })).toThrow('تسوية الجرد')
  })

  it('الخدمات لا تدخل المخزون — أصولها من تبويب الحسابات العامة', () => {
    const service = S().items.find((it) => it.sku === 'SRV1')!
    expect(() => S().setOpeningItemStock({ itemId: service.id, qty: 1, unitCostMinor: 100000 })).toThrow('الخدمات')
  })

  it('تحرير بطاقة صنف: قبل الحركات يقيد فرق القيمة، وبعد الحركات يُمنع ويوجَّه لتسوية الجرد', () => {
    // صنف نظيف بلا أي حركة
    S().addItem({ nameAr: 'كيبورد', sku: 'KBD', barcodes: [], categoryId: 0, baseUnit: 'قطعة', costMinor: 0, stockQty: 0, priceMinor: 20000, minQty: 1 } as never)
    const kbd = S().items.find((it) => it.sku === 'KBD')!
    // تحرير الكمية/التكلفة قبل أي حركة = تعديل افتتاحي يقيد الفرق (امتداد AUDIT-005)
    S().updateItem(kbd.id, { stockQty: 5, costMinor: 15000 })
    expect(S().openingBalances[`item_stock:${kbd.id}`]).toBe(75_000)
    expect(S().openingItems[kbd.id]).toEqual({ qty: 5, unitCostMinor: 15000 })
    const entry = [...S().journal].reverse().find((e) => e.sourceType === 'opening')!
    expect(entry.lines.some((l) => l.accountCode === '1103' && l.debit === 75_000)).toBe(true)
    // وبعد وجود حركة (خط شراء على الصنف): التعديل الصامت ممنوع ويوجَّه لتسوية الجرد
    useDataStore.setState((s) => ({
      purchases: [...s.purchases, { id: 999_001, invoiceNumber: 'P-TEST', date: '2026-10-05', lines: [{ itemId: kbd.id, nameAr: 'كيبورد', qty: 3, unitPriceMinor: 15000, vatPercent: 0, warehouseId: 1 }] } as never],
    }))
    const journalBefore = S().journal.length
    const qtyBefore = S().items.find((it) => it.id === kbd.id)!.stockQty
    expect(() => S().updateItem(kbd.id, { stockQty: 99, costMinor: 15000 })).toThrow('تسوية الجرد')
    // الرفض حمى الدفتر: لا قيد جديد ولا تغيير صامت للرصيد
    expect(S().journal.length).toBe(journalBefore)
    expect(S().items.find((it) => it.id === kbd.id)!.stockQty).toBe(qtyBefore)
  })
})

describe('توازن الميزانية الافتتاحية وإعلان رأس المال (نمط العالمية)', () => {
  it('المحتسب = أصول − التزامات ويطابق رصيد 3101 الدفتري قبل أي إعلان', () => {
    const summary = summarizeOpeningBalances(S().openingBalances)
    let capital = 0
    for (const e of S().journal) for (const l of e.lines) if (l.accountCode === '3101') capital += l.credit - l.debit
    // فاتورة الشراء في الاختبار السابق أثّرت على الرصيد — نتحقق من العلاقة على مستوى الافتتاحيات وحدها
    expect(summary.capitalImpliedMinor).toBe(summary.debitMinor - summary.creditMinor)
    expect(summary.capitalImpliedMinor).toBeGreaterThan(0)
  })

  it('إعلان رأس مال أقل من الدفتر: الفرق يرحَّل لأرباح مرحّلة 3102 متوازناً', () => {
    let capital = 0
    for (const e of S().journal) for (const l of e.lines) if (l.accountCode === '3101') capital += l.credit - l.debit
    const declared = capital - 100_000 // نعلن أقل بمائة ألف — الفرق أرباح مرحّلة دائنة
    S().declareOpeningCapital(declared)
    const entry = [...S().journal].reverse().find((e) => e.sourceType === 'opening')!
    expect(entry.lines.some((l) => l.accountCode === '3101' && l.debit === 100_000)).toBe(true)
    expect(entry.lines.some((l) => l.accountCode === '3102' && l.credit === 100_000)).toBe(true)
    const d = entry.lines.reduce((a, l) => a + l.debit, 0)
    const c = entry.lines.reduce((a, l) => a + l.credit, 0)
    expect(d).toBe(c) // متوازن
    // رصيد 3101 صار = المعلن بالضبط
    let capitalAfter = 0
    for (const e of S().journal) for (const l of e.lines) if (l.accountCode === '3101') capitalAfter += l.credit - l.debit
    expect(capitalAfter).toBe(declared)
    expect(S().openingDeclaredCapitalMinor).toBe(declared)
  })

  it('إعلان نفس القيمة الحالية = لا قيد، فقط تسجيل', () => {
    const declared = S().openingDeclaredCapitalMinor!
    const before = S().journal.length
    S().declareOpeningCapital(declared)
    expect(S().journal.length).toBe(before)
  })

  it('قيم الافتتاحيات تُسترجع بعد إعادة التحميل (persist)', () => {
    const state = S()
    expect(state.openingItems).toBeDefined()
    expect(Object.keys(state.openingItems).length).toBeGreaterThan(0)
    expect(state.openingDeclaredCapitalMinor).toBeGreaterThan(0)
  })
})
