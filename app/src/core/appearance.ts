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
]

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
