/**
 * المظهر (المرحلة 1 — استكمال): نواة خالصة لتخصيص الواجهة —
 * لون رئيسي من لوحات جاهزة (تُطبَّق كمتغيرات CSS على الجذر فتتلون
 * كل عناصر brand فوراً)، حجم عرض (تكبير/تصغير)، وتقليل الحركة.
 */

export interface AccentPalette {
  id: string
  nameAr: string
  shades: Record<'50' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900', string>
}

export const ACCENTS: AccentPalette[] = [
  {
    id: 'indigo', nameAr: 'نيلي (الافتراضي)',
    shades: { 50: '#eef2ff', 100: '#e0e7ff', 200: '#c7d2fe', 300: '#a5b4fc', 400: '#818cf8', 500: '#6366f1', 600: '#4f46e5', 700: '#4338ca', 800: '#3730a3', 900: '#312e81' },
  },
  {
    id: 'emerald', nameAr: 'زمردي',
    shades: { 50: '#ecfdf5', 100: '#d1fae5', 200: '#a7f3d0', 300: '#6ee7b7', 400: '#34d399', 500: '#10b981', 600: '#059669', 700: '#047857', 800: '#065f46', 900: '#064e3b' },
  },
  {
    id: 'sky', nameAr: 'سماوي',
    shades: { 50: '#f0f9ff', 100: '#e0f2fe', 200: '#bae6fd', 300: '#7dd3fc', 400: '#38bdf8', 500: '#0ea5e9', 600: '#0284c7', 700: '#0369a1', 800: '#075985', 900: '#0c4a6e' },
  },
  {
    id: 'violet', nameAr: 'بنفسجي',
    shades: { 50: '#f5f3ff', 100: '#ede9fe', 200: '#ddd6fe', 300: '#c4b5fd', 400: '#a78bfa', 500: '#8b5cf6', 600: '#7c3aed', 700: '#6d28d9', 800: '#5b21b6', 900: '#4c1d95' },
  },
  {
    id: 'rose', nameAr: 'وردي',
    shades: { 50: '#fff1f2', 100: '#ffe4e6', 200: '#fecdd3', 300: '#fda4af', 400: '#fb7185', 500: '#f43f5e', 600: '#e11d48', 700: '#be123c', 800: '#9f1239', 900: '#881337' },
  },
  {
    id: 'amber', nameAr: 'كهرماني',
    shades: { 50: '#fffbeb', 100: '#fef3c7', 200: '#fde68a', 300: '#fcd34d', 400: '#fbbf24', 500: '#f59e0b', 600: '#d97706', 700: '#b45309', 800: '#92400e', 900: '#78350f' },
  },
  {
    id: 'teal', nameAr: 'فيروزي',
    shades: { 50: '#f0fdfa', 100: '#ccfbf1', 200: '#99f6e4', 300: '#5eead4', 400: '#2dd4bf', 500: '#14b8a6', 600: '#0d9488', 700: '#0f766e', 800: '#115e59', 900: '#134e4a' },
  },
  {
    id: 'fuchsia', nameAr: 'أرجواني',
    shades: { 50: '#fdf4ff', 100: '#fae8ff', 200: '#f5d0fe', 300: '#f0abfc', 400: '#e879f9', 500: '#d946ef', 600: '#c026d3', 700: '#a21caf', 800: '#86198f', 900: '#701a75' },
  },
  {
    id: 'orange', nameAr: 'برتقالي',
    shades: { 50: '#fff7ed', 100: '#ffedd5', 200: '#fed7aa', 300: '#fdba74', 400: '#fb923c', 500: '#f97316', 600: '#ea580c', 700: '#c2410c', 800: '#9a3412', 900: '#7c2d12' },
  },
  {
    id: 'cyan', nameAr: 'أزرق طبي',
    shades: { 50: '#ecfeff', 100: '#cffafe', 200: '#a5f3fc', 300: '#67e8f9', 400: '#22d3ee', 500: '#06b6d4', 600: '#0891b2', 700: '#0e7490', 800: '#155e75', 900: '#164e63' },
  },
  {
    id: 'gold', nameAr: 'ذهبي فاخر',
    shades: { 50: '#fdfaf0', 100: '#faf0d7', 200: '#f3ddaa', 300: '#eac776', 400: '#dfae4a', 500: '#c9952c', 600: '#a97a1f', 700: '#875f1b', 800: '#6e4d1c', 900: '#5c401b' },
  },
  {
    // 🥩 الجزارة: أحمر لحمي حِرفي — أدفأ وأعمق من الوردي، يوحي بالطزاجة
    id: 'crimson', nameAr: 'قرمزي الجزارة',
    shades: { 50: '#fef2f2', 100: '#fee2e2', 200: '#fecaca', 300: '#fca5a5', 400: '#f87171', 500: '#ef4444', 600: '#dc2626', 700: '#b91c1c', 800: '#991b1b', 900: '#7f1d1d' },
  },
  {
    // 🌴 التمور: بني تمري صحراوي — لون السكري والخلاص الناضج وكرم النخيل
    id: 'date_palm', nameAr: 'تمري صحراوي',
    shades: { 50: '#fdf8ef', 100: '#f9edd3', 200: '#f1d9a3', 300: '#e6bf6d', 400: '#d9a441', 500: '#c78a28', 600: '#a86e1e', 700: '#86541b', 800: '#6d441c', 900: '#5a371a' },
  },
]

