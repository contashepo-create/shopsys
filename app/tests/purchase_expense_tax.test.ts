import { describe, expect, it } from 'vitest'
import { purchaseExpenseTaxParts } from '../src/core/purchases.ts'
import { resolveBusinessTax } from '../src/core/taxRegistration.ts'

describe('ضريبة كل مصروف شراء حسب صفة المنشأة', () => {
  it('المسجل بالنسبة المحفوظة يفصل ضريبة المدخلات عن التكلفة', () => {
    expect(purchaseExpenseTaxParts({ amountMinor: 10000, taxTreatment: 'exclusive' }, resolveBusinessTax('registered', 14))).toEqual({ baseMinor: 10000, taxMinor: 1400, recoverableTaxMinor: 1400, costMinor: 10000, payableMinor: 11400 })
  })
  it('المعفى لا يسترد الضريبة فتدخل التكلفة', () => {
    expect(purchaseExpenseTaxParts({ amountMinor: 11400, taxTreatment: 'inclusive', taxPercent: 14 }, resolveBusinessTax('exempt', 14))).toEqual({ baseMinor: 10000, taxMinor: 1400, recoverableTaxMinor: 0, costMinor: 11400, payableMinor: 11400 })
  })
  it('المسجل بنسبة صفر يظل مختلفاً عن المعفى ويمكنه معالجة ضريبة موثقة', () => {
    const policy = resolveBusinessTax('zero_rated', 14)
    expect(purchaseExpenseTaxParts({ amountMinor: 10000, taxTreatment: 'exclusive' }, policy).taxMinor).toBe(0)
    expect(purchaseExpenseTaxParts({ amountMinor: 10000, taxTreatment: 'exclusive', taxPercent: 14 }, policy)).toMatchObject({ recoverableTaxMinor: 1400, costMinor: 10000, payableMinor: 11400 })
  })
  it('يبقي المصروف معفى افتراضياً ولا يفعّل الضريبة تلقائياً', () => {
    expect(purchaseExpenseTaxParts({ amountMinor: 10000 }, resolveBusinessTax('registered', 14))).toEqual({ baseMinor: 10000, taxMinor: 0, recoverableTaxMinor: 0, costMinor: 10000, payableMinor: 10000 })
  })
})
