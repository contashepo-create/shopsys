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
  treasury: string
}

export interface ProductionOrder {
  id: number
  orderNumber: string // PRD-0001
  refCode: string
  date: string
  recipeId: number
  productItemId: number
  /** عدد التشغيلات (المضاعِف) */
  batches: number
  producedQty: number // batches × yieldQty
  ingredientsCostMinor: Minor
  overheadMinor: Minor
  overheadItems?: ProductionExpense[]
  totalCostMinor: Minor
  treasury: string | null // مصدر مصاريف التشغيل إن وجدت
  journalEntryId: number
  notes: string
}

/** قيد أمر الإنتاج — تحويل داخل المخزون + مصاريف تشغيل من الخزينة */
export function buildProductionEntry(ingredientsCostMinor: Minor, overheadMinor: Minor, treasury: string, expenses: ProductionExpense[] = []): JournalLine[] {
  const detailedTotal = expenses.reduce((sum, expense) => sum + expense.amountMinor, 0)
  const totalOverhead = overheadMinor + detailedTotal
  const lines: JournalLine[] = [
    { accountCode: '1103', debit: ingredientsCostMinor + totalOverhead, credit: 0, note: 'منتج تام داخل للمخزون' },
    { accountCode: '1103', debit: 0, credit: ingredientsCostMinor, note: 'خامات مستهلكة في الإنتاج' },
  ]
  if (overheadMinor > 0) lines.push({ accountCode: treasury, debit: 0, credit: overheadMinor, note: 'مصاريف تشغيل الوصفة' })
  for (const expense of expenses) {
    if (!Number.isInteger(expense.amountMinor) || expense.amountMinor <= 0) throw new Error('مبلغ مصروف التصنيع يجب أن يكون موجباً')
    lines.push({ accountCode: expense.treasury, debit: 0, credit: expense.amountMinor, note: `مصروف تصنيع: ${expense.label} (${expense.accountCode})` })
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
