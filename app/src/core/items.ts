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
  soldByWeight: boolean
  variantColors: string[] // عند variants
  variantSizes: string[]
  isActive: boolean
}

export interface ItemDraft extends Omit<Item, 'id'> {}

/** أخطاء التحقق — نصوص عربية جاهزة للعرض */
export function validateItem(draft: ItemDraft, existing: Item[], editingId?: number): string[] {
  const errors: string[] = []
  if (!draft.nameAr.trim()) errors.push('اسم الصنف مطلوب')
  if (draft.priceMinor < 0 || draft.costMinor < 0) errors.push('الأسعار لا تكون سالبة')
  if (draft.priceMinor > 0 && draft.costMinor > draft.priceMinor)
    errors.push('تنبيه: التكلفة أعلى من سعر البيع — بيع بخسارة')
  if (!draft.baseUnit.trim()) errors.push('الوحدة الأساسية مطلوبة')
  if (draft.trackSerial && draft.soldByWeight) errors.push('لا يجتمع السيريال مع البيع بالوزن')
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
    trackExpiry: f.has('expiry_batches'),
    trackSerial: f.has('serial_warranty'),
    soldByWeight: f.has('weight_scale'),
    variantColors: [],
    variantSizes: [],
    isActive: true,
  }
}
