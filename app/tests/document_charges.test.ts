import { describe, expect, it } from 'vitest'
import { allocateChargeByLineBase, documentNetAfterCharges } from '../src/core/documentCharges.ts'
describe('خصومات ورسوم المستند', () => {
  it('يوزع الرسم ويضع فرق التقريب على آخر سطر', () => expect(allocateChargeByLineBase(10, [100, 100, 100]).map((x) => x.amountMinor)).toEqual([3, 3, 4]))
  it('لا يحمل السطر الصفري رسماً', () => expect(allocateChargeByLineBase(9, [0, 200, 100]).map((x) => x.amountMinor)).toEqual([0, 6, 3]))
  it('يفصل الخصم عن الرسوم الإضافية', () => expect(documentNetAfterCharges(1000, [{ kind: 'discount', nameAr: 'خصم', amountMinor: 100, taxable: false }, { kind: 'shipping', nameAr: 'شحن', amountMinor: 50, taxable: true }])).toBe(950))
  it('يرفض توزيع رسم على أساس صفري', () => expect(() => allocateChargeByLineBase(5, [0, 0])).toThrow('صفري'))
  // (§76) انحدار: التقريب النصفي لأكثر من سطر كان يتجاوز الرسم فيأخذ الأخير سالباً
  it('لا يعطي سطراً حصة سالبة مهما صغر الرسم وكثرت الأسطر', () => {
    expect(allocateChargeByLineBase(2, [1, 1, 1, 1]).map((x) => x.amountMinor)).toEqual([0, 0, 0, 2])
    expect(allocateChargeByLineBase(1, [1, 1, 1, 1]).map((x) => x.amountMinor)).toEqual([0, 0, 0, 1])
    expect(allocateChargeByLineBase(3, [1, 1, 1, 1]).map((x) => x.amountMinor)).toEqual([0, 0, 0, 3])
    // ملكية: 20 ألف حالة عشوائية — المجموع مطابق ولا سالب أبداً
    let seed = 987654321
    const ri = (a: number, b: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return a + seed % (b - a + 1) }
    for (let t = 0; t < 20000; t++) {
      const amount = ri(0, 400)
      const bases = Array.from({ length: ri(1, 9) }, () => ri(0, 900))
      const alloc = allocateChargeByLineBase(amount, bases)
      expect(alloc.reduce((sum, x) => sum + x.amountMinor, 0)).toBe(amount)
      for (const share of alloc) expect(share.amountMinor).toBeGreaterThanOrEqual(0)
    }
  })
})
