import { describe, expect, it } from 'vitest'
import { splitTaxPrice } from '../src/core/taxPricing.ts'
describe('السعر شامل وغير شامل الضريبة', () => {
 it('يضيف الضريبة إلى السعر غير الشامل', () => expect(splitTaxPrice(10000, 1400, 'exclusive')).toEqual({ netMinor: 10000, taxMinor: 1400, grossMinor: 11400 }))
 it('يفصل الضريبة من السعر الشامل دون تغيير الإجمالي', () => expect(splitTaxPrice(11400, 1400, 'inclusive')).toEqual({ netMinor: 10000, taxMinor: 1400, grossMinor: 11400 }))
 it('يحافظ على السعر عند نسبة صفر', () => expect(splitTaxPrice(999, 0, 'inclusive')).toEqual({ netMinor: 999, taxMinor: 0, grossMinor: 999 }))
 it('يرفض المبالغ السالبة', () => expect(() => splitTaxPrice(-1, 1400, 'exclusive')).toThrow('غير صالحة'))
})
