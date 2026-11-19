import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { render, fireEvent, waitFor, cleanup, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

const { useDataStore } = await import('../src/data/repo.ts')
const { useAppStore } = await import('../src/stores/app.store.ts')
const { netWeightKg, itemTareGrams, ean13CheckDigit, MAX_TARE_GRAMS } = await import('../src/core/barcode.ts')
const { categoryAncestors } = await import('../src/core/items.ts')
const { resolvePrice, discountPercentFor } = await import('../src/core/priceLists.ts')
const { computeTotals, lineTotal } = await import('../src/core/pos.ts')
const { buildReturnLinesPerLine } = await import('../src/core/returns.ts')
const { PosPage } = await import('../src/ui/pages/PosPage.tsx')
const { StocktakePage } = await import('../src/ui/pages/StocktakePage.tsx')
const { ShiftsPage } = await import('../src/ui/pages/ShiftsPage.tsx')

const S = () => useDataStore.getState()
const scaleCode = (plu: number, grams: number) => {
  const body = `22${String(plu).padStart(5, '0')}${String(grams).padStart(5, '0')}`
  return body + ean13CheckDigit(body)
}
const itemInput = (over: Record<string, unknown>) => ({
  nameAr: 'صنف', sku: `SKU-${Math.random().toString(36).slice(2, 8)}`, barcodes: [], categoryId: 1,
  baseUnit: 'كجم', extraUnits: [], costMinor: 1000, stockQty: 0, priceMinor: 2000, minQty: 0,
  trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: true,
  variantColors: [], variantSizes: [], isActive: true, ...over,
})

beforeAll(() => {
  localStorage.clear()
  const app = useAppStore.getState()
  useAppStore.setState({
    ...app,
    setup: { ...app.setup, completed: true, countryCode: 'SA', activityId: 'grocery', shopName: 'بقالة الجولة السادسة', ownerName: 'م', features: [], modules: ['pos', 'inventory'], accountingMode: 'full' },
  })
})

beforeEach(() => cleanup())

describe('وزن الوعاء (Tare) — نواة الحساب', () => {
  it('يطرح وزن الوعاء ويعيد الصافي بثلاث خانات، ويصفّر عند وزن لا يغطي الوعاء', () => {
    expect(netWeightKg(0.75, 50)).toBe(0.7)
    expect(netWeightKg(1.004, 4)).toBe(1)
    expect(netWeightKg(0.75, 0)).toBe(0.75)
    expect(netWeightKg(0.2, 250)).toBe(0) // الوعاء أثقل من الوزن
    expect(netWeightKg(Number.NaN, 50)).toBe(0)
    expect(netWeightKg(-1, 50)).toBe(0)
  })

  it('يتجاهل وزن الوعاء غير الصالح (سالب/كسري/فوق الحد) فيبقى الوزن إجمالياً', () => {
    expect(itemTareGrams({ tareGrams: 120 })).toBe(120)
    expect(itemTareGrams({ tareGrams: -5 })).toBe(0)
    expect(itemTareGrams({ tareGrams: 12.5 })).toBe(0)
    expect(itemTareGrams({ tareGrams: MAX_TARE_GRAMS + 1 })).toBe(0)
    expect(itemTareGrams(null)).toBe(0)
    expect(netWeightKg(0.75, itemTareGrams({ tareGrams: -5 }))).toBe(0.75)
  })

  it('المستودع يحفظ وزن الوعاء للصنف الموزون ويرفضه لصنف بالعدد', () => {
    S().addItem(itemInput({ nameAr: 'فراولة', sku: 'FRW-1', soldByWeight: true, tareGrams: 40 }) as never)
    const saved = S().items.find((it) => it.sku === 'FRW-1')!
    expect(saved.tareGrams).toBe(40)

    expect(() => S().addItem(itemInput({ nameAr: 'مياه', sku: 'WTR-T', soldByWeight: false, tareGrams: 40 }) as never))
      .toThrow(/وزن الوعاء/)
    expect(() => S().addItem(itemInput({ nameAr: 'سلعة', sku: 'NEG-T', tareGrams: -1 }) as never))
      .toThrow(/وزن الوعاء/)
    expect(() => S().addItem(itemInput({ nameAr: 'سلعة', sku: 'BIG-T', tareGrams: MAX_TARE_GRAMS + 500 }) as never))
      .toThrow(/وزن الوعاء/)
  })
})

describe('قاعدة خصم الفئة تسري على الفئات الفرعية (شجرة البقالة)', () => {
  it('categoryAncestors يعيد السلسلة من الأب الأقرب إلى الجذر بلا الدوران', () => {
    const cats = [
      { id: 1, nameAr: 'بقالة', parentId: null, features: [] },
      { id: 2, nameAr: 'ألبان', parentId: 1, features: [] },
      { id: 3, nameAr: 'حليب', parentId: 2, features: [] },
    ] as never
    expect(categoryAncestors(3, cats)).toEqual([2, 1])
    expect(categoryAncestors(1, cats)).toEqual([])
    expect(categoryAncestors(null, cats)).toEqual([])
  })

  it('resolvePrice يطبّق قاعدة الأب على الصنف في الفئة الفرعية، والأخص يتقدم', () => {
    const lists = [{ id: 9, nameAr: 'جملة', defaultDiscountPercent: 0, isActive: true }]
    const rules = [
      { listId: 9, categoryId: 2, discountPercent: 10 }, // ألبان
      { listId: 9, categoryId: 3, discountPercent: 25 }, // حليب (أخص)
      { listId: 9, categoryId: 1, discountPercent: 50 }, // بقالة (أعمق)
    ]
    // حليب: قاعدة فئته نفسها 25٪
    expect(resolvePrice(5, 1000, 9, lists, [], rules, 3, [2, 1])).toBe(750)
    // زبادي في «ألبان» بلا قاعدة خاصة: يرث 10٪ لا 50٪
    expect(resolvePrice(6, 1000, 9, lists, [], rules, 2, [1])).toBe(900)
    // جبنة مباشرة تحت «بقالة»: ترث 50٪
    expect(resolvePrice(7, 1000, 9, lists, [], rules, 1, [])).toBe(500)
    // بلا فئة: لا قاعدة — السعر الأصلي
    expect(resolvePrice(8, 1000, 9, lists, [], rules, null, [])).toBe(1000)
  })

  it('نسبة الخصم المعروضة لا تُظهر 0.0٪ لخصم صغير حقيقي', () => {
    expect(discountPercentFor(1000, 900)).toBe(10)
    expect(discountPercentFor(1000, 996)).toBe(0.4) // 0.4٪ يظهر كما هو
    expect(discountPercentFor(100_000, 99_960)).toBe(0.04) // كان يُقرَّب إلى 0.0
    expect(discountPercentFor(1000, 1000)).toBe(0)
    expect(discountPercentFor(1000, 1200)).toBe(0)
    expect(discountPercentFor(0, 0)).toBe(0)
  })

  it('getEffectivePrice في المستودع يمرر سلسلة الفئات فيسري خصم الأب', () => {
    S().addCategory('بقالة الجذر', [], null)
    const root = S().categories.at(-1)!
    S().addCategory('ألبان', [], root.id)
    const dairy = S().categories.at(-1)!
    S().addCategory('حليب', [], dairy.id)
    const milk = S().categories.at(-1)!
    const list = S().addPriceList('جملة الجولة السادسة', 0)
    S().setPriceListCategoryRule(list.id, dairy.id, 10)
    S().addItem(itemInput({ nameAr: 'حليب طازج', sku: 'MLK-6', categoryId: milk.id, priceMinor: 1000, costMinor: 600 }) as never)
    const milkItem = S().items.find((it) => it.sku === 'MLK-6')!
    // قبل الإصلاح كان يرجع 1000 (قاعدة الأب لا تُرى) — الآن 900
    expect(S().getEffectivePrice(milkItem.id, list.id)).toBe(900)
    // والقائمة الافتراضية (بلا قائمة) تبقى بالسعر الأصلي
    expect(S().getEffectivePrice(milkItem.id, null)).toBe(1000)
  })
})

describe('خصم فاتورة الشراء يُطبَّق على القيد والتكلفة وضريبة المدخلات', () => {
  const buy = (over: Record<string, unknown> = {}) => {
    const existingSupplier = S().suppliers.find((sup) => sup.nameAr === 'مورد الجولة السادسة')
    if (!existingSupplier) S().addSupplier({ nameAr: 'مورد الجولة السادسة', phone: '' } as never)
    const supplier = S().suppliers.find((sup) => sup.nameAr === 'مورد الجولة السادسة')!
    return S().postPurchase({
      supplierId: supplier.id, date: '2026-11-17', expenses: [], paidMinor: 0, treasury: '1101',
      lines: [{ itemId: S().items.find((it) => it.sku === `PRD-${String(over.skuTag ?? 'A')}`)!.id, qty: 10, unitPriceMinor: 1000, vatPercent: 15 }],
      ...over,
    } as never)
  }

  it('خصم 10٪: بضاعة 9000 وضريبة 1350 ودين مورد 10350 وتكلفة وحدة 900', () => {
    S().addItem(itemInput({ nameAr: 'صنف الخصم أ', sku: 'PRD-A', barcodes: [], baseUnit: 'قطعة', soldByWeight: false, stockQty: 0 }) as never)
    const itemId = S().items.find((it) => it.sku === 'PRD-A')!.id
    const purchase = buy({ discountPercent: 10, skuTag: 'A' })
    const entry = S().journal.find((e) => e.id === purchase.journalEntryId)!
    const line = (code: string) => entry.lines.find((l) => l.accountCode === code)!
    expect(line('1103').debit).toBe(9000)
    expect(line('2102').debit).toBe(1350)
    expect(line('2101').credit).toBe(10350)
    expect(purchase.grandTotalMinor).toBe(9000)
    expect(purchase.supplierDueMinor).toBe(10350)
    // تكلفة الوحدة بعد الخصم وقبل المصاريف: 900 (لا 1000)
    expect(S().items.find((it) => it.id === itemId)!.costMinor).toBe(900)
    expect(S().items.find((it) => it.id === itemId)!.stockValueMinor).toBe(9000)
  })

  it('خصم مبلغ صريح يعادل النسبة، ويُرفض ما يزيد على قيمة البضاعة أو نسبة فوق 100', () => {
    S().addItem(itemInput({ nameAr: 'صنف الخصم ب', sku: 'PRD-B', barcodes: [], baseUnit: 'قطعة', soldByWeight: false }) as never)
    const purchase = buy({ discountMinor: 1000, skuTag: 'B' })
    expect(purchase.grandTotalMinor).toBe(9000)
    expect(purchase.supplierDueMinor).toBe(10350)
    expect(() => buy({ discountMinor: 11_500, skuTag: 'B' })).toThrow(/أكبر من قيمة البضاعة/)
    expect(() => buy({ discountPercent: 120, skuTag: 'B' })).toThrow(/بين 0 و100/)
  })
})

describe('الكاشير والجرد يحترمان وزن الوعاء وباركود الوحدة', () => {
  it('مسح ملصق ميزان 750 جم لصنف وعاؤه 50 جم يضيف 0.7 كجم صافياً', async () => {
    S().addItem(itemInput({ nameAr: 'زيتون بالوزن', sku: 'OLV-52', barcodes: [], categoryId: 1, baseUnit: 'كجم', costMinor: 1500, stockQty: 20, priceMinor: 2400, soldByWeight: true, tareGrams: 50 }) as never)
    const view = render(<MemoryRouter><PosPage /></MemoryRouter>)
    const input = view.container.querySelector('input[placeholder^="F2"]') as HTMLInputElement
    input.focus()
    fireEvent.change(input, { target: { value: scaleCode(52, 750) } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => {
      const row = view.container.querySelector('[data-entry-row]') as HTMLElement
      expect(row).toBeTruthy()
      expect(Number((row.querySelector('input[inputmode="decimal"]') as HTMLInputElement).value)).toBe(0.7)
    })
  })

  it('مسح باركود الكرتون في الجرد يضيف معامل الوحدة (12) لا 1', async () => {
    S().addItem(itemInput({
      nameAr: 'مياه كرتون', sku: 'CTN-61', barcodes: ['6281000777777'], categoryId: 1,
      baseUnit: 'قطعة', soldByWeight: false, stockQty: 120, priceMinor: 150,
      extraUnits: [{ nameAr: 'كرتونة', factor: 12, barcode: '6281000888888', priceMinor: 1700 }],
    }) as never)
    const view = render(<MemoryRouter><StocktakePage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: /بدء الجرد/ }))
    const scanInput = await waitFor(() => view.container.querySelector('input[placeholder^="امسح الباركود"]') as HTMLInputElement)
    fireEvent.change(scanInput, { target: { value: '6281000888888' } })
    fireEvent.keyDown(scanInput, { key: 'Enter' })
    await waitFor(() => {
      const row = [...view.container.querySelectorAll('tbody tr')].find((tr) => tr.textContent?.includes('مياه كرتون'))!
      expect((row.querySelector('input') as HTMLInputElement).value).toBe('12')
    })
  })

  it('ملصق ميزان في الجرد يُطرح منه وزن الوعاء كذلك', async () => {
    S().addItem(itemInput({ nameAr: 'لحم مفروم', sku: 'MET-71', barcodes: [], categoryId: 1, baseUnit: 'كجم', stockQty: 10, priceMinor: 3500, soldByWeight: true, tareGrams: 100 }) as never)
    const view = render(<MemoryRouter><StocktakePage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: /بدء الجرد/ }))
    const scanInput = await waitFor(() => view.container.querySelector('input[placeholder^="امسح الباركود"]') as HTMLInputElement)
    fireEvent.change(scanInput, { target: { value: scaleCode(71, 1100) } })
    fireEvent.keyDown(scanInput, { key: 'Enter' })
    await waitFor(() => {
      const row = [...view.container.querySelectorAll('tbody tr')].find((tr) => tr.textContent?.includes('لحم مفروم'))!
      expect((row.querySelector('input') as HTMLInputElement).value).toBe('1')
    })
  })
})

