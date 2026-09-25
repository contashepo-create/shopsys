import { describe, expect, it } from 'vitest'
import { allocateChargeByLineBase, documentNetAfterCharges } from '../src/core/documentCharges.ts'
describe('خصومات ورسوم المستند', () => {
  it('يوزع الرسم ويضع فرق التقريب على آخر سطر', () => expect(allocateChargeByLineBase(10, [100, 100, 100]).map((x) => x.amountMinor)).toEqual([3, 3, 4]))
  it('لا يحمل السطر الصفري رسماً', () => expect(allocateChargeByLineBase(9, [0, 200, 100]).map((x) => x.amountMinor)).toEqual([0, 6, 3]))
  it('يفصل الخصم عن الرسوم الإضافية', () => expect(documentNetAfterCharges(1000, [{ kind: 'discount', nameAr: 'خصم', amountMinor: 100, taxable: false }, { kind: 'shipping', nameAr: 'شحن', amountMinor: 50, taxable: true }])).toBe(950))
  it('يرفض توزيع رسم على أساس صفري', () => expect(() => allocateChargeByLineBase(5, [0, 0])).toThrow('صفري'))
})
