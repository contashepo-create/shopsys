import { describe, expect, it } from 'vitest'
import { DOCUMENT_ATTACHMENT_LIMIT_BYTES, validateDocumentAttachment } from '../src/core/documentAttachments.ts'

const valid = {
  id: 'att_01K5ABCD123456', documentKind: 'sale', documentId: 7, fileName: 'invoice.pdf',
  mimeType: 'application/pdf', sizeBytes: 2048, sha256: 'a'.repeat(64),
  localRelativePath: 'attachments/sale/7/att_01K5ABCD123456.pdf', createdBy: 'المالك', createdAt: '2026-09-22T09:00:00Z',
}

describe('مرفقات المستندات المحلية', () => {
  it('تقبل metadata آمنة دون تخزين blob في الحالة', () => expect(validateDocumentAttachment(valid)).toEqual([]))
  it('ترفض الامتداد التنفيذي والمسار المتجاوز للمجلد', () => {
    const errors = validateDocumentAttachment({ ...valid, mimeType: 'application/x-msdownload', localRelativePath: '../evil.exe' })
    expect(errors).toContain('نوع المرفق غير مسموح')
    expect(errors).toContain('مسار المرفق المحلي غير آمن')
  })
  it('تفرض حد عشرة ميجابايت', () => {
    expect(validateDocumentAttachment({ ...valid, sizeBytes: DOCUMENT_ATTACHMENT_LIMIT_BYTES + 1 })).toContain('حجم المرفق غير مسموح')
  })
  it('ترفض اسماً بمسار أو بصمة غير صحيحة', () => {
    const errors = validateDocumentAttachment({ ...valid, fileName: '../../secret.pdf', sha256: '123' })
    expect(errors).toContain('اسم المرفق غير صالح')
    expect(errors).toContain('بصمة المرفق SHA-256 غير صالحة')
  })
})
