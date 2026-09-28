/**
 * العملة الثانية داخل السند (البند §8/١ من تقرير التدقيق):
 * «تحصيل/سداد بعملة غير عملة الدفتر».
 *
 * **القرار المحاسبي**: الدفتر يبقى أحادي العملة — كل قيد يُرحَّل بعملة الدفتر.
 * ما يضيفه هذا الملف هو **ساق العملة الأجنبية** داخل السند: المبلغ الأجنبي وسعر
 * الصرف المستعمل، وتحويلٌ صحيح إلى عملة الدفتر يُخزَّن هو ما يُرحَّل. لا فروق
 * عملة تُقيَّد لأن الذمة نفسها مسجَّلة بعملة الدفتر: من دفع 100 دولاراً بسعر
 * 48.50 يكون قد سدَّد 4,850 جنيهاً من دينه، والباقي يظل ديناً بالجنيه.
 *
 * الحساب كله بأعداد صحيحة (BigInt داخلياً) — لا كسور عائمة في المال إطلاقاً.
 */

/** سعر الصرف يُخزَّن مضروباً في مليون: 48.5 ⇒ 48_500_000 (ست خانات عشرية) */
export const FX_RATE_SCALE = 1_000_000

export interface FxLeg {
  /** رمز العملة الأجنبية بثلاثة حروف كبيرة — USD/EUR/SAR… */
  currencyCode: string
  /** المبلغ بالعملة الأجنبية بوحداتها الصغرى */
  amountMinor: number
  /** كم وحدة من عملة الدفتر مقابل وحدة واحدة من العملة الأجنبية × 1,000,000 */
  ratePpm: number
  /** عدد خانات العملة الأجنبية العشرية (0 أو 2 أو 3) */
  decimals: 0 | 2 | 3
}

const pow10 = (n: number) => 10n ** BigInt(n)

/**
 * تحويل مبلغ العملة الأجنبية إلى عملة الدفتر — تقريب نصفي لأعلى على أصغر وحدة.
 * يُستعمل في الواجهة وفي `postVoucher` معاً فلا يختلف المعروض عن المرحَّل.
 */
export function convertFxToBookMinor(leg: FxLeg, bookDecimals: number): number {
  const numerator = BigInt(Math.trunc(leg.amountMinor)) * BigInt(Math.trunc(leg.ratePpm)) * pow10(bookDecimals) * 2n
  const denominator = BigInt(FX_RATE_SCALE) * pow10(leg.decimals) * 2n
  if (denominator === 0n) return 0
  const doubled = (numerator + denominator / 2n) / denominator
  return Number(doubled)
}

/** سعر الصرف من نص المستخدم («48.5») إلى عدد صحيح بمقياس المليون */
export function parseRateToPpm(raw: string): number {
  const cleaned = String(raw ?? '')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[٫,]/g, '.')
    .replace(/[^\d.]/g, '')
  if (!cleaned) return 0
  const [whole, fraction = ''] = cleaned.split('.')
  const six = (fraction + '000000').slice(0, 6)
  return Number(whole || '0') * FX_RATE_SCALE + Number(six || '0')
}

/** عرض سعر الصرف بست خانات بلا أصفار زائدة: 48500000 ⇒ «48.5» */
export function formatRate(ratePpm: number): string {
  const whole = Math.trunc(ratePpm / FX_RATE_SCALE)
  const fraction = String(Math.abs(ratePpm % FX_RATE_SCALE)).padStart(6, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : String(whole)
}

/**
 * فحص ساق العملة قبل الترحيل — كلها أخطاء عربية صريحة:
 * رمز غير صالح · نفس عملة الدفتر · مبلغ أو سعر غير موجب · سعر خارج المدى المعقول.
 */
export function validateFxLeg(leg: FxLeg, bookCurrencyCode: string): string[] {
  const errors: string[] = []
  const code = (leg.currencyCode ?? '').trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(code)) errors.push('رمز العملة يجب أن يكون ثلاثة حروف لاتينية (USD مثلاً)')
  if (code && code === bookCurrencyCode.toUpperCase()) errors.push('عملة السند هي عملة الدفتر نفسها — لا حاجة لسعر صرف')
  if (!Number.isInteger(leg.amountMinor) || leg.amountMinor <= 0) errors.push('مبلغ العملة الأجنبية يجب أن يكون أكبر من صفر')
  if (!Number.isInteger(leg.ratePpm) || leg.ratePpm <= 0) errors.push('سعر الصرف مطلوب وأكبر من صفر')
  if (leg.ratePpm > 1_000_000 * FX_RATE_SCALE) errors.push('سعر الصرف غير معقول')
  if (![0, 2, 3].includes(leg.decimals)) errors.push('خانات العملة العشرية غير مدعومة')
  return errors
}

/** سطر يُطبع على السند وفي وصف القيد: «100.00 USD × 48.5 = 4,850.00» */
export function describeFxLeg(leg: FxLeg, bookMinor: number, bookDecimals: number): string {
  const fx = (leg.amountMinor / 10 ** leg.decimals).toFixed(leg.decimals)
  const book = (bookMinor / 10 ** bookDecimals).toFixed(bookDecimals)
  return `${fx} ${leg.currencyCode.toUpperCase()} × ${formatRate(leg.ratePpm)} = ${book}`
}

/** عملات شائعة في السندات الأجنبية — تُعرض في المنتقي ويمكن كتابة غيرها */
export const COMMON_FX_CURRENCIES: { code: string; nameAr: string; decimals: 0 | 2 | 3 }[] = [
  { code: 'USD', nameAr: 'دولار أمريكي', decimals: 2 },
  { code: 'EUR', nameAr: 'يورو', decimals: 2 },
  { code: 'GBP', nameAr: 'جنيه إسترليني', decimals: 2 },
  { code: 'SAR', nameAr: 'ريال سعودي', decimals: 2 },
  { code: 'AED', nameAr: 'درهم إماراتي', decimals: 2 },
  { code: 'KWD', nameAr: 'دينار كويتي', decimals: 3 },
  { code: 'QAR', nameAr: 'ريال قطري', decimals: 2 },
  { code: 'EGP', nameAr: 'جنيه مصري', decimals: 2 },
  { code: 'TRY', nameAr: 'ليرة تركية', decimals: 2 },
  { code: 'CNY', nameAr: 'يوان صيني', decimals: 2 },
]
