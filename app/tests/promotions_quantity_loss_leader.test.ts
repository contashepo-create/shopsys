import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import {
  promotionCartLines, promotionRetailMinor, promotionSavingsMinor,
  promotionAsBundle, validatePromotion, lossLeaderApprovedItems, type Promotion,
} from '../src/core/promotions.ts'
import { useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { todayLocalIso } from '../src/core/time.ts'

/**
 * F9 — قاعدة كمية «اشترِ N واحصل على M مجاناً».
 * F4 — اعتماد «البيع بخسارة» على مستوى العرض لا على مستوى كل فاتورة.
 *
 * العيب قبل الإصلاح: العروض كانت باقةً بسعر موحد فقط، فقاعدة «2+1» تُبنى بيدوية
 * (سطر بسعر صفر) فتنكسر حماية السعر أو تختل التكلفة. وبعدها كان بيع أي عرض تحت
 * التكلفة يطلب اعتماد مدير **لكل فاتورة**، فيصير غير عملي في البقالة.
 */

const items = [
  { id: 1, nameAr: 'كولا 330 مل', priceMinor: 1000, costMinor: 400, isActive: true, trackSerial: false, soldByWeight: false, minSalePriceMinor: 0, vatOverride: null },
  { id: 2, nameAr: 'جبن', priceMinor: 2500, costMinor: 2000, isActive: true, trackSerial: false, soldByWeight: false, minSalePriceMinor: 0, vatOverride: null },
]

const quantityPromo = (buyQty = 2, freeQty = 1, extra: Partial<Promotion> = {}): Promotion => ({
  id: 1, nameAr: 'كولا 2+1', kind: 'quantity', components: [], bundlePriceMinor: 0,
  quantityRule: { itemId: 1, buyQty, freeQty }, startIso: '', endIso: '', isActive: true, ...extra,
})

describe('F9 — قاعدة كمية 2+1', () => {
  it('دورة واحدة = 3 وحدات بإجمالي سعر وحدتين بالقرش، بلا سطر بسعر صفر', () => {
    const lines = promotionCartLines(quantityPromo(), 1, items)
    const total = lines.reduce((sum, l) => sum + l.qty * l.unitPriceMinor, 0)
    const units = lines.reduce((sum, l) => sum + l.qty, 0)
    expect(units).toBe(3)
    expect(total).toBe(2000)
    expect(lines.every((l) => l.unitPriceMinor > 0)).toBe(true)
    // القيمة القياسية: 3 × 10.00 = 30.00 والتكلفة الحقيقية للوحدات الثلاث
    expect(promotionRetailMinor(quantityPromo(), items)).toBe(3000)
    expect(promotionSavingsMinor(quantityPromo(), items)).toBe(1000)
  })

  it('العرض يحفظ التكلفة الحقيقية للوحدات المجانية (لا تكلفة صفر)', () => {
    const lines = promotionCartLines(quantityPromo(), 1, items)
    for (const line of lines) expect(line.unitCostMinor).toBe(400)
  })

  it('دورتان = 6 وحدات بإجمالي 4 وحدات، والإجمالي دقيق بلا كسور', () => {
    const lines = promotionCartLines(quantityPromo(), 2, items)
    const total = lines.reduce((sum, l) => sum + l.qty * l.unitPriceMinor, 0)
    expect(lines.reduce((sum, l) => sum + l.qty, 0)).toBe(6)
    expect(total).toBe(4000)
    expect(lines.every((l) => Number.isInteger(l.unitPriceMinor))).toBe(true)
  })

  it('سعر لا يغطي التكلفة يُرفض بلا اعتماد على مستوى العرض (F4)', () => {
    const errs = validatePromotion(quantityPromo(2, 1), [], [{ ...items[0], costMinor: 900 }], () => false)
    expect(errs.join(' ')).toContain('اعتماد')
    const approved = validatePromotion(quantityPromo(2, 1, { belowCostApprovedBy: 'المالك' }), [], [{ ...items[0], costMinor: 900 }], () => false)
    expect(approved).toEqual([])
  })

  it('قاعدة بأرقام فاسدة أو صنف غير صالح تُرفض', () => {
    expect(validatePromotion(quantityPromo(0, 1), [], items, () => false).length).toBeGreaterThan(0)
    expect(validatePromotion(quantityPromo(2, 0), [], items, () => false).length).toBeGreaterThan(0)
    expect(validatePromotion(quantityPromo(2, 1, { quantityRule: { itemId: 99, buyQty: 2, freeQty: 1 } }), [], items, () => false).length).toBeGreaterThan(0)
    expect(validatePromotion(quantityPromo(2, 1), [], [{ ...items[0], soldByWeight: true }], () => false).join(' ')).toContain('الوزن')
  })

  it('promotionAsBundle يحوّل القاعدة إلى باقة مكافئة (مسار حساب واحد)', () => {
    const shape = promotionAsBundle(quantityPromo(), items)
    expect(shape.components).toEqual([{ itemId: 1, qty: 3 }])
    expect(shape.bundlePriceMinor).toBe(2000)
  })
})

describe('F4 — اعتماد البيع بخسارة على مستوى العرض', () => {
  const today = todayLocalIso()
  it('العرض المعتمد الساري يغطي أصنافه، وغير المعتمد أو المنتهي لا يغطي', () => {
    const approved = quantityPromo(2, 1, { belowCostApprovedBy: 'المالك', endIso: today })
    const notApproved = quantityPromo(2, 1)
    const expired = quantityPromo(2, 1, { belowCostApprovedBy: 'المالك', endIso: '2020-01-01' })
    expect([...lossLeaderApprovedItems([approved], today)]).toEqual([1])
    expect([...lossLeaderApprovedItems([notApproved], today)]).toEqual([])
    expect([...lossLeaderApprovedItems([expired], today)]).toEqual([])
  })
})

/* ─── طبقة المتجر: الاعتماد يُسجَّل ويُستهلك عند الفواتير ─── */
const initial = useRawDataStore.getState()
const app = useAppStore.getState()
const S = () => useDataStore.getState()

beforeEach(() => {
  useAppStore.setState({ ...app, setup: { ...app.setup, completed: true, countryCode: 'SA', taxInclusive: false, vatPercent: 0, allowNegativeTreasury: true } })
  useRawDataStore.setState({ ...initial, branches: [], activeBranchId: null, journal: [], promotions: [], items: [], customers: [], sales: [], batches: [], warehouses: [], stockMoves: [], shifts: [], currentUserId: null } as never)
})
afterEach(() => {
  useRawDataStore.setState(initial, true)
  useAppStore.setState(app, true)
})

describe('F4 مع المتجر: اعتماد العرض يمرّر البيع تحت التكلفة بلا اعتماد لكل فاتورة', () => {
  const addItem = (patch: Record<string, unknown> = {}) => {
    S().addItem({
      nameAr: 'كولا', sku: '', barcodes: [], categoryId: 1, baseUnit: 'علبة', extraUnits: [],
      costMinor: 900, stockQty: 100, priceMinor: 1000, minQty: 0, trackExpiry: false,
      trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true, ...patch,
    } as never)
    return S().items.at(-1)!
  }

  it('بلا اعتماد: البيع تحت التكلفة يُرفض كما كان', () => {
    const item = addItem()
    expect(() => S().postSale({
      lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 1, unitPriceMinor: 500, unitCostMinor: 900, discountPercent: 0, soldByWeight: false }],
      customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, paidMinor: 500, treasury: '1101',
    } as never)).toThrow(/اعتماد|التكلفة|الحد/)
  })

  it('بعرض معتمد: يمرّ بلا اعتماد مدير، وبعرض غير معتمد يُرفض', () => {
    const item = addItem()
    // عرض خاسر بلا نهاية سريان يُرفض حفظه أصلاً (اعتماد مفتوح ممنوع)
    expect(() => S().addPromotion({
      nameAr: 'كولا 2+1', kind: 'quantity', components: [], bundlePriceMinor: 0,
      quantityRule: { itemId: item.id, buyQty: 2, freeQty: 1 }, startIso: '', endIso: '', isActive: true,
    } as never)).toThrow(/نهاية سريان/)

    const promo = S().addPromotion({
      nameAr: 'كولا 2+1', kind: 'quantity', components: [], bundlePriceMinor: 0,
      quantityRule: { itemId: item.id, buyQty: 2, freeQty: 1 }, startIso: '', endIso: '2099-12-31', isActive: true,
    } as never)
    // لا يُباع قبل الاعتماد
    expect(() => S().getPromotionCartLines(promo.id, 1)).toThrow(/اعتماد/)
    S().approvePromotionBelowCost(promo.id, 'المالك')
    expect(S().getPromotionCartLines(promo.id, 1).length).toBeGreaterThan(0)
    expect([...lossLeaderApprovedItems(S().promotions, todayLocalIso())]).toEqual([item.id])

    const lines = [{ itemId: item.id, nameAr: item.nameAr, qty: 3, unitPriceMinor: 600, unitCostMinor: 900, discountPercent: 0, soldByWeight: false }]
    const sale = S().postSale({
      lines, customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, paidMinor: 1800, treasury: '1101',
    } as never)
    expect(sale.totals.totalMinor).toBe(1800)

    // سحب الاعتماد يعيد الحماية
    S().revokePromotionBelowCost(promo.id)
    expect(() => S().getPromotionCartLines(promo.id, 1)).toThrow(/اعتماد/)
    expect(() => S().postSale({
      lines, customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, paidMinor: 1800, treasury: '1101',
    } as never)).toThrow(/اعتماد|التكلفة|الحد/)
  })
})
