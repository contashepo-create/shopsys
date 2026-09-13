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

/** تحويل من نص/رقم مُدخل إلى أصغر وحدة (بأمان من أخطاء التعويم) */
export function toMinor(value: string | number, decimals: number): Minor {
  const s = String(value).trim().replace(/[٬,]/g, '')
  if (s === '' || s === '-') return 0
  const neg = s.startsWith('-')
  const [intPart, fracRaw = ''] = s.replace('-', '').split('.')
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
