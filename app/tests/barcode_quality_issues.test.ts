import { describe, expect, it } from 'vitest'
import { barcodeIssues, normalizeBarcode } from '../src/core/items.ts'
import { ean13CheckDigit } from '../src/core/barcode.ts'

/**
 * فحص جودة باركودات البيانات القائمة (مركز الباركود):
 * يكشف ما لا يُمسح أصلاً (أرقام عربية/محارف مخفية) وما يعني رقماً منقولاً خطأً
 * (خانة تحقق EAN/UPC)، ويترك الأكواد السليمة بلا ملاحظات.
 */
const validEan = (body: string) => body + String(ean13CheckDigit(body))

const item = (over: Partial<{ id: number; nameAr: string; barcodes: string[]; extraUnits: { nameAr: string; barcode: string; factor: number }[] }>) => ({
  id: 1,
  nameAr: 'صنف',
  barcodes: [] as string[],
  extraUnits: [] as { nameAr: string; barcode: string; factor: number }[],
  ...over,
})

describe('فحص جودة الباركود', () => {
  it('باركود بأرقام عربية يُصنَّف «غير مطبَّع» ومعه التصحيح المقترح', () => {
    const issues = barcodeIssues([item({ barcodes: ['٦٢٨١٠٠٠٠١٢٣٤٥'] })])
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ field: 'item', kind: 'arabic' })
    expect(issues[0].message).toContain(normalizeBarcode('٦٢٨١٠٠٠٠١٢٣٤٥'))
  })

  it('خانة تحقق EAN-13 خاطئة تُصنَّف «check»', () => {
    const good = validEan('628100001234')
    const bad = good.slice(0, 12) + String((Number(good[12]) + 1) % 10)
    const issues = barcodeIssues([item({ barcodes: [bad] })])
    expect(issues).toHaveLength(1)
    expect(issues[0].kind).toBe('check')
  })

  it('باركود سليم داخلي (لا يتبع EAN) لا يُلوّث التقرير', () => {
    expect(barcodeIssues([item({ barcodes: ['SKU-42', validEan('628100001234')] })])).toEqual([])
  })

  it('باركود وحدة (كرتونة/دستة) يُفحص ويُسمّى بالوحدة', () => {
    const issues = barcodeIssues([
      item({ barcodes: [validEan('628100001234')], extraUnits: [{ nameAr: 'كرتونة', barcode: '٦٢٨١٠٠٠٠١٢٣٤٥', factor: 12 }] }),
    ])
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ field: 'unit', unitName: 'كرتونة', kind: 'arabic' })
  })

  it('الباركود الفارغ/المسافات لا يُنتج ملاحظة', () => {
    expect(barcodeIssues([item({ barcodes: ['', '   '], extraUnits: [{ nameAr: 'علبة', barcode: '', factor: 6 }] })])).toEqual([])
  })
})
