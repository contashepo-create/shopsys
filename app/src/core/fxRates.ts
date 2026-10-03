/**
 * أسعار الصرف المركزية (طلب المالك 2026-10-01):
 * ───────────────────────────────────────────────
 * قبل هذا الملف كان سعر الصرف يُكتب يدوياً في كل فاتورة/سند بلا ذاكرة.
 * الآن لكل عملة سعر محفوظ بمصدره وتاريخه وآخر من حدّثه، ويُستعمل تلقائياً
 * كسعر افتراضي في الفواتير، مع خيارين للتحديث:
 *   ① يدوي — المالك يكتب السعر بنفسه (بعد الرقم السري).
 *   ② API  — سحب تلقائي من مزود مجاني لا يحتاج مفتاحاً (open.er-api.com)
 *            أو من رابط مخصص يرجع JSON بالصيغة نفسها.
 *
 * القرار المحاسبي الموروث من foreignCurrency.ts يبقى كما هو: الدفتر أحادي
 * العملة — هذه الأسعار «افتراضية استرشادية» توفّق الكتابة فقط، والمُرحَّل
 * دائماً هو الساق (المبلغ الأجنبي × السعر) الذي اعتمده المستخدم في السند.
 */

import { COMMON_FX_CURRENCIES, FX_RATE_SCALE, parseRateToPpm, type FxLeg } from './foreignCurrency.ts'

/** سعر صرف محفوظ لعملة واحدة مقابل عملة الدفتر */
export interface FxRateRecord {
  /** كم وحدة من عملة الدفتر مقابل وحدة واحدة من العملة الأجنبية × 1,000,000 */
  ratePpm: number
  /** ISO وقت آخر تحديث */
  updatedAt: string
  /** اسم من حدّث السعر (أو «API») */
  updatedBy: string
  source: 'manual' | 'api'
}

export type FxRatesMap = Record<string, FxRateRecord>

/** مزود التلقائي — erapi مجاني بلا مفتاح، custom يسمح بأي رابط بالصيغة نفسها */
export type FxApiProvider = 'erapi' | 'custom'

export interface FxRatesSettings {
  mode: 'manual' | 'api'
  apiProvider: FxApiProvider
  /** رابط مخصص — يجب أن يعيد { "rates": { "USD": 0.0207, … } } بأساس عملة الدفتر */
  customUrl: string
  /** سحب تلقائي عند فتح الفاتورة إن مرّت هذه الساعات (0 = لا سحب تلقائي) */
  autoRefreshHours: number
  /** آخر سحب ناجح (ISO) — يُعرض للمستخدم ليحكم على حداثة الأسعار */
  lastRefreshAt: string | null
  lastRefreshError: string | null
}

export const DEFAULT_FX_RATES_SETTINGS: FxRatesSettings = {
  mode: 'manual',
  apiProvider: 'erapi',
  customUrl: '',
  autoRefreshHours: 0,
  lastRefreshAt: null,
  lastRefreshError: null,
}

export function normalizeFxRatesSettings(raw: Partial<FxRatesSettings> | null | undefined): FxRatesSettings {
  return {
    mode: raw?.mode === 'api' ? 'api' : 'manual',
    apiProvider: raw?.apiProvider === 'custom' ? 'custom' : 'erapi',
    customUrl: String(raw?.customUrl ?? '').trim().slice(0, 500),
    autoRefreshHours: Math.max(0, Math.min(168, Math.round(Number(raw?.autoRefreshHours ?? 0)) || 0)),
    lastRefreshAt: typeof raw?.lastRefreshAt === 'string' ? raw.lastRefreshAt : null,
    lastRefreshError: typeof raw?.lastRefreshError === 'string' ? raw.lastRefreshError : null,
  }
}

/** العملات المتاحة للتحديد في مدير الأسعار (كل الشائعة إلا عملة الدفتر نفسها) */
export function fxManagedCurrencies(bookCode: string): { code: string; nameAr: string; decimals: 0 | 2 | 3 }[] {
  const book = (bookCode ?? '').toUpperCase()
  return COMMON_FX_CURRENCIES.filter((row) => row.code !== book)
}

