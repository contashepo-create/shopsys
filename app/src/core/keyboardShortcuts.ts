/**
 * اختصارات لوحة المفاتيح القابلة للتخصيص (طلب المالك 2026-10-01، المعروض
 * والموافَق على تنفيذه): كل مستخدم يعيد ترتيب أزرار الوظائف كما يحب —
 * شاشة التقاط داخل دليل F12، كشف تصادم بتبديل تلقائي، واستعادة الافتراضي.
 *
 * **النطاق الآمن**: مفاتيح الوظائف F1..F12 فقط — لا حروف ولا Ctrl/Alt حتى
 * لا تُختطف اختصارات المتصفح أو تعطّل الكتابة في الحقول.
 * **لكل مستخدم خريطته**: تُخزَّن في `userPrefs[userId].keyboardShortcuts`
 * كمفاتيح تجاوز جزئية فوق الافتراضي — فلا يرى مستخدم تعديلات آخر.
 *
 * ملاحظة توافق: F7 كان مكرراً لبحث الطرف (مثل F4) — يظل يعمل كذلك ما لم
 * يُعيّنه المستخدم لوظيفة أخرى («مفتاح حر»)، وF1 حر من البداية.
 */
export type ShortcutActionId =
  | 'quickSearch' | 'newInvoice' | 'partySearch' | 'itemSearch' | 'print'
  | 'saveDraft' | 'post' | 'discount' | 'fullscreen' | 'help'

export interface ShortcutActionDef {
  id: ShortcutActionId
  defaultKey: string
  labelAr: string
  hintAr: string
}

/** الأفعال القابلة للتخصيص — بترتيبها في دليل F12 */
export const SHORTCUT_ACTIONS: readonly ShortcutActionDef[] = [
  { id: 'quickSearch', defaultKey: 'F2', labelAr: 'بحث سريع', hintAr: 'ينتقل لحقل البحث في الصفحة أو الحوار المفتوح ويحدده' },
  { id: 'newInvoice', defaultKey: 'F3', labelAr: 'فاتورة جديدة', hintAr: 'يفتح فاتورة بيع أو شراء جديدة حسب القسم الحالي' },
  { id: 'partySearch', defaultKey: 'F4', labelAr: 'بحث عميل/مورد', hintAr: 'يفتح منتقي الطرف في الفاتورة المفتوحة' },
  { id: 'itemSearch', defaultKey: 'F5', labelAr: 'بحث صنف', hintAr: 'يفتح منتقي الصنف في الفاتورة المفتوحة' },
  { id: 'print', defaultKey: 'F6', labelAr: 'طباعة/معاينة', hintAr: 'يضغط زر الطباعة أو المعاينة المرئي' },
  { id: 'saveDraft', defaultKey: 'F8', labelAr: 'حفظ مسودة', hintAr: 'يحفظ مسودة المستند المفتوح' },
  { id: 'post', defaultKey: 'F9', labelAr: 'ترحيل/اعتماد/دفع', hintAr: 'ينفّذ العملية الرئيسية للمستند أو الحوار المفتوح' },
  { id: 'discount', defaultKey: 'F10', labelAr: 'الخصم', hintAr: 'ينتقل لحقل الخصم في الفاتورة ويحدده' },
  { id: 'fullscreen', defaultKey: 'F11', labelAr: 'ملء الشاشة', hintAr: 'يوسّع النافذة لكامل الشاشة أو يعيدها' },
  { id: 'help', defaultKey: 'F12', labelAr: 'دليل الاختصارات', hintAr: 'يفتح هذه اللوحة وتخصيصها' },
]

/** خريطة فعل ⇒ مفتاح كاملة دائماً */
export type ShortcutMap = Record<ShortcutActionId, string>

/** مفاتيح الوظائف المسموحة حصراً */
export const FUNCTION_KEYS: readonly string[] = Array.from({ length: 12 }, (_, i) => `F${i + 1}`)

export const isFunctionKey = (key: unknown): key is string =>
  typeof key === 'string' && /^F([1-9]|1[0-2])$/.test(key)

export const DEFAULT_SHORTCUTS: ShortcutMap = SHORTCUT_ACTIONS.reduce(
  (map, def) => { map[def.id] = def.defaultKey; return map },
  {} as ShortcutMap,
)

/** تجاوزات المستخدم الجزئية فوق الافتراضي */
export type ShortcutOverrides = Partial<Record<ShortcutActionId, string>>

/**
 * الخريطة المحلولة: الافتراضي + تجاوزات المستخدم. تُهمل القيم غير الصالحة
 * (غير F1..F12) والتجاوزات المكررة (أول فعل يفوز بالترتيب) — فلا تفسد
 * بيانات قديمة أو يدوية المعالجَ العام أبداً.
 */
export function resolveShortcuts(overrides?: ShortcutOverrides | null): ShortcutMap {
  const map: ShortcutMap = { ...DEFAULT_SHORTCUTS }
  if (!overrides) return map
  const taken = new Set<string>()
  for (const def of SHORTCUT_ACTIONS) {
    const key = overrides[def.id]
    if (!isFunctionKey(key) || taken.has(key)) continue
    map[def.id] = key
    taken.add(key)
  }
  return map
}

/** مفاتيح مكررة على أكثر من فعل — يجب أن تبقى فارغة (المحرر يبدّل تلقائياً) */
export function shortcutConflicts(map: ShortcutMap): { key: string; actions: ShortcutActionId[] }[] {
  const byKey = new Map<string, ShortcutActionId[]>()
  for (const def of SHORTCUT_ACTIONS) {
    const list = byKey.get(map[def.id]) ?? []
    list.push(def.id)
    byKey.set(map[def.id], list)
  }
  return [...byKey.entries()].filter(([, actions]) => actions.length > 1).map(([key, actions]) => ({ key, actions }))
}

/** المفاتيح الحرة (غير المسندة لأي فعل) — للاقتراح في شاشة التخصيص */
export function freeShortcutKeys(map: ShortcutMap): string[] {
  const used = new Set(Object.values(map))
  return FUNCTION_KEYS.filter((key) => !used.has(key))
}

/** فعل مفتاح مضغوط — null إن كان المفتاح بلا فعل أو محتجزاً بفعلين (غامض ⇒ تجاهل آمن) */
export function shortcutActionFor(map: ShortcutMap, key: string): ShortcutActionId | null {
  const hits = SHORTCUT_ACTIONS.filter((def) => map[def.id] === key)
  return hits.length === 1 ? hits[0].id : null
}

/** فهرس عكسي: مفتاح ⇒ فعل (مع الغمض صفَراً) — لعرض «من يستخدم هذا المفتاح؟» */
export function shortcutOwnerOf(map: ShortcutMap, key: string): ShortcutActionId | null {
  const hits = SHORTCUT_ACTIONS.filter((def) => map[def.id] === key)
  return hits.length >= 1 ? hits[0].id : null
}
