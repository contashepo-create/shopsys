import { describe, expect, it } from 'vitest'
import { resolveReturnLineScan, RETURN_SCAN_ERROR_TEXT } from '../src/ui/pages/returnLineScan.ts'
import { DEFAULT_SCALE_RULES, ean13CheckDigit } from '../src/core/barcode.ts'
import { buildReturnLines, buildReturnLinesPerLine, type ReturnLine } from '../src/core/returns.ts'

/**
 * مسح الباركود/ملصق الميزان داخل مرتجع البيع:
 * يحدد السطر ولا يضيف سطراً — والكمية من الملصق مقصوصة على المتبقي.
 */

const items = [
  { id: 1, nameAr: 'جبنة رومي', sku: 'CHE-42', barcodes: [], soldByWeight: true },
  { id: 2, nameAr: 'أرز مصري 1كجم', sku: 'RIC-7', barcodes: ['2000042007501'] },
  { id: 3, nameAr: 'مياه 600مل', sku: 'WAT-3', barcodes: [], units: [{ barcode: '2100042007509' }] },
]

const scaleLabel = (plu: number, grams: number) => {
  const body = `22${String(plu).padStart(5, '0')}${String(grams).padStart(5, '0')}`
  return `${body}${ean13CheckDigit(body)}`
}

/** سطور فاتورة: الجبنة 0.750كجم والأرز قطعة والمياه 6 قطع */
const lines = [
  { itemId: 1, qty: 0.75 },
  { itemId: 2, qty: 1 },
  { itemId: 3, qty: 6 },
]

const base = { lines, items, rules: DEFAULT_SCALE_RULES }

describe('ماسح سطور المرتجع', () => {
  it('ملصق ميزان يحدد سطر الصنف الموزون بوزنه لا بقطعة', () => {
    const out = resolveReturnLineScan({ ...base, code: scaleLabel(42, 750), remaining: [0.75, 1, 6] })
    expect(out).toMatchObject({ hit: { index: 0, qty: 0.75, kind: 'scale' } })
    expect('hit' in out && out.hit.label).toContain('جبنة رومي')
  })

  it('الوزن المطبوع يُقصّ على المتبقي القابل للإرجاع', () => {
    // سبق إرجاع 0.5كجم ⇒ المتبقي 0.25 فقط
    const out = resolveReturnLineScan({ ...base, code: scaleLabel(42, 750), remaining: [0.25, 1, 6] })
    expect(out).toMatchObject({ hit: { index: 0, qty: 0.25 } })
  })

  it('باركود الصنف يحدد سطره بكمية قطعة واحدة', () => {
    const out = resolveReturnLineScan({ ...base, code: '2000042007501', remaining: [0.75, 1, 6] })
    expect(out).toMatchObject({ hit: { index: 1, qty: 1, kind: 'barcode' } })
  })

  it('باركود الوحدة (علبة/كرتونة) يصل إلى سطر الصنف نفسه', () => {
    const out = resolveReturnLineScan({ ...base, code: '2100042007509', remaining: [0.75, 1, 6] })
    expect(out).toMatchObject({ hit: { index: 2, qty: 1 } })
  })

  it('SKU الممسوح يحدد السطر (أصناف بلا باركود)', () => {
    const out = resolveReturnLineScan({ ...base, code: 'RIC-7', remaining: [0.75, 1, 6] })
    expect(out).toMatchObject({ hit: { index: 1, qty: 1, kind: 'sku' } })
  })

  it('صنف ليس في الفاتورة يُرفض ولا يُضاف سطر', () => {
    const out = resolveReturnLineScan({
      ...base,
      items: [...items, { id: 9, nameAr: 'شاي', sku: 'TEA-9', barcodes: ['2000000000017'] }],
      code: '2000000000017',
      remaining: [0.75, 1, 6],
    })
    expect(out).toEqual({ error: 'not_in_invoice' })
    expect(RETURN_SCAN_ERROR_TEXT.not_in_invoice).toContain('ليس في الفاتورة')
  })

  it('سطر استُنفد رصيده يُرفض ولا كمية سالبة', () => {
    const out = resolveReturnLineScan({ ...base, code: scaleLabel(42, 750), remaining: [0, 1, 6] })
    expect(out).toEqual({ error: 'no_remaining' })
  })

  it('ملصق لصنف يُباع بالعدد لا يُحوَّل إلى وزن ولا يحدد سطراً خاطئاً', () => {
    const out = resolveReturnLineScan({ ...base, code: scaleLabel(7, 500), remaining: [0.75, 1, 6] })
    expect('error' in out).toBe(true)
  })

  it('مسح فارغ لا يفعل شيئاً', () => {
    expect(resolveReturnLineScan({ ...base, code: '   ', remaining: [0.75, 1, 6] })).toEqual({ error: 'empty' })
  })

  it('أرقام عربية في الملصق تُطبَّع قبل القراءة', () => {
    const arabic = scaleLabel(42, 250).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)])
    const out = resolveReturnLineScan({ ...base, code: arabic, remaining: [0.75, 1, 6] })
    expect(out).toMatchObject({ hit: { index: 0, qty: 0.25 } })
  })

  it('السطر الأول المستحق يُختار عند تكرار الصنف في الفاتورة', () => {
    const repeated = [
      { itemId: 2, qty: 1 },
      { itemId: 2, qty: 1 },
    ]
    const out = resolveReturnLineScan({ ...base, lines: repeated, code: '2000042007501', remaining: [0, 1] })
    expect(out).toMatchObject({ hit: { index: 1, qty: 1 } })
  })
})

/* ─── مراجعة صارمة (2026-11-17): سطر بسعر ملصق ثابت يُرجَع على أجزاء ─── */
describe('حصة سعر السطر المثبَّت عند الإرجاع المجزأ', () => {
  const labelLine = {
    key: 'k1', itemId: 1, nameAr: 'عرض 3 بـ10', qty: 3, unitPriceMinor: 3400, unitCostMinor: 1000,
    discountPercent: 0, soldByWeight: false, ...{ lineTotalOverrideMinor: 10000, costTotalMinor: 3000 },
  } as never

  it('ثلاثة مرتجعات بجزء واحد تجمع 10.00 و3.00 بالقرش بلا قرش ضائع', () => {
    let prior: ReturnLine[] = []
    let overrideSum = 0
    let costSum = 0
    for (let i = 0; i < 3; i++) {
      const out = buildReturnLinesPerLine([labelLine] as never, prior, [{ lineIndex: 0, qty: 1, condition: 'resellable' }])
      overrideSum += out[0].lineTotalOverrideMinor ?? 0
      costSum += out[0].costTotalMinor ?? 0
      prior = [...prior, ...out]
    }
    expect(overrideSum).toBe(10000)
    expect(costSum).toBe(3000)
  })

  it('المسار القديم (تجميع بالصنف) يحمل الحصة نفسها لا كامل الملصق', () => {
    const first = buildReturnLines([labelLine] as never, [], new Map([[1, 1]]))
    expect(first[0].lineTotalOverrideMinor).toBe(3333)
    const second = buildReturnLines([labelLine] as never, [{ itemId: 1, qty: 1 } as never], new Map([[1, 1]]))
    expect(second[0].lineTotalOverrideMinor).toBe(3334)
    expect(second[0].costTotalMinor).toBe(1000)
  })
})
