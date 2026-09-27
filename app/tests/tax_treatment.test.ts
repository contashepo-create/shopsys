import { describe, expect, it } from 'vitest'
import { validateTaxTreatment } from '../src/core/taxTreatment.ts'
const unregistered = { status: 'not_registered' as const, countryCode: 'EG' }
const registered = { status: 'registered' as const, countryCode: 'EG', registrationNumber: '123' }
describe('المعالجة الضريبية', () => {
 it('يفرض صفراً وغير مسجل على المنشأة غير المسجلة', () => expect(validateTaxTreatment(unregistered, { treatment: 'not_registered', rateBasisPoints: 0 })).toEqual([]))
 it('يمنع تطبيق المعدل القياسي على غير المسجل', () => expect(validateTaxTreatment(unregistered, { treatment: 'standard', rateBasisPoints: 1400 }).length).toBeGreaterThan(0))
 it('يفصل الصفري عن المعفى ويلزم السبب', () => expect(validateTaxTreatment(registered, { treatment: 'zero_rated', rateBasisPoints: 0 })).toContain('سبب المعالجة الضريبية مطلوب'))
 it('يقبل المعدل القياسي للمسجل', () => expect(validateTaxTreatment(registered, { treatment: 'standard', rateBasisPoints: 1400 })).toEqual([]))
})
