import { describe, expect, it } from 'vitest'
import { guardTaxDocument } from '../src/core/taxDocumentGuard.ts'
describe('حارس عرض ضريبة المستند', () => {
 it('يخفي أعمدة ورقم الضريبة لغير المسجل ويعرض الإفصاح', () => expect(guardTaxDocument({ status: 'not_registered', countryCode: 'EG' }, [{ taxMinor: 0, treatment: 'not_registered' }])).toEqual({ showTaxColumns: false, showRegistrationNumber: false, footerAr: 'المنشأة غير مسجلة ضريبياً' }))
 it('يمنع ضريبة فعلية لغير المسجل', () => expect(() => guardTaxDocument({ status: 'not_registered', countryCode: 'EG' }, [{ taxMinor: 14, treatment: 'standard' }])).toThrow('لا يجوز'))
 it('يعرض تفاصيل الضريبة للمسجل', () => expect(guardTaxDocument({ status: 'registered', countryCode: 'EG', registrationNumber: '123' }, [{ taxMinor: 1400, treatment: 'standard' }]).showTaxColumns).toBe(true))
 it('يمنع معالجة غير مسجل في فاتورة منشأة مسجلة', () => expect(() => guardTaxDocument({ status: 'registered', countryCode: 'EG', registrationNumber: '123' }, [{ taxMinor: 0, treatment: 'not_registered' }])).toThrow('غير مسموحة'))
})
