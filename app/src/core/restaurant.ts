/**
 * أوامر المطعم المفتوحة (جولة مراجعة نشاط المطعم — نمط Foodics وبرامج المطاعم):
 * الصالة لا تعمل «فاتورة فورية»: الطاولة تفتح أمراً يظل مفتوحاً تُضاف له
 * الأصناف طوال الجلسة، والمطبخ يستلم بوناً بلا أسعار، وعند المغادرة فقط
 * يُقفل الأمر بفاتورة (postSale) فتتولد المحاسبة — قبلها لا شيء يلمس الدفاتر.
 * الأنواع: صالة (طاولة إلزامية) / تيك أواي / دليفري (رسوم توصيل).
 * رسوم الخدمة والتوصيل تُحقن كسطور بيع صناعية (itemId=-1، بلا مخزون ولا تكلفة)
 * فتدخل الإجمالي والضريبة والإيصال كأي سطر — والقيد عبر 4101 كإيراد.
 */
import type { Minor } from './money.ts'
import type { CartLine } from './pos.ts'

export type RestaurantOrderType = 'dine_in' | 'takeaway' | 'delivery'

export const ORDER_TYPE_LABELS: Record<RestaurantOrderType, { nameAr: string; icon: string }> = {
  dine_in: { nameAr: 'صالة', icon: '🍽️' },
  takeaway: { nameAr: 'تيك أواي', icon: '🥡' },
  delivery: { nameAr: 'دليفري', icon: '🛵' },
}

export type RestaurantOrderStatus = 'open' | 'settled' | 'cancelled'

export interface RestaurantOrder {
  id: number
  orderNumber: string // ORD-0001
  type: RestaurantOrderType
  /** اسم/رقم الطاولة — إلزامي للصالة */
  tableName: string
  /** بيان عميل الدليفري (اسم/هاتف/عنوان) — إلزامي للدليفري */
  deliveryInfo: string
  lines: CartLine[]
  notes: string
  status: RestaurantOrderStatus
  openedAt: string // ISO
  settledAt: string | null
  /** فاتورة البيع الناتجة عند القفل */
  saleId: number | null
}

export function validateRestaurantOrder(args: {
  type: RestaurantOrderType
  tableName: string
  deliveryInfo: string
}): string[] {
  const errors: string[] = []
  if (args.type === 'dine_in' && !args.tableName.trim()) errors.push('حدد الطاولة — أمر الصالة بلا طاولة يضيع بين الجلسات')
  if (args.type === 'delivery' && !args.deliveryInfo.trim()) errors.push('بيانات التوصيل مطلوبة (اسم/هاتف/عنوان)')
  return errors
}

/** سطر رسوم صناعي (خدمة/توصيل): itemId=-1 يمر عبر postSale بلا مخزون ولا تكلفة */
export function feeLine(nameAr: string, amountMinor: Minor): CartLine {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) throw new RangeError('قيمة الرسوم يجب أن تكون موجبة')
  return {
    itemId: -1,
    nameAr,
    qty: 1,
    unitPriceMinor: amountMinor,
    unitCostMinor: 0,
    discountPercent: 0,
    soldByWeight: false,
  }
}

/** رسوم خدمة كنسبة من قيمة الأصناف (قبل الضريبة والخصومات) */
export function serviceChargeMinor(linesSubtotalMinor: Minor, percent: number): Minor {
  if (percent < 0 || percent > 100) throw new RangeError('نسبة رسوم الخدمة بين 0 و100')
  return Math.round((linesSubtotalMinor * percent) / 100)
}

/** قيمة أصناف الأمر قبل الرسوم (لحساب رسوم الخدمة) */
export function orderSubtotalMinor(lines: readonly CartLine[]): Minor {
  return lines.reduce((a, l) => a + Math.round(l.unitPriceMinor * l.qty * (1 - l.discountPercent / 100)), 0)
}

/**
 * تقسيم الفاتورة (نمط فودكس/Toast — الطاولة تنقسم على دافعَيْن):
 * فصل سطور محددة من أمر مفتوح إلى أمر جديد مفتوح يُقفل بفاتورته المستقلة.
 * لا أثر محاسبياً — الأمران لم يلمسا الدفاتر بعد، وكلٌّ يُفوتر عند قفله.
 * تُعاد السطور المفصولة والباقية؛ ويُرفض فصل الكل أو لا شيء (ليس تقسيماً).
 */
export function splitOrderLines(
  lines: readonly CartLine[],
  indexes: readonly number[],
): { moved: CartLine[]; remaining: CartLine[] } {
  const uniq = [...new Set(indexes)]
  if (uniq.length === 0) throw new Error('اختر الأصناف المراد فصلها')
  if (uniq.some((i) => !Number.isInteger(i) || i < 0 || i >= lines.length)) throw new Error('سطر غير موجود في الأمر')
  if (uniq.length === lines.length) throw new Error('فصل كل الأصناف ليس تقسيماً — اقفل الأمر كاملاً بفاتورة واحدة')
  const idx = new Set(uniq)
  return {
    moved: lines.filter((_, i) => idx.has(i)),
    remaining: lines.filter((_, i) => !idx.has(i)),
  }
}

/** الطاولات المشغولة الآن (أوامر صالة مفتوحة) — لمنع فتح أمرين لنفس الطاولة */
export function occupiedTables(orders: readonly RestaurantOrder[]): Set<string> {
  const s = new Set<string>()
  for (const o of orders) if (o.status === 'open' && o.type === 'dine_in' && o.tableName.trim()) s.add(o.tableName.trim())
  return s
}
