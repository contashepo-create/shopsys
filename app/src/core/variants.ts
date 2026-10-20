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

/** صف تنبيه نقص مخزون على مستوى تركيبة واحدة */
export interface VariantLowStockRow {
  itemId: number
  itemName: string
  color: string
  size: string
  qty: number
  impliedMinQty: number
  kind: 'out' | 'low'
}

/**
 * تنبيه نقص مخزون على مستوى التركيبة (فجوة فورية ② — نشاط الملابس):
 * يُبنى فوق `variantStocks` الموجودة فعلاً بلا أي حقل بيانات جديد — عتبة كل
 * تركيبة هي حد إعادة الطلب العام للصنف (`minQty`) موزَّعاً بالتساوي على عدد
 * تركيباته المسجَّلة فعلياً. تركيبة برصيد صفر «نافدة» دوماً حتى لو كان الصنف
 * بلا حد إعادة طلب، لأن نفاد لون/مقاس بعينه مفيد تشغيلياً بذاته.
 */
export function variantLowStockAlerts(
  stocks: readonly VariantStock[],
  items: readonly { id: number; nameAr: string; minQty: number; isActive: boolean }[],
): VariantLowStockRow[] {
  const byItem = new Map<number, VariantStock[]>()
  for (const v of stocks) {
    if (!byItem.has(v.itemId)) byItem.set(v.itemId, [])
    byItem.get(v.itemId)!.push(v)
  }
  const rows: VariantLowStockRow[] = []
  for (const item of items) {
    if (!item.isActive) continue
    const variants = byItem.get(item.id)
    if (!variants?.length) continue
    const impliedMin = item.minQty > 0 ? Math.round((item.minQty / variants.length) * 1000) / 1000 : 0
    for (const v of variants) {
      if (v.qty <= 0) rows.push({ itemId: item.id, itemName: item.nameAr, color: v.color, size: v.size, qty: v.qty, impliedMinQty: impliedMin, kind: 'out' })
      else if (impliedMin > 0 && v.qty <= impliedMin) rows.push({ itemId: item.id, itemName: item.nameAr, color: v.color, size: v.size, qty: v.qty, impliedMinQty: impliedMin, kind: 'low' })
    }
  }
  return rows.sort((a, b) => a.qty - b.qty)
}

/**
 * تخطيط خصم البيع من التركيبات: يجمع المطلوب لكل تركيبة عبر السطور
 * ويرمي بالعربية لو تركيبة غير موجودة أو رصيدها لا يكفي.
 */
/** بند توزيع تركيبة واحد مُدخَل مباشرة في سطر فاتورة الشراء */
export interface VariantBreakdownLine {
  color: string
  size: string
  qty: number
}

/**
 * تحقق توزيع تركيبات لون/مقاس وقت استلام فاتورة الشراء نفسها (فجوة فورية ①):
 * - كل تركيبة يجب أن تكون من ألوان/مقاسات الصنف المعرَّفة (لو مُعرَّفة أصلاً)،
 * - الكمية غير سالبة،
 * - مجموع التوزيع لا يتجاوز الكمية المشتراة في هذا السطر (الباقي يبقى «غير موزَّع» كالمعتاد).
 */
export function validatePurchaseVariantBreakdown(args: {
  breakdown: readonly VariantBreakdownLine[]
  purchasedQty: number
  itemColors: readonly string[]
  itemSizes: readonly string[]
}): string[] {
  const errors: string[] = []
  let total = 0
  for (const b of args.breakdown) {
    const color = b.color.trim()
    const size = b.size.trim()
    if (!color && !size) errors.push('حدد لوناً أو مقاساً على الأقل لكل بند توزيع')
    if (color && args.itemColors.length && !args.itemColors.includes(color)) errors.push(`اللون «${color}» ليس من ألوان الصنف`)
    if (size && args.itemSizes.length && !args.itemSizes.includes(size)) errors.push(`المقاس «${size}» ليس من مقاسات الصنف`)
    if (b.qty < 0) errors.push('كمية التوزيع لا تكون سالبة')
    total += b.qty
  }
  if (total > args.purchasedQty + 1e-9) {
    errors.push(`مجموع توزيع التركيبات (${Math.round(total * 1000) / 1000}) يتجاوز الكمية المشتراة بالسطر (${args.purchasedQty})`)
  }
  return errors
}

/**
 * يدمج توزيع تركيبات وارداً من سطر شراء مع المصفوفة الحالية (إضافة تراكمية
 * فوق الرصيد القائم لكل تركيبة، لا استبدال كامل كما في `setVariantStock`).
 */
