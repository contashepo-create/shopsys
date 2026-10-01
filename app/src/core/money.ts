/**
 * محرك النقود الموحّد — ShopSys
 * ─────────────────────────────
 * القاعدة الملزمة (وثيقة التصميم — قاعدة 3):
 * كل المبالغ تُخزَّن وتُحسَب كأعداد صحيحة بأصغر وحدة عملة (مليم/هللة/قرش)
 * — ممنوع الحساب العائم المباشر نهائياً.
 *
 * يدعم الكسور العشرية المتغيرة حسب البلد:
 *   EGP/SAR = 2 خانات، KWD/BHD/OMR/JOD/TND/LYD = 3 خانات، IQD/YER/LBP/SYP = 0
 */

export type Minor = number // مبلغ بأصغر وحدة (عدد صحيح دائماً)

export interface CurrencyConfig {
  code: string
  symbol: string
  decimals: 0 | 2 | 3
  name: string
}

/** تطبيع الأرقام العربية والفارسية والفواصل العربية إلى ASCII — يمنع رفض «١٣٠» بصمت.
 * `decimals` (اختياري): خانات كسور العملة — تحسم فاصلةً وحيدة بلا نقطة:
 * خاناتها ≤ الكسور ⇒ فاصلة عشرية أرسلتها لوحة مفاتيح عربية («1,5» ⇒ 1.5)،
 * وخاناتها أكبر (مجموعة ثلاثية كـ«1,500») ⇒ فاصل آلاف إنجليزي يُحذف —
 * وإلا انقلب 1500 إلى 1.50 خطأً بألف ضعف في استيراد CSV أو الإدخال المباشر. */
export function normalizeDigits(s: string, decimals?: number): string {
  const translated = s
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/٫/g, '.') // الفاصلة العشرية العربية
    .replace(/٬/g, '') // فاصل الآلاف العربي
  // لوحة المفاتيح العربية قد ترسل الفاصلة الإنجليزية كفاصل عشري. عند وجود
  // نقطتين/فواصل معاً نعتبر آخر فاصل هو العشري والباقي فواصل آلاف.
  const lastDot = translated.lastIndexOf('.')
  const lastComma = translated.lastIndexOf(',')
  if (lastComma < 0) return translated
  if (lastDot < 0) {
    const commas = (translated.match(/,/g) ?? []).length
    if (commas === 1) {
      const digitsAfter = translated.length - lastComma - 1
      return decimals == null || digitsAfter <= decimals
        ? translated.replace(',', '.') // فاصل عشري عربي (سلوك مُوثق ومُختبَر)
        : translated.replace(/,/g, '') // مجموعة آلاف إنجليزية (1,500 ⇒ 1500)
    }
    // فواصل متعددة بلا نقطة: فإن كانت الخانات بعد الأخيرة ثلاثاً فكلها فواصل
    // آلاف إنجليزية (1,234,567) — وإلا فالأخيرة عشرية أوروبية (1,234,567,89).
    // كانت تُرفض خطأً «مدخل غير رقمي» لأن كل الفواصل كانت تتحول نقاطاً (§74/§75)
    const digitsAfterLast = translated.length - lastComma - 1
    if (digitsAfterLast === 3) return translated.replace(/,/g, '')
    const head = translated.slice(0, lastComma).replace(/,/g, '')
    return `${head}.${translated.slice(lastComma + 1)}`
  }
  return lastComma > lastDot
    ? translated.replace(/\./g, '').replace(',', '.')
    : translated.replace(/,/g, '')
}

/** تحويل من نص/رقم مُدخل إلى أصغر وحدة (بأمان من أخطاء التعويم) */
export function toMinor(value: string | number, decimals: number): Minor {
  const s = normalizeDigits(String(value).trim(), decimals)
  if (s === '' || s === '-' || s === '+') return 0
  // الترميز العلمي العشري فقط (1e5 تُكتبه خانات type=number): يُحوَّل بدقة.
  // أما حرفيا JS الأخرى (0x10 و0b101 وفواصل الأرقام 1_000) فكانت تُقرأ بصمت
  // قيماً غير مقصودة عبر Number() — تُرفض الآن صراحة (مراجعة §75).
  if (!/^[+-]?\d*(\.\d*)?$/.test(s)) {
    if (!/^[+-]?(\d+(\.\d*)?|\.\d+)[eE][+-]?\d+$/.test(s)) throw new RangeError('money: مدخل غير رقمي')
    const n = Number(s)
    if (!Number.isFinite(n)) throw new RangeError('money: مدخل غير رقمي')
    const minor = Math.round(n * 10 ** decimals)
    if (!Number.isSafeInteger(minor)) throw new RangeError('money: مبلغ خارج النطاق الآمن')
    return minor
  }
  const neg = s.startsWith('-')
  const [intPart, fracRaw = ''] = s.replace(/^[+-]/, '').split('.')
  const frac = (fracRaw + '0'.repeat(decimals)).slice(0, decimals)
  const minor = parseInt(intPart || '0', 10) * 10 ** decimals + (decimals ? parseInt(frac || '0', 10) : 0)
  if (!Number.isSafeInteger(minor)) throw new RangeError('money: مبلغ خارج النطاق الآمن')
  return neg ? -minor : minor
}

