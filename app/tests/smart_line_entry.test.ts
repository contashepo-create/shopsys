/** الإدخال الذكي بسطر واحد + قاعدة «لا تُكتب معفى في الفاتورة» */
import { describe, it, expect } from 'vitest'
import { parseSmartEntry } from '../src/ui/components/smartEntry.ts'

describe('الإدخال الذكي في خلية الصنف', () => {
  it('يفصل الكمية والسعر والخصم عن اسم الصنف', () => {
    expect(parseSmartEntry('أرز*3@65-5%')).toEqual({ term: 'أرز', qty: 3, price: 65, discount: 5 })
  })
  it('يقبل × بدل * ومسافات', () => {
    expect(parseSmartEntry('زيت عباد الشمس × 2 @ 64.5')).toEqual({ term: 'زيت عباد الشمس', qty: 2, price: 64.5 })
  })
  it('يقبل الترتيب المعكوس', () => {
    expect(parseSmartEntry('@70 سكر *4')).toEqual({ term: 'سكر', qty: 4, price: 70 })
  })
  it('النص وحده يبقى بحثاً عادياً', () => {
    expect(parseSmartEntry('شاي العروسة')).toEqual({ term: 'شاي العروسة' })
  })
  it('يحدّ الخصم بمئة ويتجاهل السالب', () => {
    expect(parseSmartEntry('مكرونة-250%').discount).toBe(100)
    expect(parseSmartEntry('مكرونة').discount).toBeUndefined()
  })
  it('يقبل الفاصلة العشرية', () => {
    expect(parseSmartEntry('جبن*1,5@120')).toEqual({ term: 'جبن', qty: 1.5, price: 120 })
  })
})
