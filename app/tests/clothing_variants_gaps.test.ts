import { describe, expect, it } from 'vitest'
import {
  validatePurchaseVariantBreakdown,
  applyPurchaseVariantBreakdown,
  variantLowStockAlerts,
  variantBarcode,
  resolveVariantBarcode,
  longUndistributedVariants,
  type VariantStock,
} from '../src/core/variants.ts'
import { stagnantVariants, sizeCurveAnalysis, type SaleDoc } from '../src/core/reports.ts'

describe('توزيع تركيبات لون/مقاس مباشرة في سطر فاتورة الشراء (فجوة فورية ① — نشاط الملابس)', () => {
  it('يرفض تركيبة من لون/مقاس ليس من ألوان/مقاسات الصنف', () => {
    const errors = validatePurchaseVariantBreakdown({
      breakdown: [{ color: 'أزرق', size: 'XL', qty: 2 }],
      purchasedQty: 10,
      itemColors: ['أحمر', 'أسود'],
      itemSizes: ['M', 'L'],
    })
    expect(errors.length).toBeGreaterThan(0)
  })

  it('يرفض مجموع توزيع يتجاوز الكمية المشتراة بالسطر', () => {
    const errors = validatePurchaseVariantBreakdown({
      breakdown: [{ color: 'أحمر', size: 'M', qty: 6 }, { color: 'أحمر', size: 'L', qty: 5 }],
      purchasedQty: 10,
      itemColors: ['أحمر'],
      itemSizes: ['M', 'L'],
    })
    expect(errors.length).toBeGreaterThan(0)
  })

  it('يقبل توزيعاً جزئياً (الباقي يبقى غير موزَّع كالمعتاد)', () => {
    const errors = validatePurchaseVariantBreakdown({
      breakdown: [{ color: 'أحمر', size: 'M', qty: 4 }],
      purchasedQty: 10,
      itemColors: ['أحمر'],
      itemSizes: ['M', 'L'],
    })
    expect(errors).toEqual([])
  })

  it('يدمج التوزيع تراكمياً فوق رصيد قائم لنفس التركيبة، لا يستبدله', () => {
    const existing: VariantStock[] = [{ itemId: 1, color: 'أحمر', size: 'M', qty: 3 }]
    const next = applyPurchaseVariantBreakdown(existing, 1, [{ color: 'أحمر', size: 'M', qty: 4 }, { color: 'أحمر', size: 'L', qty: 2 }])
    expect(next.find((v) => v.color === 'أحمر' && v.size === 'M')?.qty).toBe(7)
    expect(next.find((v) => v.color === 'أحمر' && v.size === 'L')?.qty).toBe(2)
  })
})

describe('تنبيه نقص مخزون على مستوى التركيبة (فجوة فورية ② — نشاط الملابس)', () => {
  const items = [{ id: 1, nameAr: 'قميص', minQty: 10, isActive: true }]
  it('تركيبة برصيد صفر دائماً «نافدة» حتى لو كان الصنف بلا حد إعادة طلب', () => {
    const noMinItems = [{ id: 1, nameAr: 'قميص', minQty: 0, isActive: true }]
    const stocks: VariantStock[] = [{ itemId: 1, color: 'أحمر', size: 'M', qty: 0 }, { itemId: 1, color: 'أزرق', size: 'M', qty: 5 }]
    const rows = variantLowStockAlerts(stocks, noMinItems)
    expect(rows.some((r) => r.color === 'أحمر' && r.kind === 'out')).toBe(true)
    expect(rows.some((r) => r.color === 'أزرق')).toBe(false)
  })

  it('يحسب عتبة تناسبية من حد إعادة طلب الصنف مقسوماً على عدد التركيبات', () => {
    // minQty=10 على تركيبتين ⇒ عتبة 5 لكل تركيبة
    const stocks: VariantStock[] = [{ itemId: 1, color: 'أحمر', size: 'M', qty: 4 }, { itemId: 1, color: 'أزرق', size: 'M', qty: 20 }]
    const rows = variantLowStockAlerts(stocks, items)
    const red = rows.find((r) => r.color === 'أحمر')
    expect(red?.kind).toBe('low')
    expect(rows.some((r) => r.color === 'أزرق')).toBe(false)
  })

  it('يتجاهل الأصناف المعطَّلة', () => {
    const stocks: VariantStock[] = [{ itemId: 1, color: 'أحمر', size: 'M', qty: 0 }]
    const rows = variantLowStockAlerts(stocks, [{ id: 1, nameAr: 'قميص', minQty: 10, isActive: false }])
    expect(rows).toEqual([])
  })
})

