import { describe, expect, it } from 'vitest'
import { foreignMinorToLocalMinor, validateCurrencySnapshot } from '../src/core/documentCurrency.ts'
const usd = { currencyCode: 'USD', currencyDecimals: 2, localMinorPerForeignMajorScaled: 4_850_000, rateScale: 3, capturedAt: '2026-09-22T10:00:00Z' }
describe('عملة المستند وسعر الصرف المثبت', () => {
  it('يحول بوحدات صحيحة دون float', () => expect(foreignMinorToLocalMinor(12_345, usd)).toBe(598_733))
  it('يحفظ اتجاه المبلغ السالب للعكس', () => expect(foreignMinorToLocalMinor(-100, usd)).toBe(-4_850))
  it('يرفض كوداً وسعراً غير صالحين', () => expect(validateCurrencySnapshot({ ...usd, currencyCode: 'usd', localMinorPerForeignMajorScaled: 0 })).toHaveLength(2))
})
