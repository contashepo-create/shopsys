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
export function resolvePrice(
  itemId: number,
  retailPriceMinor: Minor,
  listId: number | null,
  lists: PriceList[],
  entries: PriceListEntry[],
): Minor {
  if (listId == null) return retailPriceMinor
  const list = lists.find((l) => l.id === listId && l.isActive)
  if (!list) return retailPriceMinor
  const entry = entries.find((e) => e.listId === listId && e.itemId === itemId)
  if (entry) return entry.priceMinor
  if (list.defaultDiscountPercent > 0) {
    return Math.round(retailPriceMinor * (1 - list.defaultDiscountPercent / 100))
  }
  return retailPriceMinor
}
