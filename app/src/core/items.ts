/**
 * نموذج الأصناف المعمَّم — ShopSys
 * (وثيقة التصميم — القرار 5 + القسم 6)
 * الخصائص تُفعَّل على مستوى القسم وتورَّث للصنف مع إمكانية التجاوز لكل صنف
 * — هذا ما يسمح بهايبر ماركت يبيع جبنة (صلاحية) وغسالة (سيريال) معاً.
 */
import type { ItemFeature } from './activities.ts'
import type { Minor } from './money.ts'

export interface Category {
  id: number
  nameAr: string
  /** القسم الأب — null = قسم رئيسي (شجرة متعددة المستويات) */
  parentId: number | null
  /** الخصائص المفعّلة لهذا القسم — تصبح الافتراضي لأصنافه، والفرعي يرث من أبيه عند الإنشاء */
  features: ItemFeature[]
}

/** المسار الكامل للقسم: أغذية ← ألبان ← أجبان */
export function categoryPath(cat: Category, all: Category[]): string {
  const parts = [cat.nameAr]
  let cur = cat
  let guard = 0
  while (cur.parentId != null && guard++ < 10) {
    const parent = all.find((c) => c.id === cur.parentId)
    if (!parent) break
    parts.unshift(parent.nameAr)
    cur = parent
  }
  return parts.join(' ← ')
}

/** كل الأقسام التابعة لقسم (نفسه + أحفاده) — للفلترة الهرمية */
export function categoryDescendants(catId: number, all: Category[]): number[] {
  const result = [catId]
  const queue = [catId]
  let guard = 0
  while (queue.length && guard++ < 100) {
    const id = queue.shift()!
    for (const c of all) {
      if (c.parentId === id) {
        result.push(c.id)
        queue.push(c.id)
      }
    }
  }
  return result
}

export interface ItemUnit {
  nameAr: string // كرتونة
  factor: number // = كم وحدة أساسية
  barcode?: string
  /** سعر بيع هذه الوحدة (جولة الصيدلية) — غيابه = سعر الأساسية × المعامل */
  priceMinor?: number
}

export interface Item {
  id: number
  nameAr: string
  sku: string
  barcodes: string[]
  categoryId: number
  baseUnit: string // الوحدة الأساسية: قطعة / كجم / علبة
  extraUnits: ItemUnit[] // عند تفعيل multi_unit
  /**
   * تكلفة الوحدة (متوسط مرجح متحرك) — لا تُدخل يدوياً:
   * تُحدَّث تلقائياً من فواتير الشراء بعد توزيع مصاريف الشراء (core/costing.ts).
   * القيمة المدخلة عند إنشاء الصنف = تكلفة افتتاحية فقط.
   */
  costMinor: Minor
  /** كمية المخزون الحالية (تتحرك بالشراء والبيع) */
  stockQty: number
  priceMinor: Minor
  minQty: number // حد إعادة الطلب
  // تجاوزات الخصائص لكل صنف (تبدأ من افتراضي القسم)
  trackExpiry: boolean
  trackSerial: boolean
  /** مدة الضمان الافتراضية بالأشهر (لأصناف السيريال — تُثبت على كل قطعة وقت بيعها) */
  warrantyMonths: number
  soldByWeight: boolean
  variantColors: string[] // عند variants
  variantSizes: string[]
  /**
   * أرقام مرجعية OEM/بديلة (جولة قطع الغيار): القطعة الواحدة تعرف بأرقام
   * كثيرة (رقم المصنع الأصلي + أرقام بدائل) — الكاشير يبحث بأي منها.
   */
  oemNumbers?: string[]
  /** التوافق (Fitment): الموديلات/الأجهزة التي تناسبها القطعة — نص حر يبحث فيه الكاشير */
  fitment?: string
  /**
   * المادة الفعالة (الصيدلية — نمط ShelfLifePro salt-equivalent finder):
   * الدواء الناقص يُقترح بديله بنفس المادة الفعالة المتوفر بالمخزون
   */
  activeIngredient?: string
  /** درجة القطعة: أصلي / بديل تجاري / مستعمل (قطع الغيار) */
  grade?: 'original' | 'aftermarket' | 'used'
  /**
   * تجاوز الضريبة لهذا الصنف (طلب المالك):
   * null/undefined = يتبع نسبة البلد العامة · 0 = معفى ضريبياً · رقم = نسبة خاصة به.
   * تغيير النسبة العامة لاحقاً لا يمس الفواتير القديمة (كل فاتورة تحفظ نسبتها وقت الإصدار)
   */
  vatOverride?: number | null
  /**
   * صنف خدمة (سد فجوة عالمية — Square/Lightspeed service items):
   * لا يتتبع مخزوناً: البيع لا يفحص رصيداً ولا يخصمه ولا يولد قيد تكلفة —
   * أساس أنشطة الصالونات والجيم وأي بيع خدمات من الكاشير مباشرة.
   */
  isService?: boolean
  /**
   * حد أدنى لسعر البيع (سد فجوة DEXEF/الأمين — أشهر برامج مصر والسعودية):
   * «تحديد حد أدنى لسعر البيع لتجنب الخسائر» — الكاشير لا يبيع تحته حتى
   * بصلاحية تعديل السعر؛ التجاوز باعتماد مدير موثق (نفس نمط حد الائتمان).
   * 0/undefined = بلا حد.
   */
  minSalePriceMinor?: Minor
  isActive: boolean
}