describe('تقرير X — معاينة الوردية بلا إقفال (بقالة)', () => {
  it('يعرض ملخص الوردية المفتوحة ويتركها مفتوحة (لا إقفال ولا قيد)', async () => {
    if (!S().shifts.some((sh) => sh.status === 'open')) S().openShift('كاشير الجولة السادسة', 50_000)
    const before = S().journal.length
    const view = render(<MemoryRouter><ShiftsPage /></MemoryRouter>)
    const xButton = await waitFor(() => {
      const btn = [...view.container.querySelectorAll('button')].find((b) => /تقرير X/.test(b.textContent ?? ''))
      expect(btn).toBeTruthy()
      return btn as HTMLButtonElement
    })
    fireEvent.click(xButton)
    await waitFor(() => expect(document.querySelector('[data-testid="shift-x-report"]')).toBeTruthy())
    const report = document.querySelector('[data-testid="shift-x-report"]') as HTMLElement
    expect(report.textContent).toContain('المتوقع في الدرج')
    // الوردية ما زالت مفتوحة ولم يُنشأ أي قيد بالمعاينة
    expect(S().shifts.some((sh) => sh.status === 'open')).toBe(true)
    expect(S().journal.length).toBe(before)
  })
})

describe('ملصق ميزان يحمل السعر: المدفوع = الملصق بالقرش حرفياً', () => {
  it('سعر ملصق 1000 وكيلو 3000: الإجمالي 1000 لا 999، والوزن 0.333 للخصم من المخزون', () => {
    const line = { itemId: 1, nameAr: 'جبن', qty: 0.333, unitPriceMinor: 3000, unitCostMinor: 2000, discountPercent: 0, soldByWeight: true, lineTotalOverrideMinor: 1000 } as never
    const totals = computeTotals([line], 0, 15, true, 2)
    expect(totals.grossMinor).toBe(1000)
    expect(totals.totalMinor).toBe(1000) // كان 999 قبل الإصلاح
    expect(lineTotal(line, 2)).toBe(1000)
    // بلا تجاوز (سلوك قديم): 999 — يوضح حجم الفرق الذي كان يُحمّله العميل/المنشأة
    expect(computeTotals([{ ...(line as object), lineTotalOverrideMinor: undefined } as never], 0, 15, true, 2).totalMinor).toBe(999)
  })

  it('الإرجاع الجزئي لسطر ملصق يرد حصته النسبية فقط', () => {
    const saleLine = { itemId: 1, nameAr: 'جبن', qty: 0.333, unitPriceMinor: 3000, unitCostMinor: 2000, discountPercent: 0, soldByWeight: true, lineTotalOverrideMinor: 1000 } as never
    const half = buildReturnLinesPerLine([saleLine], [], [{ lineIndex: 0, qty: 0.15, condition: 'good' }] as never)[0]
    // 0.15 من 0.333 ≈ 45٪ من 1000
    expect(half.lineTotalOverrideMinor).toBe(Math.round((1000 * 0.15) / 0.333))
    expect(half.lineTotalOverrideMinor!).toBeLessThan(1000)
    const refunded = computeTotals([half as never], 0, 15, true, 2)
    expect(refunded.totalMinor).toBeLessThan(1000)
  })

  it('الكاشير: مسح ملصق سعري يُدرج إجمالي السطر من الملصق ويُظهره كما هو', async () => {
    S().addItem(itemInput({ nameAr: 'زيتون سعري', sku: 'OLV-53', barcodes: [], categoryId: 1, baseUnit: 'كجم', stockQty: 20, priceMinor: 3000, soldByWeight: true }) as never)
    if (!useAppStore.getState().scaleRules.some((r) => r.prefix === '20' && r.enabled)) {
      useAppStore.getState().addScaleRule({ nameAr: 'سعر 20', prefix: '20', itemCodeLen: 5, valueLen: 5, valueType: 'price', valueDecimals: 2, checkDigit: 'auto', enabled: true } as never)
    }
    const body = `20${String(53).padStart(5, '0')}${String(1000).padStart(5, '0')}`
    const priceCode = body + ean13CheckDigit(body)
    const view = render(<MemoryRouter><PosPage /></MemoryRouter>)
    const input = view.container.querySelector('input[placeholder^="F2"]') as HTMLInputElement
    input.focus()
    fireEvent.change(input, { target: { value: priceCode } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => {
      const row = view.container.querySelector('[data-entry-row]') as HTMLElement
      expect(row).toBeTruthy()
      expect(Number((row.querySelector('input[inputmode="decimal"]') as HTMLInputElement).value)).toBeCloseTo(0.333, 3)
    })
    await waitFor(() => expect(view.container.textContent).toContain('10.00'))
    expect(view.container.textContent).not.toContain('9.99')
  })
})
