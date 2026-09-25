import { describe, expect, it } from 'vitest'
import { calculateTaxMinor, summarizeTaxes, validateTaxSnapshot } from '../src/core/documentTax.ts'
const vat = { code: 'VAT14', nameAr: 'قيمة مضافة', rateBasisPoints: 1400, capturedAt: '2026-09-22T00:00:00.000Z' }
describe('لقطة ضريبة المستند', () => {
 it('تحسب بـBigInt وتقرب لأقرب minor', () => expect(calculateTaxMinor(105, vat)).toBe(15))
 it('تجمع الخاضع والمعفى منفصلين', () => expect(summarizeTaxes([{ netMinor: 10000, tax: vat }, { netMinor: 500, tax: null }])).toEqual({ VAT14: { netMinor: 10000, taxMinor: 1400 }, EXEMPT: { netMinor: 500, taxMinor: 0 } }))
 it('ترفض النسب والتواريخ غير الصالحة', () => expect(validateTaxSnapshot({ ...vat, rateBasisPoints: 10001, capturedAt: 'x' })).toHaveLength(2))
 it('ترفض صافي السطر السالب', () => expect(() => calculateTaxMinor(-1, vat)).toThrow('غير صالح'))
})