/** من أصغر وحدة إلى نص للعرض */
export function formatMinor(minor: Minor, cfg: CurrencyConfig, withSymbol = true): string {
  assertMinor(minor)
  const neg = minor < 0
  const abs = Math.abs(minor)
  const d = cfg.decimals
  const intPart = d ? Math.floor(abs / 10 ** d) : abs
  const frac = d ? String(abs % 10 ** d).padStart(d, '0') : ''
  const grouped = intPart.toLocaleString('en-US')
  const num = d ? `${grouped}.${frac}` : grouped
  const body = withSymbol ? `${num} ${cfg.symbol}` : num
  return neg ? `-${body}` : body
}

/** جمع آمن */
export function addMinor(...amounts: Minor[]): Minor {
  const sum = amounts.reduce((a, b) => {
    assertMinor(a); assertMinor(b)
    const r = a + b
    if (!Number.isSafeInteger(r)) throw new RangeError('money: تجاوز النطاق الآمن')
    return r
  }, 0)
  return sum
}

/** ضرب كمية (قد تكون كسرية كالوزن) في سعر — بتقريب نصفي مصرفي ثابت */
export function mulQty(priceMinor: Minor, qty: number): Minor {
  assertMinor(priceMinor)
  if (!Number.isFinite(qty)) throw new RangeError('money: كمية غير صالحة')
  return roundHalfUp(priceMinor * qty)
}

/** نسبة مئوية من مبلغ (للخصومات والضرائب) */
export function percentOf(baseMinor: Minor, percent: number): Minor {
  assertMinor(baseMinor)
  return roundHalfUp((baseMinor * percent) / 100)
}

/**
 * فصل الضريبة من سعر شامل: يعيد [الأساس, الضريبة] بحيث مجموعهما = المبلغ الشامل تماماً
 * (بلا فقدان قرش واحد — الضريبة هي الباقي وليست حساباً منفصلاً)
 */
export function splitInclusiveTax(grossMinor: Minor, taxPercent: number): [Minor, Minor] {
  assertMinor(grossMinor)
  const base = roundHalfUp((grossMinor * 100) / (100 + taxPercent))
  return [base, grossMinor - base]
}

/** ضريبة مضافة فوق الأساس: يعيد [الضريبة, الإجمالي] */
export function addExclusiveTax(baseMinor: Minor, taxPercent: number): [Minor, Minor] {
  assertMinor(baseMinor)
  const tax = percentOf(baseMinor, taxPercent)
  return [tax, baseMinor + tax]
}

function roundHalfUp(x: number): Minor {
  const r = Math.sign(x) * Math.round(Math.abs(x))
  if (!Number.isSafeInteger(r)) throw new RangeError('money: تجاوز النطاق الآمن')
  return r
}

function assertMinor(x: number): void {
  if (!Number.isSafeInteger(x)) throw new TypeError('money: المبالغ يجب أن تكون أعداداً صحيحة بأصغر وحدة')
}

/**
 * نغمة مؤشر الطرف داخل الفاتورة (بلاغ المالك: حالة الحساب تُقرأ بجوار الاسم لا في خانة منفصلة).
 *
 * - `danger`  الحساب موقوف، أو الرصيد المتوقع بعد ترحيل هذه الفاتورة يتجاوز الحد الائتماني.
 * - `warning` عليه مديونية لكنها داخل الحد.
 * - `positive` متزن أو دائن.
 *
 * تُستعمل للاسم وللمؤشر معاً حتى لا تتناقض الألوان في المستند.
 */
export function partyCreditTone(
  projectedBalanceMinor: Minor,
  creditLimitMinor?: Minor | null,
  active = true,
): 'positive' | 'warning' | 'danger' {
  if (!active) return 'danger'
  if (creditLimitMinor && creditLimitMinor > 0 && projectedBalanceMinor > creditLimitMinor) return 'danger'
  return projectedBalanceMinor > 0 ? 'warning' : 'positive'
}

export function partyBalanceText(
  balanceMinor: Minor,
  hasParty: boolean,
  currency: CurrencyConfig,
  words: { owes: string; owed: string; none?: string } = { owes: 'عليه', owed: 'له' },
): string {
  /**
   * نص رصيد الطرف كما يظهر في ترويسة الفاتورة (بلاغ المالك: «الرصيد يخرج خارج إطار البوكس»).
   * كان النص يُبنى دائماً كـ«القيمة + العملة + الحالة» فيصير «0.00 ر.س متزن» ويفيض من خانته.
   * عند التوازن لا قيمة تُذكر أصلاً: كلمة واحدة تكفي وتُقرأ في أضيق شاشة.
   */
  if (!hasParty) return words.none ?? 'نقدي — بلا حساب'
  if (balanceMinor === 0) return 'متزن'
  const value = `${formatMinor(Math.abs(balanceMinor), currency, false)} ${currency.symbol}`
  return balanceMinor > 0 ? `${value} ${words.owes}` : `${value} ${words.owed}`
}
