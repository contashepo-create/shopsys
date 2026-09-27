import { describe, expect, it } from 'vitest'
import { normalizeLegacyDocumentMeta, validateCommercialDocumentMeta, type CommercialDocumentMeta } from '../src/core/commercialDocument.ts'

const valid: CommercialDocumentMeta = {
  status: 'draft', documentDate: '2026-09-22', postedAt: null, dueDate: '2026-10-22',
  externalReference: null, notes: '', createdBy: 'المالك', createdAt: '2026-09-22T08:00:00.000Z',
  approvedBy: null, approvedAt: null, postedBy: null, idempotencyKey: 'sale_01K5ABCD1234567890',
}

describe('بيانات المستند التجاري المشتركة', () => {
  it('تقبل مسودة سليمة مستقلة عن التخزين', () => {
    expect(validateCommercialDocumentMeta(valid)).toEqual([])
  })

  it('ترفض استحقاقاً قبل المستند ومفتاح تكرار ضعيفاً', () => {
    const errors = validateCommercialDocumentMeta({ ...valid, dueDate: '2026-01-01', idempotencyKey: 'short' })
    expect(errors).toContain('تاريخ الاستحقاق يسبق تاريخ المستند')
    expect(errors).toContain('مفتاح منع التكرار غير صالح')
  })

  it('يلزم بيانات الاعتماد والترحيل بحسب الحالة', () => {
    expect(validateCommercialDocumentMeta({ ...valid, status: 'approved' })).toContain('المستند المعتمد يحتاج اسم ووقت الاعتماد')
    expect(validateCommercialDocumentMeta({ ...valid, status: 'posted' })).toContain('المستند المرحّل يحتاج اسم ووقت الترحيل')
  })

  it('يقرأ الفاتورة القديمة ذات القيد كمستند مرحل دون تغيير سجلها', () => {
    const meta = normalizeLegacyDocumentMeta(
      { date: '2025-04-03T11:20:00.000Z', journalEntryId: 44, createdBy: 'أحمد' },
      { kind: 'sale', id: 7 },
    )
    expect(meta.status).toBe('posted')
    expect(meta.postedBy).toBe('أحمد')
    expect(meta.postedAt).toBe('2025-04-03T00:00:00.000Z')
    expect(meta.idempotencyKey).toBe('legacy_sale_00000007')
    expect(validateCommercialDocumentMeta(meta)).toEqual([])
  })

  it('يبقي السجل القديم بلا قيد مسودة', () => {
    const meta = normalizeLegacyDocumentMeta({ date: '2026-09-22' }, { kind: 'purchase', id: 12 })
    expect(meta.status).toBe('draft')
    expect(meta.postedAt).toBeNull()
    expect(meta.postedBy).toBeNull()
  })
})
