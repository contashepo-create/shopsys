import { describe, expect, it } from 'vitest'
import { resolveDocumentTax } from '../src/core/taxResolution.ts'
const tax = { code: 'VAT14', nameAr: 'القيمة المضافة', rateBasisPoints: 1400, capturedAt: '2026-09-22T00:00:00Z' }
describe('حسم ضريبة المستند', () => {
 it('يعطل الضريبة لغير المسجل مهما كانت الضريبة المضبوطة', () => expect(resolveDocumentTax({ status: 'not_registered', countryCode: 'EG' }, 'standard', tax)).toEqual({ treatment: 'not_registered', snapshot: null, disclosureAr: 'المنشأة غير مسجلة ضريبياً' }))
 it('يثبت رقم تسجيل المنشأة المسجلة في اللقطة', () => expect(resolveDocumentTax({ status: 'registered', countryCode: 'EG', registrationNumber: '999' }, 'standard', tax).snapshot?.registrationNumber).toBe('999'))
 it('يميز النص القانوني للصفر عن الإعفاء', () => expect(resolveDocumentTax({ status: 'registered', countryCode: 'EG', registrationNumber: '9' }, 'zero_rated', null).disclosureAr).toContain('بنسبة صفر'))
 it('يرفض ضريبة قياسية صفرية للمسجل', () => expect(() => resolveDocumentTax({ status: 'registered', countryCode: 'EG', registrationNumber: '9' }, 'standard', { ...tax, rateBasisPoints: 0 })).toThrow('صالحة'))
})
