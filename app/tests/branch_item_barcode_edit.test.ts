import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

const { useRawDataStore } = await import('../src/data/repo.ts')

/**
 * سلسلة بقالة: نفس باركود المصنع (EAN) يتكرر في كل فرع طبيعياً.
 * كان تعديل بطاقة الصنف في فرع يُرفض لأن الفحص يقارن بأصناف كل الفروع،
 * بينما الإضافة تُفحص داخل الفرع فقط — تناقض يجمّد بطاقات الفروع.
 */

const item = (id: number, nameAr: string, barcode: string, branchId: number) => ({
  id, nameAr, sku: `SKU-${id}`, barcodes: [barcode], categoryId: 1, branchId,
  baseUnit: 'قطعة', extraUnits: [], costMinor: 100, stockQty: 5, priceMinor: 150, minQty: 0,
  trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false,
  variantColors: [], variantSizes: [], isActive: true,
})

beforeEach(() => {
  const s = useRawDataStore.getState()
  useRawDataStore.setState({
    ...s,
    branches: [
      { id: 1, nameAr: 'الفرع الرئيسي', isMain: true, active: true } as never,
      { id: 2, nameAr: 'فرع الشمال', isMain: false, active: true } as never,
    ],
    items: [
      item(9001, 'مياه فرع 1', '6281000123456', 1),
      item(9002, 'مياه فرع 2', '6281000123456', 2),
      item(9003, 'أرز فرع 1 (أ)', '6281000999999', 1),
      item(9004, 'أرز فرع 1 (ب)', '6281000999999', 1),
    ] as never,
  })
  // النطاق الفعلي للمستودع يُقرأ من activeBranchId (وليس من سياق الواجهة)
  useRawDataStore.getState().setActiveBranchId(1)
})

afterAll(() => useRawDataStore.getState().setActiveBranchId(null))

describe('تعديل صنف في فرع مع تكرار الباركود بين الفروع', () => {
  it('نفس الباركود في فرع آخر لا يمنع تعديل البطاقة', () => {
        expect(() => useRawDataStore.getState().updateItem(9001, { nameAr: 'مياه فرع 1 — معدل' })).not.toThrow()
    expect(useRawDataStore.getState().items.find((it) => it.id === 9001)?.nameAr).toBe('مياه فرع 1 — معدل')
  })

  it('التكرار داخل الفرع نفسه ما زال مرفوضاً (حارس البيع الخاطئ)', () => {
        expect(() => useRawDataStore.getState().updateItem(9003, { nameAr: 'أرز معدل' })).toThrow(/مستخدم في صنف آخر/)
  })

  it('وضع «كل الفروع» يحتفظ بالحماية الشاملة', () => {
    useRawDataStore.getState().setActiveBranchId(null)
    expect(() => useRawDataStore.getState().updateItem(9001, { nameAr: 'مياه معدلة' })).toThrow(/مستخدم في صنف آخر/)
  })
})