export function applyPurchaseVariantBreakdown(
  stocks: readonly VariantStock[],
  itemId: number,
  breakdown: readonly VariantBreakdownLine[],
): VariantStock[] {
  const next = stocks.map((v) => ({ ...v }))
  for (const b of breakdown) {
    if (b.qty <= 0) continue
    const color = b.color.trim()
    const size = b.size.trim()
    const key = variantKey(color, size)
    const idx = next.findIndex((v) => v.itemId === itemId && variantKey(v.color, v.size) === key)
    if (idx >= 0) next[idx].qty = Math.round((next[idx].qty + b.qty) * 1000) / 1000
    else next.push({ itemId, color, size, qty: Math.round(b.qty * 1000) / 1000 })
  }
  return next
}

/**
 * باركود مستقل لكل تركيبة لون/مقاس (فجوة فورية ④ — طباعة ملصقات لكل تركيبة لا للصنف ككل):
 * لا حقل بيانات جديد — يُشتَق من الباركود/SKU الأساسي للصنف + فهرس ثابت للون
 * والمقاس داخل مصفوفتي الصنف (`variantColors`/`variantSizes`). يفتح الباب لاحقاً
 * لمسح مباشر في الكاشير يحدد التركيبة تلقائياً (`resolveVariantBarcode`).
 */
export function variantBarcode(baseCode: string, itemColors: readonly string[], itemSizes: readonly string[], color: string, size: string): string {
  const ci = color ? itemColors.indexOf(color) : -1
  const si = size ? itemSizes.indexOf(size) : -1
  const cPart = ci >= 0 ? String(ci + 1).padStart(2, '0') : '00'
  const sPart = si >= 0 ? String(si + 1).padStart(2, '0') : '00'
  return `${baseCode}-${cPart}${sPart}`
}

/**
 * الاتجاه العكسي: من كود ممسوح في الكاشير إلى (itemId, color, size) لو كان
 * فعلاً باركود تركيبة صالحاً من `variantBarcode` — يسمح بمسح مباشر لتحديد
 * التركيبة بدل الاختيار اليدوي من نافذة منبثقة (تطوير مستقبلي ①).
 */
export function resolveVariantBarcode(
  scanned: string,
  items: readonly { id: number; barcodes: readonly string[]; sku: string; variantColors: readonly string[]; variantSizes: readonly string[] }[],
): { itemId: number; color: string; size: string } | null {
  const lastDash = scanned.lastIndexOf('-')
  if (lastDash < 0) return null
  const base = scanned.slice(0, lastDash)
  const suffix = scanned.slice(lastDash + 1)
  if (!/^\d{4}$/.test(suffix)) return null
  const ci = Number(suffix.slice(0, 2)) - 1
  const si = Number(suffix.slice(2, 4)) - 1
  const item = items.find((it) => it.barcodes.includes(base) || (it.sku && it.sku === base) || String(it.id) === base)
  if (!item) return null
  const color = ci >= 0 ? (item.variantColors[ci] ?? '') : ''
  const size = si >= 0 ? (item.variantSizes[si] ?? '') : ''
  if (!color && !size) return null
  return { itemId: item.id, color, size }
}

/** صف تنبيه «تركيبة غير موزَّعة منذ فترة طويلة» */
export interface LongUndistributedVariantRow {
  itemId: number
  itemName: string
  undistributedQty: number
  daysSincePurchase: number
}

/**
 * تذكير دوري تلقائي بالتركيبات غير الموزَّعة المتراكمة منذ فترة طويلة بعد
 * الشراء (تطوير مستقبلي ④ — نشاط الملابس): بدل الاعتماد فقط على زيارة شاشة
 * المصفوفة يدوياً، يُحتسب عمر الكمية غير الموزَّعة تقريبياً من تاريخ آخر
 * فاتورة شراء لهذا الصنف — تجاوز الحد يعني نسياناً محتملاً للتوزيع.
 */
export function longUndistributedVariants(
  items: readonly { id: number; nameAr: string; stockQty: number; isActive: boolean; variantColors: readonly string[]; variantSizes: readonly string[] }[],
  stocks: readonly VariantStock[],
  lastPurchaseDateByItem: ReadonlyMap<number, string>,
  todayIso: string,
  thresholdDays = 3,
): LongUndistributedVariantRow[] {
  const today = new Date(todayIso.slice(0, 10) + 'T00:00:00Z').getTime()
  const rows: LongUndistributedVariantRow[] = []
  for (const it of items) {
    if (!it.isActive) continue
    if (!it.variantColors.length && !it.variantSizes.length) continue
    const undistributed = undistributedQty(it.stockQty ?? 0, stocks, it.id)
    if (undistributed <= 0) continue
    const lastPurchase = lastPurchaseDateByItem.get(it.id)
    if (!lastPurchase) continue
    const days = Math.floor((today - new Date(lastPurchase.slice(0, 10) + 'T00:00:00Z').getTime()) / 86_400_000)
    if (days < thresholdDays) continue
    rows.push({ itemId: it.id, itemName: it.nameAr, undistributedQty: undistributed, daysSincePurchase: days })
  }
  return rows.sort((a, b) => b.daysSincePurchase - a.daysSincePurchase)
}

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