describe('باركود مستقل لكل تركيبة والمسح العكسي (فجوة فورية ④ وتطوير مستقبلي ① — نشاط الملابس)', () => {
  const colors = ['أحمر', 'أزرق']
  const sizes = ['M', 'L']
  it('يبني كوداً ثابتاً من فهرس اللون/المقاس', () => {
    expect(variantBarcode('6221000', colors, sizes, 'أحمر', 'M')).toBe('6221000-0101')
    expect(variantBarcode('6221000', colors, sizes, 'أزرق', 'L')).toBe('6221000-0202')
  })

  it('يعيد بناء (itemId, color, size) من كود ممسوح صالح', () => {
    const items = [{ id: 7, barcodes: ['6221000'], sku: '', variantColors: colors, variantSizes: sizes }]
    const resolved = resolveVariantBarcode('6221000-0202', items)
    expect(resolved).toEqual({ itemId: 7, color: 'أزرق', size: 'L' })
  })

  it('يرجع null لكود غير مطابق لأي صنف/تركيبة', () => {
    const items = [{ id: 7, barcodes: ['6221000'], sku: '', variantColors: colors, variantSizes: sizes }]
    expect(resolveVariantBarcode('9999999-0101', items)).toBeNull()
    expect(resolveVariantBarcode('لا-شرطة', items)).toBeNull()
  })
})

describe('تذكير التركيبات غير الموزَّعة منذ فترة طويلة (تطوير مستقبلي ④ — نشاط الملابس)', () => {
  const items = [{ id: 1, nameAr: 'قميص', stockQty: 10, isActive: true, variantColors: ['أحمر'], variantSizes: ['M'] }]
  it('لا تنبيه لو التوزيع حديث (أقل من العتبة بالأيام)', () => {
    const rows = longUndistributedVariants(items, [{ itemId: 1, color: 'أحمر', size: 'M', qty: 2 }], new Map([[1, '2026-01-13']]), '2026-01-14T00:00:00.000Z', 3)
    expect(rows).toEqual([])
  })

  it('ينبّه لو تجاوز العتبة والكمية غير موزَّعة بالكامل', () => {
    const rows = longUndistributedVariants(items, [{ itemId: 1, color: 'أحمر', size: 'M', qty: 2 }], new Map([[1, '2026-01-01']]), '2026-01-14T00:00:00.000Z', 3)
    expect(rows).toHaveLength(1)
    expect(rows[0].undistributedQty).toBe(8)
    expect(rows[0].daysSincePurchase).toBe(13)
  })

  it('لا تنبيه لو لا شيء غير موزَّع', () => {
    const rows = longUndistributedVariants(items, [{ itemId: 1, color: 'أحمر', size: 'M', qty: 10 }], new Map([[1, '2026-01-01']]), '2026-01-14T00:00:00.000Z', 3)
    expect(rows).toEqual([])
  })
})

