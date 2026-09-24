import { describe, expect, it } from 'vitest'
import { resolveBusinessTax } from '../src/core/taxRegistration.ts'

describe('صفة تسجيل المنشأة الضريبية', () => {
  it('يستخدم النسبة المسجلة للمنشأة المسجلة فقط', () => {
    expect(resolveBusinessTax('registered', 14)).toMatchObject({ effectivePercent: 14, canRecoverInputTax: true })
  })
  it('يفصل المسجل بنسبة صفر عن المعفى', () => {
    expect(resolveBusinessTax('zero_rated', 14)).toMatchObject({ effectivePercent: 0, canRecoverInputTax: true })
    expect(resolveBusinessTax('exempt', 14)).toMatchObject({ effectivePercent: 0, canRecoverInputTax: false })
    expect(resolveBusinessTax('registered', 0).disclosureAr).toContain('مسجلة')
  })
  it('يرفض النسب غير المنطقية', () => {
    expect(() => resolveBusinessTax('registered', -1)).toThrow(/بين 0 و100/)
  })
})