/** هل السعر محفوظ حديثاً بما يكفي؟ (لا سحب تلقائي لازم) */
export function fxRateIsFresh(record: FxRateRecord | undefined, maxAgeHours: number): boolean {
  if (!record) return false
  if (maxAgeHours <= 0) return true
  return Date.now() - Date.parse(record.updatedAt) < maxAgeHours * 3_600_000
}
/** تسوية ساق الفاتورة بسعر محفوظ: يملأ السعر الغائب فقط ولا يُجور على ما كتبه المستخدم */
export function fxLegWithDefaultRate(leg: FxLeg, rates: FxRatesMap): FxLeg {
  if (leg.ratePpm > 0) return leg
  const saved = rates[leg.currencyCode.toUpperCase()]
  return saved && saved.ratePpm > 0 ? { ...leg, ratePpm: saved.ratePpm } : leg
}

/* ─── السحب من API ─── */

export interface FxApiQuote { code: string; ratePpm: number }

/**
 * سحب أسعار من المزود. يعيد لكل عملة مطلوبة سعرها مقابل عملة الدفتر
 * (ratePpm = وحدات الدفتر لكل وحدة أجنبية × مليون).
 * erapi: https://open.er-api.com/v6/latest/EGP → rates.USD = دولار لكل جنيه
 *        فنقلبه (÷) لنحصل على جنيه لكل دولار — بتقريب نصفي على مقياس المليون.
 * custom: نفس صيغة الاستجابة { rates: { CODE: number } } بأساس عملة الدفتر.
 */
export async function fetchFxRates(args: {
  provider: FxApiProvider
  customUrl: string
  bookCode: string
  codes: string[]
  signal?: AbortSignal
}): Promise<FxApiQuote[]> {
  const book = (args.bookCode ?? '').toUpperCase()
  if (!/^[A-Z]{3}$/.test(book)) throw new Error('عملة الدفتر غير سليمة — راجع إعدادات النشاط')
  const wanted = [...new Set(args.codes.map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z]{3}$/.test(c) && c !== book))]
  if (!wanted.length) return []
  const url = args.provider === 'custom'
    ? args.customUrl.replace('{BASE}', book)
    : `https://open.er-api.com/v6/latest/${book}`
  if (!/^https?:\/\//.test(url)) throw new Error('رابط المزود غير سليم (يجب أن يبدأ بـ http/https)')
  const response = await fetch(url, { signal: args.signal })
  if (!response.ok) throw new Error(`المزود ردّ بالحالة ${response.status}`)
  const payload = (await response.json()) as { result?: string; rates?: Record<string, number>; error_type?: string }
  if (payload.error_type) throw new Error(`خطأ المزود: ${payload.error_type}`)
  const rates = payload.rates
  if (!rates || typeof rates !== 'object') throw new Error('استجابة المزود بلا جدول rates')
  const quotes: FxApiQuote[] = []
  for (const code of wanted) {
    const raw = Number(rates[code])
    if (!Number.isFinite(raw) || raw <= 0) continue
    // المزود يعيد «وحدات العملة الأجنبية لكل وحدة من عملة الدفتر» ⇒ نقلبه
    const ppm = Math.round((1 / raw) * FX_RATE_SCALE)
    if (ppm > 0 && ppm <= FX_RATE_SCALE * 1_000_000) quotes.push({ code, ratePpm: ppm })
  }
  if (!quotes.length) throw new Error('لم يعرف المزود أياً من العملات المطلوبة')
  return quotes
}

/** نص «آخر تحديث» مختصر بالعربية */
export function fxRateAgeLabel(record: FxRateRecord | undefined): string {
  if (!record) return 'لا سعر محفوظ'
  const ms = Date.now() - Date.parse(record.updatedAt)
  if (!Number.isFinite(ms) || ms < 0) return 'الآن'
  const minutes = Math.round(ms / 60_000)
  if (minutes < 1) return 'الآن'
  if (minutes < 60) return `قبل ${minutes} دقيقة`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `قبل ${hours} ساعة`
  const days = Math.round(hours / 24)
  return `قبل ${days} يوم`
}

/** تحويل نص المستخدم («48.5») إلى ratePpm — غلاف يوحّد الاستعمال */
export function parseFxRateInput(raw: string): number {
  return parseRateToPpm(raw)
}
