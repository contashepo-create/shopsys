import { describe, expect, it } from 'vitest'
import { parseScaleFrame, splitScaleBuffer, webSerialAvailable } from '../src/core/scaleSerial.ts'
import { isReadingFresh, SCALE_READING_TTL_MS } from '../src/stores/scale.store.ts'
import { planInternalBarcodes, ean13CheckDigit, parseScaleBarcodeUniversal, DEFAULT_SCALE_RULES } from '../src/core/barcode.ts'
import { stockShortage } from '../src/core/pos.ts'

describe('قارئ الميزان المباشر — تفكيك سطور الأجهزة', () => {
  it('CAS/Mettler: ST,GS,+ 0.750kg', () => {
    expect(parseScaleFrame('ST,GS,+  0.750kg')).toEqual({ kg: 0.75, grams: 750, stable: true, raw: 'ST,GS,+  0.750kg' })
  })
  it('الجرام يُحوَّل لكيلوجرام', () => {
    expect(parseScaleFrame('US,GS,    750 g')?.kg).toBe(0.75)
    expect(parseScaleFrame('+750g')?.kg).toBe(0.75)
  })
  it('صيغة POS البسيطة والفواصل العشرية بالفاصلة', () => {
    expect(parseScaleFrame('0.750 kg')?.kg).toBe(0.75)
    expect(parseScaleFrame('1,250 kg')?.kg).toBe(1.25)
    expect(parseScaleFrame('WT:0.750')?.kg).toBe(0.75)
  })
  it('غير المستقر يُعلَّم ولا يُقبل في الكاشير', () => {
    expect(parseScaleFrame('US,NT,+ 0.750kg')?.stable).toBe(false)
    expect(parseScaleFrame('MOTION 0.750 kg')?.stable).toBe(false)
  })
  it('صفر/فارغ/رسائل خطأ لا تُنتج قراءة', () => {
    for (const line of ['', '0', '0.000 kg', 'ERR 04', 'OVERLOAD', 'PRICE 12.50', 'CAL']) {
      expect(parseScaleFrame(line), line).toBeNull()
    }
  })
  it('قراءة تالفة (99999 كجم) مرفوضة', () => {
    expect(parseScaleFrame('99999 kg')).toBeNull()
  })
  it('تفكيك تدفق مقطوع بين حزمتين', () => {
    const a = splitScaleBuffer('', 'ST,GS,+ 0.7')
    expect(a.lines).toEqual([])
    const b = splitScaleBuffer(a.rest, '50kg\r\nST,GS,+ 1.250kg\r\n')
    expect(b.lines).toEqual(['ST,GS,+ 0.750kg', 'ST,GS,+ 1.250kg'])
    expect(b.rest).toBe('')
  })
  it('دعم المتصفح يُكتشف بلا انفجار', () => {
    expect(webSerialAvailable(null)).toBe(false)
    expect(webSerialAvailable({ serial: {} })).toBe(true)
  })
  it('صلاحية القراءة 15 ثانية', () => {
    expect(isReadingFresh({ kg: 1, grams: 1000, stable: true, at: 1_000 }, 1_000 + SCALE_READING_TTL_MS)).toBe(true)
    expect(isReadingFresh({ kg: 1, grams: 1000, stable: true, at: 1_000 }, 1_001 + SCALE_READING_TTL_MS)).toBe(false)
    expect(isReadingFresh(null)).toBe(false)
  })
})

describe('تحذير الرصيد قبل الدفع', () => {
  it('لا تحذير داخل المتاح', () => {
    expect(stockShortage({ stockQty: 5, inCartQty: 2, addQty: 1, allowNegative: false })).toBeNull()
  })
  it('تحذير عند تجاوز المتاح مع بيان المطلوب/المتاح', () => {
    expect(stockShortage({ stockQty: 3, inCartQty: 2, addQty: 2, allowNegative: false })).toEqual({ needed: 4, available: 3 })
  })
  it('الأوزان الكسرية تُقارن بثلاث خانات (دقة الجرام)', () => {
    expect(stockShortage({ stockQty: 0.75, inCartQty: 0, addQty: 0.75, allowNegative: false })).toBeNull()
    expect(stockShortage({ stockQty: 0.75, inCartQty: 0, addQty: 0.751, allowNegative: false })).toEqual({ needed: 0.751, available: 0.75 })
  })
  it('إعداد السماح بالسالب والأصناف الخدمية يتجاوزان التحذير', () => {
    expect(stockShortage({ stockQty: 0, inCartQty: 0, addQty: 1, allowNegative: true })).toBeNull()
    expect(stockShortage({ stockQty: 0, inCartQty: 0, addQty: 1, allowNegative: false, isService: true })).toBeNull()
  })
})

describe('خطة توليد الباركود الداخلي دفعة واحدة', () => {
  const item = (id: number, over: Partial<{ sku: string; barcodes: string[]; isActive: boolean; extraUnits: { barcode?: string }[] }> = {}) => ({
    id, nameAr: `صنف ${id}`, sku: '', barcodes: [], isActive: true, ...over,
  })

  it('يولّد لمن لا باركود له ولا كود (حتى لو كان لكرتونته باركود) — ولا يكرر', () => {
    const plan = planInternalBarcodes([
      item(1),
      item(2, { sku: 'SKU-2' }),
      item(3, { barcodes: ['6281000000011'] }),
      item(4, { extraUnits: [{ barcode: '6281000000028' }] }),
      item(5),
      item(6, { isActive: false }),
    ])
    expect(plan.map((p) => p.id)).toEqual([1, 4, 5])
    expect(new Set(plan.map((p) => p.code)).size).toBe(3)
    for (const row of plan) {
      expect(row.code).toHaveLength(13)
      expect(ean13CheckDigit(row.code.slice(0, 12))).toBe(Number(row.code[12]))
    }
  })

  it('لا يولّد كوداً يفسّره الميزان كملصق', () => {
    const priceRule = { ...DEFAULT_SCALE_RULES[0], id: 9, prefix: '20', valueType: 'price' as const }
    const plan = planInternalBarcodes([item(1), item(2)], [priceRule])
    for (const row of plan) expect(parseScaleBarcodeUniversal(row.code, [priceRule])).toBeNull()
  })
})
