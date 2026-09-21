/**
 * مصفوفة مخزون المتغيرات (لون×مقاس) — سد فجوة أنظمة الملابس (Loyverse/Cegid)
 * ===========================================================================
 * النموذج: دفتر فرعي لمخزون الصنف —
 *   الصنف يحتفظ برصيده الإجمالي ومتوسط تكلفته (مصدر الحقيقة للقيود، فلا
 *   تغيير على محرك GL)، وكل تركيبة لون×مقاس لها رصيد مستقل في المصفوفة.
 *
 * القاعدة الصلبة: مجموع أرصدة التركيبات ≤ رصيد الصنف الإجمالي —
 *   (الفارق = كمية «غير موزعة» بعد الشراء حتى يوزعها المستخدم على المقاسات).
 *
 * السلوك في الكاشير (استشاري كنمط السيريالات):
 *   صنف له تركيبات برصيد ⇒ يجب اختيار تركيبة لكل سطر، وتُخصم من رصيدها
 *   ومن رصيد الصنف معاً. لا مصفوفة ⇒ يباع عادياً.
 * المرتجع يعيد الكمية للتركيبة نفسها وللإجمالي.
 *
 * لا قيود محاسبية هنا — المصفوفة إدارية والتكلفة على مستوى الصنف.
 */

export interface VariantStock {
  itemId: number
  color: string // '' مسموحة لو الصنف مقاسات فقط
  size: string // '' مسموحة لو الصنف ألوان فقط
  qty: number
}

/** مفتاح موحد للتركيبة */
export const variantKey = (color: string, size: string) => `${color.trim()}⁞${size.trim()}`

export const variantLabel = (color: string, size: string) =>
  [color.trim(), size.trim()].filter(Boolean).join(' / ') || 'افتراضي'

/** مجموع أرصدة تركيبات صنف */
export function variantTotal(stocks: readonly VariantStock[], itemId: number): number {
  let t = 0
  for (const v of stocks) if (v.itemId === itemId) t += v.qty
  return Math.round(t * 1000) / 1000
}

/** الكمية غير الموزعة على تركيبات = رصيد الصنف − مجموع المصفوفة */
export function undistributedQty(itemStockQty: number, stocks: readonly VariantStock[], itemId: number): number {
  return Math.round((itemStockQty - variantTotal(stocks, itemId)) * 1000) / 1000
}

/** هل للصنف مصفوفة برصيد؟ (يُلزم اختيار تركيبة في البيع) */
export function hasVariantStock(stocks: readonly VariantStock[], itemId: number): boolean {
  return stocks.some((v) => v.itemId === itemId && v.qty > 0)
}

/**
 * تحقق تعيين رصيد تركيبة:
 * التركيبة يجب أن تكون من ألوان/مقاسات الصنف المعرفة، والرصيد غير سالب،
 * والمجموع الجديد لا يتجاوز رصيد الصنف الإجمالي.
 */
export function validateVariantAssignment(args: {
  color: string
  size: string
  qty: number
  itemColors: readonly string[]
  itemSizes: readonly string[]
  itemStockQty: number
  currentStocks: readonly VariantStock[]
  itemId: number
}): string[] {
  const errors: string[] = []
  const color = args.color.trim()
  const size = args.size.trim()
  if (!color && !size) errors.push('حدد لوناً أو مقاساً على الأقل')
  if (color && args.itemColors.length && !args.itemColors.includes(color)) errors.push(`اللون «${color}» ليس من ألوان الصنف`)
  if (size && args.itemSizes.length && !args.itemSizes.includes(size)) errors.push(`المقاس «${size}» ليس من مقاسات الصنف`)
  if (args.qty < 0) errors.push('الرصيد لا يكون سالباً')
  // المجموع بعد الاستبدال
  const others = args.currentStocks
    .filter((v) => v.itemId === args.itemId && variantKey(v.color, v.size) !== variantKey(color, size))
    .reduce((s, v) => s + v.qty, 0)
  if (others + args.qty > args.itemStockQty + 1e-9) {
    errors.push(`مجموع التركيبات (${Math.round((others + args.qty) * 1000) / 1000}) يتجاوز رصيد الصنف (${args.itemStockQty}) — استلم شراءً أولاً أو خفّض تركيبة أخرى`)
  }
  return errors
}

/**
 * تخطيط خصم البيع من التركيبات: يجمع المطلوب لكل تركيبة عبر السطور
 * ويرمي بالعربية لو تركيبة غير موجودة أو رصيدها لا يكفي.
 */
export function planVariantDeduction(
  stocks: readonly VariantStock[],
  wanted: { itemId: number; color: string; size: string; qty: number; itemName: string }[],
): Map<string, number> {
  // مفتاح مركب itemId+variantKey ← كمية
  const need = new Map<string, { qty: number; itemName: string; color: string; size: string; itemId: number }>()
  for (const w of wanted) {
    const k = `${w.itemId}⁞${variantKey(w.color, w.size)}`
    const cur = need.get(k)
    need.set(k, { qty: (cur?.qty ?? 0) + w.qty, itemName: w.itemName, color: w.color, size: w.size, itemId: w.itemId })
  }
  const plan = new Map<string, number>()
  for (const [k, n] of need) {
    const stock = stocks.find((v) => v.itemId === n.itemId && variantKey(v.color, v.size) === variantKey(n.color, n.size))
    const avail = stock?.qty ?? 0
    if (avail + 1e-9 < n.qty) {
      throw new Error(`«${n.itemName}» ${variantLabel(n.color, n.size)}: متاح ${avail} ومطلوب ${n.qty}`)
    }
    plan.set(k, n.qty)
  }
  return plan
}