/**
 * فحص أرضية السعر لسطور فاتورة — يعيد أسماء الأصناف المبيعة تحت حدها الأدنى.
 * السعر يقارن بالوحدة الأساسية (سعر الوحدة المختارة ÷ معاملها).
 */
/** خطأ أرضية السعر — تلتقطه الواجهة لعرض حوار اعتماد المدير (نمط CreditLimitError) */
export class PriceFloorError extends Error {
  itemNames: string[]
  constructor(itemNames: string[]) {
    super(`سعر بيع تحت الحد الأدنى: ${itemNames.join('، ')} — يلزم اعتماد مدير`)
    this.name = 'PriceFloorError'
    this.itemNames = itemNames
  }
}

export function priceFloorViolations(
  lines: readonly { itemId: number; unitPriceMinor: Minor; unitFactor?: number; discountPercent: number }[],
  items: readonly Pick<Item, 'id' | 'nameAr' | 'minSalePriceMinor'>[],
): string[] {
  const bad: string[] = []
  for (const l of lines) {
    const it = items.find((x) => x.id === l.itemId)
    const floor = it?.minSalePriceMinor ?? 0
    if (!it || floor <= 0) continue
    // السعر الفعلي بعد خصم السطر وبالوحدة الأساسية
    const perBase = (l.unitPriceMinor * (1 - l.discountPercent / 100)) / (l.unitFactor ?? 1)
    if (perBase < floor - 0.5) bad.push(it.nameAr)
  }
  return [...new Set(bad)]
}

/** النسبة الفعلية للصنف: تجاوزه إن وُجد وإلا النسبة العامة */
export function effectiveVatPercent(item: Pick<Item, 'vatOverride'>, defaultPercent: number): number {
  return item.vatOverride === null || item.vatOverride === undefined ? defaultPercent : item.vatOverride
}

export const GRADE_LABELS: Record<NonNullable<Item['grade']>, { nameAr: string; icon: string }> = {
  original: { nameAr: 'أصلي', icon: '🟢' },
  aftermarket: { nameAr: 'بديل تجاري', icon: '🔵' },
  used: { nameAr: 'مستعمل (استيراد)', icon: '🟠' },
}

/**
 * بحث موحّد للكاشير (قطع الغيار): اسم / باركود / SKU / رقم OEM / توافق.
 * أرقام OEM تطابق بلا حساسية للشرطات والمسافات (BOSCH-0986 = bosch 0986).
 */
/**
 * بدائل الدواء بنفس المادة الفعالة (نمط ShelfLifePro): عند نفاد صنف،
 * اقترح الأصناف النشطة المتوفرة التي تشاركه المادة الفعالة — مرتبة بالسعر
 */
export function sameIngredientAlternatives(item: Pick<Item, 'id' | 'activeIngredient'>, all: readonly Item[]): Item[] {
  const ing = (item.activeIngredient ?? '').trim()
  if (!ing) return []
  const norm = (x: string) => x.trim().replace(/\s+/g, ' ')
  return all
    .filter((it) =>
      it.id !== item.id && it.isActive && !it.isService &&
      norm(it.activeIngredient ?? '') !== '' && norm(it.activeIngredient ?? '') === norm(ing) &&
      (it.stockQty ?? 0) > 0,
    )
    .sort((a, b) => a.priceMinor - b.priceMinor)
}