describe('ركود التركيبات لون×مقاس (فجوة فورية ③ — نشاط الملابس)', () => {
  const items = [{ id: 1, nameAr: 'قميص', stockQty: 10, costMinor: 10000, stockValueMinor: 100_001, isActive: true }]
  const stocks: VariantStock[] = [{ itemId: 1, color: 'أحمر', size: 'XS', qty: 5 }, { itemId: 1, color: 'أزرق', size: 'L', qty: 5 }]
  const makeSale = (date: string, color: string, size: string): SaleDoc => ({
    id: 1, invoiceNumber: 'S1', date, customerId: null, payment: 'cash',
    lines: [{ itemId: 1, nameAr: 'قميص', qty: 1, unitPriceMinor: 15000, unitCostMinor: 10000, discountPercent: 0, soldByWeight: false, variantColor: color, variantSize: size }],
    totals: { grossMinor: 15000, discountMinor: 0, netMinor: 15000, taxBaseMinor: 15000, taxMinor: 0, totalMinor: 15000, cogsMinor: 10000 },
  })

  it('يظهر ركود تركيبة واحدة (الأحمر XS) بينما الأزرق L يتحرك بانتظام — فجوة لا يرصدها تقرير ركود الصنف العام', () => {
    const sales = [makeSale('2026-02-15', 'أزرق', 'L')] // الأزرق بيع حديثاً، الأحمر لم يُبع إطلاقاً
    const rows = stagnantVariants(items, stocks, sales, '2026-02-20T00:00:00.000Z', 30)
    expect(rows).toHaveLength(1)
    expect(rows[0].color).toBe('أحمر')
    expect(rows[0].stockValueMinor).toBe(50_001) // حصة تقريبية تضمن توزيع القيمة الدقيقة بلا فقد
    expect(rows[0].idleDays).toBe(-1) // لم يُبع قط
  })

  it('لا ركود لو كل التركيبات بيعت حديثاً', () => {
    const sales = [makeSale('2026-02-15', 'أحمر', 'XS'), makeSale('2026-02-15', 'أزرق', 'L')]
    const rows = stagnantVariants(items, stocks, sales, '2026-02-20T00:00:00.000Z', 30)
    expect(rows).toEqual([])
  })
})

describe('تحليل منحنى المقاسات Size Curve Analysis (تطوير مستقبلي ② — نشاط الملابس)', () => {
  const items = [{ id: 1, nameAr: 'قميص', isActive: true }]
  const makeSale = (size: string, qty: number): SaleDoc => ({
    id: 1, invoiceNumber: 'S1', date: '2026-01-10', customerId: null, payment: 'cash',
    lines: [{ itemId: 1, nameAr: 'قميص', qty, unitPriceMinor: 15000, unitCostMinor: 10000, discountPercent: 0, soldByWeight: false, variantSize: size }],
    totals: { grossMinor: 15000, discountMinor: 0, netMinor: 15000, taxBaseMinor: 15000, taxMinor: 0, totalMinor: 15000, cogsMinor: 10000 },
  })

  it('يحسب نسبة كل مقاس من إجمالي مبيعات الصنف', () => {
    const rows = sizeCurveAnalysis(items, [makeSale('M', 6), makeSale('L', 2), makeSale('XL', 2)])
    const m = rows.find((r) => r.size === 'M')
    expect(m?.soldQty).toBe(6)
    expect(m?.sharePercent).toBe(60)
    expect(rows.reduce((s, r) => s + r.sharePercent, 0)).toBeCloseTo(100, 5)
  })

  it('يتجاهل سطور بلا مقاس', () => {
    const sale: SaleDoc = {
      id: 1, invoiceNumber: 'S1', date: '2026-01-10', customerId: null, payment: 'cash',
      lines: [{ itemId: 1, nameAr: 'قميص', qty: 1, unitPriceMinor: 15000, unitCostMinor: 10000, discountPercent: 0, soldByWeight: false }],
      totals: { grossMinor: 15000, discountMinor: 0, netMinor: 15000, taxBaseMinor: 15000, taxMinor: 0, totalMinor: 15000, cogsMinor: 10000 },
    }
    expect(sizeCurveAnalysis(items, [sale])).toEqual([])
  })
})