/**
 * الهوية اللونية حسب النشاط (قرار المالك بعد النقاش): كل نشاط يبدأ بلوحة
 * تناسبه تلقائياً عند إتمام معالج التسجيل — صيدلية فيروزي طبي، مجوهرات ذهبي،
 * نقليات برتقالي… — ويحتفظ المستخدم بحرية اختيار لون آخر من إعدادات المظهر.
 */
export const ACTIVITY_ACCENTS: Record<string, string> = {
  grocery: 'emerald', // طزاجة الأغذية
  mobile: 'sky', // تقني هادئ
  clothing: 'fuchsia', // أزياء وحيوية
  pharmacy: 'teal', // طبي مطمئن
  electronics: 'indigo', // أجهزة واحترافية
  spare_parts: 'orange', // ورش ومعدات
  equipment_rental: 'amber', // معدات ثقيلة
  logistics: 'orange', // شاحنات وطرق
  lab: 'cyan', // معامل وتحاليل
  contracting: 'amber', // بناء وخوذات
  clinic: 'cyan', // عيادات
  cars: 'rose', // معارض سيارات
  restaurant: 'orange', // مطاعم دافئة
  jewelry: 'gold', // ذهب فاخر
  laundry: 'sky', // نظافة وانتعاش
  butcher: 'crimson', // أحمر لحمي حِرفي
  dates: 'date_palm', // بني تمري صحراوي
  salon: 'fuchsia', // أناقة وعناية
  bakery: 'amber', // دفء الأفران
  realestate: 'teal', // عقارات وعمران
  general: 'indigo', // الافتراضي
}

/** لوحة النشاط الافتراضية — نشاط مجهول ⇒ الافتراضي العام */
export function activityAccentId(activityId: string | null | undefined): string {
  return (activityId && ACTIVITY_ACCENTS[activityId]) || DEFAULT_ACCENT_ID
}

export const DEFAULT_ACCENT_ID = 'indigo'

/** مستويات التكبير المتاحة (zoom على الجذر — مناسب لتطبيق سطح مكتب) */
export const ZOOM_LEVELS = [
  { value: 0.85, label: 'مضغوط' },
  { value: 1, label: 'عادي' },
  { value: 1.1, label: 'كبير' },
  { value: 1.25, label: 'أكبر' },
] as const

export interface AppearanceSettings {
  accentId: string
  zoom: number
  reduceMotion: boolean
}

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  accentId: DEFAULT_ACCENT_ID,
  zoom: 1,
  reduceMotion: false,
}

/** خريطة متغيرات CSS للون المختار — تُطبَّق على documentElement */
export function buildAccentCssVars(accentId: string): Record<string, string> {
  const accent = ACCENTS.find((a) => a.id === accentId) ?? ACCENTS[0]
  const vars: Record<string, string> = {}
  for (const [shade, hex] of Object.entries(accent.shades)) {
    vars[`--color-brand-${shade}`] = hex
  }
  return vars
}

/** تحقق من صحة الإعدادات (تُستعمل عند الاستعادة من نسخة احتياطية) */
export function sanitizeAppearance(input: Partial<AppearanceSettings> | null | undefined): AppearanceSettings {
  const accentId = input?.accentId && ACCENTS.some((a) => a.id === input.accentId) ? input.accentId : DEFAULT_ACCENT_ID
  const zoom = input?.zoom && ZOOM_LEVELS.some((z) => z.value === input.zoom) ? input.zoom : 1
  return { accentId, zoom, reduceMotion: input?.reduceMotion === true }
}
