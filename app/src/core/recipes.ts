/**
 * الوصفات والتصنيع (مطاعم/كافيهات/مخابز) — سد فجوة Foodics
 * =========================================================
 * نمطان (كما في أنظمة المطاعم العالمية):
 *
 * 1) «يُجهَّز عند الطلب» (made_to_order): الطبق لا مخزون له —
 *    عند بيعه تُخصم خاماته فوراً بنِسَب الوصفة، وتكلفة السطر في قيد
 *    البيع (5101/1103) = تكلفة الخامات لحظة البيع بالمتوسط المرجح.
 *    ⇒ التكلفة مشتقة آلياً، وربحية الطبق حقيقية دائماً.
 *
 * 2) «إنتاج مسبق» (prepped): أمر إنتاج يحول خامات إلى منتج مخزون
 *    (صوص، عجينة، حلويات) بكمية ناتجة yieldQty؛ يدخل المنتج المخزون
 *    بتكلفة الخامات + مصاريف التشغيل، ويُحدَّث متوسطه المرجح، ثم يباع
 *    كأي صنف عادي.
 *
 * قيد أمر الإنتاج:
 *   1103 مدين (قيمة المنتج الداخل) /
 *   1103 دائن (قيمة الخامات الخارجة) + خزينة دائن (مصاريف تشغيل إن وجدت)
 *   — تحويل داخل المخزون نفسه فيبقى الدفتر مطابقاً لرصيد المخزون تماماً.
 *
 * مرتجع طبق «يُجهَّز عند الطلب»: الخامات طُهيت ولا تعود للمخزون —
 * تبقى تكلفتها في 5101 (هالك اقتصادياً) ويُرد للعميل السعر فقط.
 */
import type { JournalLine } from './ledger.ts'
import { assertBalanced } from './ledger.ts'
import type { Minor } from './money.ts'

export type RecipeMode = 'made_to_order' | 'prepped'

export interface RecipeIngredient {
  itemId: number
  /** الكمية لكل وحدة منتج (عند الطلب) أو لكل تشغيلة كاملة (إنتاج مسبق) */
  qty: number
}

export interface Recipe {
  id: number
  /** الصنف الناتج (الطبق أو المنتج نصف المصنع) */
  productItemId: number
  mode: RecipeMode
  /** كمية الناتج من التشغيلة الواحدة — للإنتاج المسبق فقط (عند الطلب = 1 دائماً) */
  yieldQty: number
  ingredients: RecipeIngredient[]
  /** مصاريف تشغيل إضافية للتشغيلة (غاز/عمالة مباشرة) — للإنتاج المسبق */
  overheadMinor: Minor
  isActive: boolean
  notes: string
}

export interface RecipeInput extends Omit<Recipe, 'id'> {}

/** تحقق الوصفة — نصوص عربية جاهزة */
export function validateRecipe(
  input: RecipeInput,
  itemExists: (id: number) => boolean,
  productHasRecipe: (productItemId: number) => boolean,
  isMadeToOrderProduct: (itemId: number) => boolean,
): string[] {
  const errors: string[] = []
  if (!itemExists(input.productItemId)) errors.push('اختر الصنف الناتج')
  else if (productHasRecipe(input.productItemId)) errors.push('لهذا الصنف وصفة بالفعل — عدّلها بدل إنشاء ثانية')
  if (input.ingredients.length === 0) errors.push('أضف مكوناً واحداً على الأقل')
  const seen = new Set<number>()
  for (const ing of input.ingredients) {
    if (!itemExists(ing.itemId)) { errors.push('مكوّن غير موجود'); continue }
    if (ing.itemId === input.productItemId) errors.push('لا يكون المنتج مكوناً في وصفة نفسه')
    if (seen.has(ing.itemId)) errors.push('مكوّن مكرر في الوصفة')
    seen.add(ing.itemId)
    if (!(ing.qty > 0)) errors.push('كمية كل مكوّن يجب أن تكون أكبر من صفر')
    // منع التداخل اللانهائي: طبقٌ يُجهَّز عند الطلب لا يصلح مكوناً
    // (المنتج «المسبق» مقبول كمكوّن لأنه صنف مخزون حقيقي — صوص داخل طبق)
    if (isMadeToOrderProduct(ing.itemId)) errors.push('طبق «يُجهَّز عند الطلب» لا يصلح مكوناً — استخدم منتجاً مسبق الإنتاج')
  }
  if (input.mode === 'prepped' && !(input.yieldQty > 0)) errors.push('كمية الناتج للتشغيلة يجب أن تكون أكبر من صفر')
  if (input.overheadMinor < 0) errors.push('مصاريف التشغيل لا تكون سالبة')
  return errors
}