export function normalizePartNumber(raw: string): string {
  return raw.replace(/[\s\-_./]/g, '').toUpperCase()
}

export function itemMatchesPartQuery(it: Item, rawQuery: string): boolean {
  const q = rawQuery.trim()
  if (!q) return false
  if (it.nameAr.includes(q) || it.sku === q || it.barcodes.includes(q)) return true
  if (it.fitment && it.fitment.includes(q)) return true
  const nq = normalizePartNumber(q)
  if (nq.length < 3) return false
  return (it.oemNumbers ?? []).some((n) => normalizePartNumber(n).includes(nq))
}

export interface ItemDraft extends Omit<Item, 'id'> {}

/** أخطاء التحقق — نصوص عربية جاهزة للعرض */
export function validateItem(draft: ItemDraft, existing: Item[], editingId?: number): string[] {
  const errors: string[] = []
  if (!draft.nameAr.trim()) errors.push('اسم الصنف مطلوب')
  if (draft.priceMinor < 0 || draft.costMinor < 0) errors.push('الأسعار لا تكون سالبة')
  if (draft.priceMinor === 0)
    errors.push('تنبيه: سعر البيع صفر — لن يقبل الكاشير بيع هذا الصنف حتى تحدد سعره')
  if (draft.priceMinor > 0 && draft.costMinor > draft.priceMinor)
    errors.push('تنبيه: التكلفة أعلى من سعر البيع — بيع بخسارة')
  if (!draft.baseUnit.trim()) errors.push('الوحدة الأساسية مطلوبة')
  if (draft.trackSerial && draft.soldByWeight) errors.push('لا يجتمع السيريال مع البيع بالوزن')
  // صنف خدمة: لا مخزون — التتبعات المخزنية بلا معنى (نمط Square service items)
  if (draft.isService && (draft.trackSerial || draft.trackExpiry || draft.soldByWeight)) {
    errors.push('صنف الخدمة بلا مخزون — لا صلاحية ولا سيريال ولا وزن')
  }
  // تفرد الباركود عبر كل الأصناف (بما فيها باركودات الوحدات)
  const allCodes = new Set<string>()
  for (const it of existing) {
    if (it.id === editingId) continue
    for (const b of it.barcodes) allCodes.add(b)
    for (const u of it.extraUnits) if (u.barcode) allCodes.add(u.barcode)
  }
  for (const b of draft.barcodes) {
    if (allCodes.has(b)) errors.push(`الباركود ${b} مستخدم في صنف آخر`)
  }
  const draftCodes = draft.barcodes.filter(Boolean)
  if (new Set(draftCodes).size !== draftCodes.length) errors.push('باركود مكرر داخل نفس الصنف')
  for (const u of draft.extraUnits) {
    if (u.factor <= 1) errors.push(`معامل الوحدة "${u.nameAr}" يجب أن يكون أكبر من 1`)
  }
  return errors
}

/** توليد كود صنف تلقائي */
export function nextSku(existing: Item[]): string {
  const max = existing.reduce((m, it) => {
    const n = parseInt(it.sku.replace(/\D/g, ''), 10)
    return Number.isFinite(n) && n > m ? n : m
  }, 1000)
  return `ITM-${max + 1}`
}

/** الافتراضيات من خصائص القسم (الوراثة — القرار 5) */
export function draftFromCategory(cat: Category | undefined, sku: string): ItemDraft {
  const f = new Set(cat?.features ?? [])
  return {
    nameAr: '',
    sku,
    barcodes: [],
    categoryId: cat?.id ?? 0,
    baseUnit: f.has('weight_scale') ? 'كجم' : 'قطعة',
    extraUnits: [],
    costMinor: 0,
    stockQty: 0,
    priceMinor: 0,
    minQty: 0,
    trackExpiry: false,
    trackSerial: f.has('serial_warranty'),
    warrantyMonths: f.has('serial_warranty') ? 12 : 0,
    soldByWeight: f.has('weight_scale'),
    variantColors: [],
    variantSizes: [],
    isActive: true,
  }
}
