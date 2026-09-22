import { describe, expect, it } from 'vitest'
import { taxEnabled, validateTaxRegistration } from '../src/core/taxRegistration.ts'
describe('حالة التسجيل الضريبي', () => {
 it('يسمح لمنشأة غير مسجلة في دولة ضريبية', () => expect(taxEnabled({ status: 'not_registered', countryCode: 'EG' })).toBe(false))
 it('يتطلب رقماً للمنشأة المسجلة', () => expect(validateTaxRegistration({ status: 'registered', countryCode: 'EG' })).toContain('رقم التسجيل الضريبي مطلوب للمنشأة المسجلة'))
 it('يرفض رقم التسجيل عند عدم التسجيل', () => expect(validateTaxRegistration({ status: 'not_registered', countryCode: 'SA', registrationNumber: '123' })).toContain('لا يحفظ رقم ضريبي لمنشأة غير مسجلة'))
 it('يقبل تسجيلاً كاملاً', () => expect(taxEnabled({ status: 'registered', countryCode: 'EG', registrationNumber: '123456789', effectiveFrom: '2026-01-01' })).toBe(true))
})