/**
 * تكلفة الخامات للوصفة بالمتوسط المرجح الحالي (بالمليمات):
 * عند الطلب: تكلفة طبق واحد. إنتاج مسبق: تكلفة التشغيلة كاملة (بلا المصاريف).
 */
export function recipeIngredientsCostMinor(recipe: Pick<Recipe, 'ingredients'>, costOf: (itemId: number) => Minor): Minor {
  let total = 0
  for (const ing of recipe.ingredients) total += Math.round(ing.qty * costOf(ing.itemId))
  return total
}

/** تكلفة وحدة الناتج: (خامات التشغيلة + مصاريف) ÷ كمية الناتج — أو تكلفة الطبق مباشرة */
export function recipeUnitCostMinor(recipe: Recipe, costOf: (itemId: number) => Minor): Minor {
  const ingredients = recipeIngredientsCostMinor(recipe, costOf)
  if (recipe.mode === 'made_to_order') return ingredients
  return Math.round((ingredients + recipe.overheadMinor) / recipe.yieldQty)
}

export interface ProductionExpense {
  id: string
  label: string
  amountMinor: Minor
  /** حساب المصروف المرجعي للتصنيف والتحليل؛ التكلفة تُرسمل على المنتج عند الترحيل */
  accountCode: string
  /** حساب الاستحقاق الذي يُسوّى لاحقاً بسند صرف، وليس خزينة وقت التصنيع */
  payableAccountCode?: '2117' | '2104'
}

/**
 * أسباب فرق وزن/كمية التصنيع المصنَّفة (سد فجوة النشاط #2 — تجارة الأعلاف):
 * قبل هذا كان السبب نصاً حراً يُدمَج في ملاحظات أمر الإنتاج فلا يمكن فرزه
 * أو تجميعه في تقرير — الآن حقل مصنَّف رقمياً قابل للتجميع حسب الفترة/المنتج.
 */
export const PRODUCTION_VARIANCE_REASONS = [
  { code: 'moisture_loss', labelAr: 'فقد رطوبة أثناء الطحن/الخلط' },
  { code: 'spillage', labelAr: 'انسكاب/تسرب أثناء التشغيل' },
  { code: 'measurement_error', labelAr: 'خطأ وزن/قياس عند الإدخال' },
  { code: 'equipment_residue', labelAr: 'متبقٍ عالق بالمعدات/الخط' },
  { code: 'other', labelAr: 'سبب آخر' },
] as const

export type ProductionVarianceReasonCode = (typeof PRODUCTION_VARIANCE_REASONS)[number]['code']

export function productionVarianceReasonLabel(code: string | null | undefined): string {
  return PRODUCTION_VARIANCE_REASONS.find((r) => r.code === code)?.labelAr ?? (code ? code : '—')
}

export interface ProductionOrder {
  id: number
  orderNumber: string // PRD-0001
  refCode: string
  date: string
  recipeId: number
  productItemId: number
  warehouseId?: number | null
  ingredientWarehouseId?: number | null
  outputWarehouseId?: number | null
  /** عدد التشغيلات (المضاعِف) */
  batches: number
  producedQty: number // batches × yieldQty
  outputExpiryDate?: string | null
  outputLotNumber?: string | null
  ingredientsCostMinor: Minor
  /** لقطة الخامات الفعلية وتكلفتها وقت الترحيل للتدقيق والطباعة */
  ingredientItems?: { itemId: number; qty: number; warehouseId?: number | null; unitCostMinor: Minor; totalCostMinor: Minor }[]
  overheadMinor: Minor
  overheadItems?: ProductionExpense[]
  totalCostMinor: Minor
  treasury: string | null // مصدر مصاريف التشغيل إن وجدت
  journalEntryId: number
  notes: string
  /** فرق الكمية (الخامات الداخلة − الناتج الفعلي) حين تكون المطابقة الصارمة معطَّلة؛ موجب = هالك/نقص */
  varianceQty?: number | null
  /** سبب مصنَّف من `PRODUCTION_VARIANCE_REASONS` — إجباري من الواجهة متى وُجد فرق وتُعطَّل المطابقة الصارمة */
  varianceReasonCode?: string | null
}

