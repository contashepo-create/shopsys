import { describe, it, expect } from 'vitest'
import {
  normalizeBarcode, normalizeBarcodes, barcodeCheckWarning, itemBlockers, validateItem,
  type Item, type ItemDraft,
} from '../src/core/items.ts'
import {
  DEFAULT_SCALE_RULES, parseWithRule, parseScaleBarcodeUniversal, matchScaleItem, validateScaleRule,
  buildPluRows, scaleRuleConflicts, ean13CheckDigit, nextInternalBarcode, type ScaleRule,
} from '../src/core/barcode.ts'
import { barcodeSvg } from '../src/core/code128.ts'

/**
 * جولة جاهزية البقالة — باركود التسجيل/القراءة والميزان:
 * كل حالة هنا عيب حقيقي أُصلح (أو حارس يمنع رجوعه)، لا عينة شكلية.
 */

const baseItem = (over: Partial<Item>): Item => ({
  id: 1, nameAr: 'صنف', sku: 'ITM-1', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [],
  costMinor: 100, stockQty: 10, priceMinor: 200, minQty: 0, trackExpiry: false, trackSerial: false,
  warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true, ...over,
})

const baseDraft = (over: Partial<ItemDraft>): ItemDraft => {
  const { id, ...rest } = baseItem({})
  void id
  return { ...rest, ...over } as ItemDraft
}

describe('تطبيع الباركود عند التسجيل والقراءة', () => {
  it('أرقام عربية/فارسية وفراغات غير مرئية ← باركود لاتيني واحد', () => {
    expect(normalizeBarcode('٦٢٢١٠٠')).toBe('622100')
    expect(normalizeBarcode(' ۶۲۲۱۰۰ ')).toBe('622100')
    expect(normalizeBarcode('622\u200f100\n')).toBe('622100')
    expect(normalizeBarcode('')).toBe('')
    expect(normalizeBarcode(null)).toBe('')
    // الشرطات والمسافة الداخلية تبقى: Code128 قد يحملهما فعلاً
    expect(normalizeBarcode('ITM-10 42')).toBe('ITM-10 42')
  })

  it('باركود عربي مسجل = نفس الباركود اللاتيني في منع التكرار', () => {
    const existing = [baseItem({ id: 7, nameAr: 'مياه', barcodes: ['622100'] })]
    const blockers = itemBlockers(baseDraft({ nameAr: 'مياه أخرى', barcodes: ['٦٢٢١٠٠'] }), existing)
    expect(blockers.join(' ')).toContain('مستخدم في صنف آخر')
    expect(validateItem(baseDraft({ nameAr: 'مياه أخرى', barcodes: ['٦٢٢١٠٠'] }), existing).join(' ')).toContain('مستخدم في صنف آخر')
  })

  it('باركود وحدة عربي يُطابق باركود وحدة لاتيني في صنف آخر', () => {
    const existing = [baseItem({ id: 7, nameAr: 'أرز', barcodes: [], extraUnits: [{ nameAr: 'كرتونة', factor: 12, barcode: '622900' }] })]
    const blockers = itemBlockers(baseDraft({ nameAr: 'أرز آخر', barcodes: [], extraUnits: [{ nameAr: 'كرتونة', factor: 6, barcode: '٦٢٢٩٠٠' }] }), existing)
    expect(blockers.join(' ')).toContain('باركود الوحدة')
  })

  it('تنظيف المصفوفة وإسقاط الفراغات', () => {
    expect(normalizeBarcodes([' ٦٢٢ ', '', '  '])).toEqual(['622'])
  })
})

describe('تحذير خانة تحقق EAN/UPC عند التسجيل', () => {
  it('EAN-13 صحيح لا تحذير، وخانة خاطئة تحذير', () => {
    expect(barcodeCheckWarning('6291041500213')).toBeNull()
    expect(barcodeCheckWarning('4006381333931')).toBeNull()
    expect(barcodeCheckWarning('4006381333932')).toContain('خانة التحقق')
  })
  it('UPC-A صحيح لا تحذير', () => {
    // 036000291452 مثال UPC-A معياري
    expect(barcodeCheckWarning('036000291452')).toBeNull()
  })
  it('الأكواد الداخلية القصيرة/الحرفية لا تُحذَّر', () => {
    expect(barcodeCheckWarning('42')).toBeNull()
    expect(barcodeCheckWarning('ITM-1042')).toBeNull()
  })
})

describe('قواعد الميزان — الوزن والحدود', () => {
  const weight = { ...DEFAULT_SCALE_RULES[0], id: 1, enabled: true } as ScaleRule

  it('قاعدة وزن بأربع كسور مرفوضة (الكاشير يخزّن 3 خانات فقط)', () => {
    expect(validateScaleRule({ ...weight, valueDecimals: 4 }).join(' ')).toContain('3 كسور')
    expect(validateScaleRule({ ...weight, valueDecimals: 3 })).toEqual([])
  })

  it('قاعدة سعر بأربع كسور تبقى مقبولة', () => {
    const price = { ...weight, valueType: 'price' as const, valueDecimals: 4 }
    expect(validateScaleRule(price).filter((e) => e.includes('كسور'))).toEqual([])
  })

  it('الوزن يُقرَّب إلى جرامات عند التفكيك', () => {
    const dec4 = { ...weight, valueDecimals: 4 }
    // 00075 بعشرات الألف من الكيلو = 0.0075 كجم ← 0.008 بعد التقريب
    const hit = parseWithRule('220004200075', dec4)
    expect(hit?.weightKg).toBe(0.008)
  })

  it('باركود بوزن يتقرّب إلى صفر يُرفض بدل كمية صفرية', () => {
    const dec4 = { ...weight, valueDecimals: 4 }
    expect(parseWithRule('220004200001', dec4)).toBeNull()
  })
})

