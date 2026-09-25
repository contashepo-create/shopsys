import { describe, expect, it } from 'vitest'
import { sameDocumentAddress, validateDocumentAddress } from '../src/core/documentAddress.ts'
const empty = { nameAr: '', countryCode: '', city: '', district: '', street: '', buildingNumber: '', postalCode: '', additionalNumber: '', phone: '', taxNumber: '' }
const address = { ...empty, nameAr: 'شركة النور', countryCode: 'EG', city: 'المنصورة', street: 'شارع الجيش', phone: '+201001234567', postalCode: '35511', taxNumber: '12345-678' }
describe('لقطة عنوان المستند', () => {
  it('يسمح بعنوان اختياري فارغ', () => expect(validateDocumentAddress(empty)).toEqual([]))
  it('يتحقق من عنوان الشحن المطلوب', () => expect(validateDocumentAddress(address, true)).toEqual([]))
  it('يرفض الهاتف والدولة غير الصحيحين', () => expect(validateDocumentAddress({ ...address, countryCode: 'egy', phone: '12' }, true)).toHaveLength(2))
  it('يقارن لقطتي الفوترة والشحن', () => { expect(sameDocumentAddress(address, { ...address })).toBe(true); expect(sameDocumentAddress(address, { ...address, city: 'القاهرة' })).toBe(false) })
})