/**
 * محرك تركيب أعلاف غذائي مبسط اختياري (سد فجوة النشاط #2): يحسب نسبة البروتين
 * التقديرية والطاقة لكل كيلوجرام من الخلطة الناتجة، استناداً فقط للقيم الغذائية
 * المُدخَلة يدوياً على كل خامة (`Item.proteinPercent`/`energyKcalPerKg`) —
 * بالمتوسط المرجح بوزن كل خامة في التشغيلة. الخامات بلا بيانات غذائية مُدخَلة
 * تُستبعد من الحساب وتُرصَد في `missingDataItemIds` بدل افتراض صفر مضلِّل.
 * هذا تقدير إرشادي بسيط فقط، وليس محرك تحسين تركيبة بأقل تكلفة.
 */
export interface RecipeNutritionResult {
  totalQty: number
  /** نسبة بروتين الخلطة الموزونة — null إن لم تتوفر بيانات لأي خامة */
  proteinPercent: number | null
  /** طاقة الخلطة (كيلو كالوري/كجم) الموزونة — null إن لم تتوفر بيانات لأي خامة */
  energyKcalPerKg: number | null
  /** أصناف الخامات التي لا تملك بيانات غذائية مُدخَلة (استُبعدت من الحساب) */
  missingDataItemIds: number[]
}

export function computeRecipeNutrition(
  ingredients: readonly { itemId: number; qty: number }[],
  nutritionByItemId: ReadonlyMap<number, { proteinPercent?: number | null; energyKcalPerKg?: number | null }>,
): RecipeNutritionResult {
  const totalQty = ingredients.reduce((sum, ing) => sum + ing.qty, 0)
  let proteinWeighted = 0
  let proteinQty = 0
  let energyWeighted = 0
  let energyQty = 0
  const missingDataItemIds: number[] = []
  for (const ing of ingredients) {
    const info = nutritionByItemId.get(ing.itemId)
    const hasProtein = info?.proteinPercent != null
    const hasEnergy = info?.energyKcalPerKg != null
    if (!hasProtein && !hasEnergy) missingDataItemIds.push(ing.itemId)
    if (hasProtein) { proteinWeighted += ing.qty * info!.proteinPercent!; proteinQty += ing.qty }
    if (hasEnergy) { energyWeighted += ing.qty * info!.energyKcalPerKg!; energyQty += ing.qty }
  }
  return {
    totalQty: Math.round(totalQty * 1000) / 1000,
    proteinPercent: proteinQty > 0 ? Math.round((proteinWeighted / proteinQty) * 100) / 100 : null,
    energyKcalPerKg: energyQty > 0 ? Math.round((energyWeighted / energyQty) * 100) / 100 : null,
    missingDataItemIds,
  }
}

export interface ProductionVarianceReportRow {
  /** مفتاح التجميع: شهر (YYYY-MM) */
  period: string
  productItemId: number
  productNameAr: string
  ordersCount: number
  totalVarianceQty: number
  byReason: { code: string; labelAr: string; count: number; totalQty: number }[]
}

/**
 * تقرير مجمَّع لفرق وزن/هالك التصنيع الداخلي حسب الفترة (شهرياً) والمنتج الناتج —
 * يبنى فوق الحقلين الرقميين الجديدين بدل التنقيب في نص الملاحظات الحر.
 */
