import { describe, expect, it } from 'vitest'
import { scaleWeightTargetError } from '../src/core/pos.ts'
import { scalePriceToMinor, weightFromPrintedPrice, parseScaleBarcodeUniversal, buildWithRule, SCALE_RULE_PRESETS } from '../src/core/barcode.ts'

/**
 * باركود **السعر**: الميزان يطبع المبلغ الكلي ولا يحمل الوزن ولا سعر الكيلو.
 * الوزن يُشتق = السعر ÷ سعر الكيلو الحالي، ويُنبَّه الكاشير صراحةً على السطر.
 */
const priceRule = { ...SCALE_RULE_PRESETS.find((preset) => preset.prefix === '20')!, id: 9, enabled: true } as const

describe('اشتقاق الوزن من باركود السعر', () => {
  it('12.50 جنيهاً بسعر كيلو 25 ⇒ نصف كيلو', () => {
    expect(weightFromPrintedPrice(1250, 2500)).toBe(0.5)
  })

  it('تقريب لثلاث خانات (جرامات) لا كسور عائمة', () => {
    expect(weightFromPrintedPrice(1000, 3000)).toBe(0.333)
    expect(weightFromPrintedPrice(2000, 3000)).toBe(0.667)
  })

  it('سعر كيلو صفري أو سالب ⇒ لا وزن (لا قسمة على صفر)', () => {
    expect(weightFromPrintedPrice(1250, 0)).toBeNull()
    expect(weightFromPrintedPrice(1250, -2500)).toBeNull()
  })

  it('مبلغ أصغر من أن يكوّن جراماً واحداً ⇒ null لا صفر', () => {
    expect(weightFromPrintedPrice(1, 100000)).toBeNull()
    expect(weightFromPrintedPrice(0, 2500)).toBeNull()
  })

  it('ربط كامل: ملصق بادئة 20 (سعر) يُفكّ ويُشتق منه الوزن ثم يُعاد المبلغ نفسه', () => {
    const label = buildWithRule(42, 1250, priceRule)
    const parsed = parseScaleBarcodeUniversal(label, [priceRule])
    expect(parsed).toMatchObject({ itemCode: '42', weightKg: null, priceRaw: 1250 })
    const priceMinor = scalePriceToMinor(parsed!.priceRaw!, parsed!.rule.valueDecimals, 2)
    expect(priceMinor).toBe(1250)
    const kg = weightFromPrintedPrice(priceMinor, 2500)!
    expect(kg).toBe(0.5)
    // المبلغ المدفوع = الوزن × سعر الكيلو = المبلغ المطبوع تماماً
    expect(Math.round(kg * 2500)).toBe(priceMinor)
  })
})

describe('إسناد وزن الميزان الحيّ للسطر', () => {
  it('سطر صنف موزون بالوحدة الأساسية يصلح', () => {
    expect(scaleWeightTargetError({ soldByWeight: true })).toBeNull()
    expect(scaleWeightTargetError({ soldByWeight: true, unitFactor: 1 })).toBeNull()
  })

  it('سطر بوحدة أكبر (كرتونة) يُرفض — كميته عدد لا كيلوجرامات', () => {
    expect(scaleWeightTargetError({ soldByWeight: true, unitFactor: 6, unitLabel: 'كرتونة' })).toContain('كرتونة')
  })

  it('سطر صنف بالعدد يُرفض، وبلا سطر رسالة اختيار', () => {
    expect(scaleWeightTargetError({ soldByWeight: false })).toContain('بالوزن')
    expect(scaleWeightTargetError(null)).toContain('اختر سطراً')
  })
})
