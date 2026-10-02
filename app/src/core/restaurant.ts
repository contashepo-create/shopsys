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
import { mulQty, percentOf } from './money.ts'
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

/* ═══════════════ وحدة تقارير المطعم (ثالث وحدات «تقارير لكل نشاط») ═══════════════
 *
 * نمط برامج المطاعم (Foodics/Toast): هامش الطبق هو ملك اللعبة —
 *   • الإيراد والتكلفة من أسطر فواتير البيع المرحّلة (المقفلة فقط؛ المفتوح لا يلمس الدفاتر)
 *   • تكلفة المواد ÷ الإيراد = Food Cost % (معيار المطاعم 28–35٪)
 *   • الأوامر المفتوحة = قيد التحصيل (قيمتها لم تُرحَّل بعد) — تُعرض منفصلة لا تختلط بالإيراد
 *   • متوسط قيمة الأمر = فواتير الأوامر المقفلة ÷ عددها
 */

export interface RestaurantDishRow {
  itemId: number
  soldQty: number
  revenueMinor: Minor
  costMinor: Minor
  profitMinor: Minor
  /** ربح ÷ إيراد مقرباً لعُشر — null عند إيراد صفري (لا قسمة على صفر) */
  marginPercent: number | null
  /** للصنف وصفة نشطة (طبق يُحضَّر في المطبخ) — بلا وصفة = صنف يُباع جاهزاً (مشروبات) */
  hasRecipe: boolean
}

export interface RestaurantOrdersSummary {
  settledCount: number
  openCount: number
  cancelledCount: number
  /** قيمة الأوامر المفتوحة الآن (لم تُرحَّل بعد — ستتحول فواتير عند القفل) */
  openValueMinor: Minor
  /** متوسط قيمة الأمر المقفل = Σ فواتير الأوامر المقفلة ÷ عددها — null بلا أوامر مقفلة */
  avgSettledOrderMinor: number | null
  byType: Record<RestaurantOrderType, { settled: number; open: number; openValueMinor: Minor }>
}

export interface RestaurantReportCard {
  revenueMinor: Minor
  cogsMinor: Minor
  grossProfitMinor: Minor
  /** تكلفة المواد ÷ الإيراد مقرباً لعُشر — null عند إيراد صففر */
  foodCostPercent: number | null
  dishCount: number
  /** مرتبة بالربح تنازلياً — الأعلى ربحاً والأكثر أكلاً للهامش في الأعلى */
  dishes: RestaurantDishRow[]
  orders: RestaurantOrdersSummary
}

/** إيراد سطر بيع بعد خصم السطر — نفس منطق lineTotal في الفواتير (mulQty/percentOf) */
function lineRevenueMinor(line: { qty: number; unitPriceMinor: Minor; discountPercent: number }): Minor {
  const gross = mulQty(line.unitPriceMinor, line.qty)
  return gross - percentOf(gross, line.discountPercent)
}

/**
 * بطاقة تقرير المطعم الشاملة — كل المدخلات مسطحة قابلة للاختبار بلا تخزين:
 * @param soldLines        أسطر فواتير البيع المرحّلة في الفترة (متضمنة رسوم الخدمة itemId=-1)
 * @param recipeProductIds معرفات الأصناف ذات الوصفة النشطة (أطباق المطبخ)
 * @param orders           أوامر المطعم في الفترة (صالة/تيك أواي/دليفري × مفتوح/مقفل/ملغى)
 * @param settledOrdersSalesMinor Σ إجمالي فواتير البيع الناتجة من أوامر مقفلة (لمتوسط الأمر)
 */
export function restaurantReportCard(args: {
  soldLines: readonly { itemId: number; qty: number; unitPriceMinor: Minor; unitCostMinor: Minor; discountPercent: number }[]
  recipeProductIds: readonly number[]
  orders: readonly { type: RestaurantOrderType; status: RestaurantOrderStatus; lines: readonly { qty: number; unitPriceMinor: Minor; discountPercent: number }[] }[]
  settledOrdersSalesMinor: Minor
}): RestaurantReportCard {
  const recipeIds = new Set(args.recipeProductIds)
  /* تجميع الأسطر حسب الصنف */
  const byItem = new Map<number, { qty: number; revenue: Minor; cost: Minor }>()
  let revenue = 0
  let cogs = 0
  for (const line of args.soldLines) {
    const rev = lineRevenueMinor(line)
    const cost = Math.round(line.qty * line.unitCostMinor)
    const row = byItem.get(line.itemId) ?? { qty: 0, revenue: 0, cost: 0 }
    row.qty += line.qty
    row.revenue += rev
    row.cost += cost
    byItem.set(line.itemId, row)
    revenue += rev
    cogs += cost
  }
  const dishes: RestaurantDishRow[] = [...byItem.entries()]
    .map(([itemId, row]) => ({
      itemId,
      soldQty: row.qty,
      revenueMinor: row.revenue,
      costMinor: row.cost,
      profitMinor: row.revenue - row.cost,
      marginPercent: row.revenue > 0 ? Math.round(((row.revenue - row.cost) / row.revenue) * 1000) / 10 : null,
      hasRecipe: recipeIds.has(itemId),
    }))
    .sort((a, b) => b.profitMinor - a.profitMinor || b.revenueMinor - a.revenueMinor)

  /* الأوامر: العدادات حسب النوع والحالة، وقيمة المفتوح فقط (المقفل تحوّل لفواتير فلا يتكرر) */
  const byType = {
    dine_in: { settled: 0, open: 0, openValueMinor: 0 },
    takeaway: { settled: 0, open: 0, openValueMinor: 0 },
    delivery: { settled: 0, open: 0, openValueMinor: 0 },
  } satisfies RestaurantOrdersSummary['byType']
  let settled = 0
  let open = 0
  let cancelled = 0
  let openValue = 0
  for (const order of args.orders) {
    if (order.status === 'cancelled') { cancelled++; continue }
    if (order.status === 'open') {
      open++
      const value = order.lines.reduce((sum, line) => sum + lineRevenueMinor(line), 0)
      openValue += value
      byType[order.type].open++
      byType[order.type].openValueMinor += value
    } else {
      settled++
      byType[order.type].settled++
    }
  }
  return {
    revenueMinor: revenue,
    cogsMinor: cogs,
    grossProfitMinor: revenue - cogs,
    foodCostPercent: revenue > 0 ? Math.round((cogs / revenue) * 1000) / 10 : null,
    dishCount: dishes.length,
    dishes,
    orders: {
      settledCount: settled,
      openCount: open,
      cancelledCount: cancelled,
      openValueMinor: openValue,
      avgSettledOrderMinor: settled > 0 ? Math.round(args.settledOrdersSalesMinor / settled) : null,
      byType,
    },
  }
}