export function productionVarianceReport(
  orders: readonly Pick<ProductionOrder, 'date' | 'productItemId' | 'varianceQty' | 'varianceReasonCode'>[],
  items: readonly { id: number; nameAr: string }[],
): ProductionVarianceReportRow[] {
  const nameOf = (id: number) => items.find((it) => it.id === id)?.nameAr ?? `#${id}`
  const groups = new Map<string, ProductionVarianceReportRow>()
  for (const o of orders) {
    if (!o.varianceQty || Math.abs(o.varianceQty) < 0.0001) continue
    const period = (o.date || '').slice(0, 7)
    const key = `${period}|${o.productItemId}`
    let row = groups.get(key)
    if (!row) {
      row = { period, productItemId: o.productItemId, productNameAr: nameOf(o.productItemId), ordersCount: 0, totalVarianceQty: 0, byReason: [] }
      groups.set(key, row)
    }
    row.ordersCount += 1
    row.totalVarianceQty = Math.round((row.totalVarianceQty + o.varianceQty) * 1000) / 1000
    const reasonCode = o.varianceReasonCode || 'other'
    let reasonRow = row.byReason.find((r) => r.code === reasonCode)
    if (!reasonRow) {
      reasonRow = { code: reasonCode, labelAr: productionVarianceReasonLabel(reasonCode), count: 0, totalQty: 0 }
      row.byReason.push(reasonRow)
    }
    reasonRow.count += 1
    reasonRow.totalQty = Math.round((reasonRow.totalQty + o.varianceQty) * 1000) / 1000
  }
  return [...groups.values()].sort((a, b) => (a.period < b.period ? 1 : a.period > b.period ? -1 : b.totalVarianceQty - a.totalVarianceQty))
}

/** قيد أمر الإنتاج — المصروفات تُحمّل على المنتج وتُثبت استحقاقاً بلا دفع نقدي فوري. */
export function buildProductionEntry(ingredientsCostMinor: Minor, overheadMinor: Minor, _legacyTreasury: string, expenses: ProductionExpense[] = []): JournalLine[] {
  const detailedTotal = expenses.reduce((sum, expense) => sum + expense.amountMinor, 0)
  const totalOverhead = overheadMinor + detailedTotal
  const lines: JournalLine[] = [
    { accountCode: '1103', debit: ingredientsCostMinor + totalOverhead, credit: 0, note: 'منتج تام داخل للمخزون' },
    { accountCode: '1103', debit: 0, credit: ingredientsCostMinor, note: 'خامات مستهلكة في الإنتاج' },
  ]
  if (overheadMinor > 0) lines.push({ accountCode: '2117', debit: 0, credit: overheadMinor, note: 'مصاريف تشغيل وصفة مستحقة — تسدد لاحقاً بسند صرف' })
  for (const expense of expenses) {
    if (!Number.isInteger(expense.amountMinor) || expense.amountMinor <= 0) throw new Error('مبلغ مصروف التصنيع يجب أن يكون موجباً')
    lines.push({ accountCode: expense.payableAccountCode ?? '2117', debit: 0, credit: expense.amountMinor, note: `مصروف تصنيع مستحق: ${expense.label} (${expense.accountCode})` })
  }
  assertBalanced(lines)
  return lines
}

/**
 * توسيع سطور بيع فيها أطباق بوصفات «عند الطلب» إلى احتياجات خامات:
 * تُستخدم لفحص المخزون وتخطيط FEFO وخصم الأرصدة عند البيع.
 * ترجع خريطة itemId ← كمية الخامات المطلوبة (مجمعة عبر كل السطور).
 */
export function explodeIngredientNeeds(
  saleQtyByItem: Map<number, number>,
  recipeOf: (itemId: number) => Recipe | undefined,
): Map<number, number> {
  const needs = new Map<number, number>()
  for (const [itemId, qty] of saleQtyByItem) {
    const r = recipeOf(itemId)
    if (r && r.mode === 'made_to_order' && r.isActive) {
      for (const ing of r.ingredients) {
        needs.set(ing.itemId, (needs.get(ing.itemId) ?? 0) + ing.qty * qty)
      }
    } else {
      needs.set(itemId, (needs.get(itemId) ?? 0) + qty)
    }
  }
  return needs
}

export const RECIPE_MODE_LABELS: Record<RecipeMode, { nameAr: string; desc: string }> = {
  made_to_order: { nameAr: 'يُجهَّز عند الطلب', desc: 'الطبق بلا مخزون — تُخصم خاماته لحظة البيع وتكلفته مشتقة آلياً' },
  prepped: { nameAr: 'إنتاج مسبق', desc: 'أمر إنتاج يحول الخامات إلى منتج مخزون (صوص/عجينة) يباع كصنف عادي' },
}
