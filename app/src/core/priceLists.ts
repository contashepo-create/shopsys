/**
 * قوائم الأسعار المتعددة — سد فجوة Easy Store
 * =============================================
 * قائمة أسعار مسماة (جملة/نصف جملة/VIP…) لكل صنف فيها سعر خاص اختياري.
 * العميل يُربط بقائمة، وعند اختياره في الكاشير تُسعَّر السلة تلقائياً:
 *   سعر الصنف = سعر القائمة إن وُجد، وإلا سعر التجزئة الافتراضي.
 *
 * لا أثر محاسبي مباشر — القيود تخرج بالسعر النهائي المطبق كالمعتاد،
 * لكن الحماية هنا: سعر القائمة لا يقل عن التكلفة إلا بتأكيد صريح
 * (تحذير لا منع — البيع تحت التكلفة قرار تجاري مشروع أحياناً).
 */
import type { Minor } from './money.ts'

export interface PriceList {
  id: number
  nameAr: string
  /** خصم افتراضي ٪ يُطبق على الأصناف التي لا سعر خاصاً لها في القائمة (0 = بلا) */
  defaultDiscountPercent: number
  isActive: boolean
}

/** سعر خاص لصنف داخل قائمة */
export interface PriceListEntry {
  listId: number
  itemId: number
  priceMinor: Minor
}

/**
 * خصم لكل **فئة** داخل نفس القائمة (قرار المالك ⑩ي البند ⑧):
 * العميل الواحد قد يشتري فئة أ بخصم وفئة ب بخصم آخر — بدل قائمة لكل فئة.
 * الأولوية: سعر الصنف الخاص ⇐ خصم فئته ⇐ الخصم الافتراضي للقائمة ⇐ سعر التجزئة.
 */
export interface PriceListCategoryRule {
  listId: number
  categoryId: number
  discountPercent: number
}

export function validateCategoryRule(discountPercent: number): string[] {
  const errors: string[] = []
  if (!Number.isFinite(discountPercent)) errors.push('نسبة الخصم غير صالحة')
  else if (discountPercent < 0 || discountPercent > 100) errors.push('خصم الفئة بين 0 و100')
  return errors
}

export function validatePriceList(nameAr: string, defaultDiscountPercent: number, existing: PriceList[], editingId?: number): string[] {
  const errors: string[] = []
  if (!nameAr.trim()) errors.push('اسم القائمة مطلوب')
  if (existing.some((l) => l.nameAr === nameAr.trim() && l.id !== editingId)) errors.push('يوجد قائمة بهذا الاسم')
  if (defaultDiscountPercent < 0 || defaultDiscountPercent > 100) errors.push('الخصم الافتراضي بين 0 و100')
  return errors
}

/**
 * السعر الفعلي لصنف حسب قائمة (أو null = تجزئة):
 * 1) سعر خاص في القائمة ← هو
 * 2) خصم افتراضي للقائمة ← تجزئة × (1 − خصم٪)
 * 3) غير ذلك ← سعر التجزئة
 */
/**
 * نسبة الخصم المعروضة = (قطاعي − سعر القائمة) / قطاعي.
 * التقريب العشري وحده كان يُظهر «0.0٪» لخصم حقيقي صغير (0.4 ريال على 1000)
 * فيظن البائع أن لا خصم — نعرض خانتين عشريتين حين يُخفي التقريب الخصم.
 */
export function discountPercentFor(retailMinor: number, priceMinor: number): number {
  if (!Number.isFinite(retailMinor) || retailMinor <= 0 || !Number.isFinite(priceMinor)) return 0
  const percent = ((retailMinor - priceMinor) / retailMinor) * 100
  if (percent <= 0) return 0
  const oneDecimal = Math.round(percent * 10) / 10
  if (oneDecimal > 0) return oneDecimal
  return Math.round(percent * 100) / 100
}

export function resolvePrice(
  itemId: number,
  retailPriceMinor: Minor,
  listId: number | null,
  lists: PriceList[],
  entries: PriceListEntry[],
  categoryRules: PriceListCategoryRule[] = [],
  categoryId: number | null = null,
  /**
   * سلسلة فئات الصنف من الأخص إلى الأعم (اختياري): في البقالة شجرة الفئات
   * عميقة (بقالة ← ألبان ← حليب)، فقاعدة «جملة» على «ألبان» يجب أن تسري على
   * «حليب». تُمرَّر السلسلة كاملة لأن الدالة نقية ولا تقرأ شجرة الفئات.
   */
  categoryAncestors: readonly number[] = [],
): Minor {
  if (listId == null) return retailPriceMinor
  const list = lists.find((l) => l.id === listId && l.isActive)
  if (!list) return retailPriceMinor
  const entry = entries.find((e) => e.listId === listId && e.itemId === itemId)
  if (entry) return entry.priceMinor
  /* ② خصم الفئة يسبق الخصم الافتراضي للقائمة (قرار المالك ⑩ي) —
     والأخص أولاً: فئة الصنف ثم آباؤها، فلا تُلغي قاعدة الجد قاعدة الأب. */
  const chain = categoryId == null ? [] : [categoryId, ...categoryAncestors]
  const seen = new Set<number>()
  for (const id of chain) {
    if (seen.has(id)) continue
    seen.add(id)
    const rule = categoryRules.find((row) => row.listId === listId && row.categoryId === id)
    if (rule && rule.discountPercent > 0) {
      return Math.round(retailPriceMinor * (1 - rule.discountPercent / 100))
    }
  }
  if (list.defaultDiscountPercent > 0) {
    return Math.round(retailPriceMinor * (1 - list.defaultDiscountPercent / 100))
  }
  return retailPriceMinor
}

/** وصف مصدر السعر لعرضه في شاشة قوائم الأسعار (شفافية للمالك). */
export function priceSource(
  itemId: number,
  listId: number | null,
  lists: PriceList[],
  entries: PriceListEntry[],
  categoryRules: PriceListCategoryRule[] = [],
  categoryId: number | null = null,
): 'retail' | 'item' | 'category' | 'list' {
  if (listId == null) return 'retail'
  const list = lists.find((l) => l.id === listId && l.isActive)
  if (!list) return 'retail'
  if (entries.some((e) => e.listId === listId && e.itemId === itemId)) return 'item'
  const rule = categoryId == null ? undefined : categoryRules.find((row) => row.listId === listId && row.categoryId === categoryId)
  if (rule && rule.discountPercent > 0) return 'category'
  return list.defaultDiscountPercent > 0 ? 'list' : 'retail'
}