describe('مطابقة صنف الميزان', () => {
  const weighted = { id: 1, nameAr: 'جبنة', sku: 'CHE-42', barcodes: [], soldByWeight: true }
  const counted = { id: 2, nameAr: 'علبة', sku: 'BOX-42', barcodes: ['42'], soldByWeight: false }

  it('قاعدة الوزن لا تطابق صنفاً يُباع بالعدد ولو تطابق كوده', () => {
    expect(matchScaleItem('42', [counted, weighted])?.id).toBe(2)
    expect(matchScaleItem('42', [counted, weighted], { requireWeighted: true })?.id).toBe(1)
    expect(matchScaleItem('42', [counted], { requireWeighted: true })).toBeUndefined()
  })

  it('باركود غير رقمي لا يساوي كود صفر', () => {
    const badge = { id: 3, nameAr: 'شارة', sku: 'ABC', barcodes: ['ABC'], soldByWeight: false }
    expect(matchScaleItem('ABC', [badge], { requireWeighted: true })).toBeUndefined()
  })
})

describe('قائمة PLU', () => {
  it('وحدة غير الكيلوجرام تحذير صريح قبل برمجة الميزان', () => {
    const rows = buildPluRows([
      { nameAr: 'لحم', sku: 'MEAT-77', barcodes: [], priceMinor: 6000, soldByWeight: true, isActive: true, baseUnit: 'كجم' },
      { nameAr: 'بهارات', sku: 'SPICE-78', barcodes: [], priceMinor: 500, soldByWeight: true, isActive: true, baseUnit: 'جرام' },
    ], 5, 2)
    expect(rows[0].warning).toBeNull()
    expect(rows[1].warning).toContain('ليست كيلوجراماً')
  })

  it('تعارض قاعدتين بنفس البادئة والأطوال يُكشف', () => {
    const a: ScaleRule = { id: 1, nameAr: 'وزن 22', enabled: true, prefix: '22', itemCodeLen: 5, valueLen: 5, valueType: 'weight', valueDecimals: 3, checkDigit: 'auto' }
    const b: ScaleRule = { ...a, id: 2, nameAr: 'سعر 22', valueType: 'price', valueDecimals: 2 }
    const conflicts = scaleRuleConflicts([a, b])
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toContain('وزن/سعر')
    expect(scaleRuleConflicts([a, { ...b, enabled: false }])).toEqual([])
  })
})

describe('باركود الصنف المسجل يسبق تفكيك الميزان (ترتيب القرار في الكاشير)', () => {
  it('الرقم نفسه قد يكون باركود منتج وملصق ميزان — الكاشير يجب أن يضيف المنتج', () => {
    const productCode = '2200042007502'
    const rules = [DEFAULT_SCALE_RULES[0]]
    // نفس الرقم يفككه الميزان…
    expect(parseScaleBarcodeUniversal(productCode, rules)).not.toBeNull()
    // …لكن البحث بالباركود المسجل يجده أولاً. هذا يثبت خطر الاعتماد على التفكيك قبل التطابق،
    // والكاشير الآن يفحص التطابق التام أولاً (اختبار واجهة منفصل).
    expect(ean13CheckDigit('220004200750')).toBe(2)
  })
})

describe('باركود داخلي للأصناف بلا باركود مصنع', () => {
  it('EAN-13 صحيح ببادئة 2 وخانة تحقق سليمة', () => {
    const code = nextInternalBarcode([])
    expect(code).toHaveLength(13)
    expect(code.startsWith('200')).toBe(true)
    expect(ean13CheckDigit(code.slice(0, 12))).toBe(Number(code[12]))
    expect(barcodeCheckWarning(code)).toBeNull()
  })

  it('يتخطى الأكواد المسجلة والملصقات التي تفكّها قاعدة الميزان', () => {
    const first = nextInternalBarcode([])
    expect(nextInternalBarcode([first])).not.toBe(first)
    // كود صالح شكلاً لكنه ملصق ميزان بقاعدة 20 (سعر 5+5) يجب ألا يُولَّد
    const priceRule: ScaleRule = { id: 2, nameAr: 'سعر 200', enabled: true, prefix: '20', itemCodeLen: 5, valueLen: 5, valueType: 'price', valueDecimals: 2, checkDigit: 'auto' }
    const code = nextInternalBarcode([], '200', [priceRule])
    // الناتج الأول قد يقع داخل نطاق القاعدة، والدالة تتخطاه — المهم ألا يُفكّ
    expect(parseScaleBarcodeUniversal(code, [priceRule])).toBeNull()
  })
})

describe('مولد Code128 — هامش هدوء للطباعة', () => {
  it('أول شريط يبدأ بعد 10 وحدات هدوء لا من الحافة', () => {
    const svg = barcodeSvg('6281000123456', 40, 2)
    expect(svg).toContain('<rect x="20"')
    const width = Number(svg.match(/width="([\d.]+)"/)?.[1])
    const lastBar = [...svg.matchAll(/<rect x="([\d.]+)" y="0" width="([\d.]+)"/g)].at(-1)!
    expect(width - (Number(lastBar[1]) + Number(lastBar[2]))).toBeGreaterThanOrEqual(20)
  })
})
