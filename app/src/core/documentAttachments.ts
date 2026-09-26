const ALLOWED_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

export interface DocumentAttachmentMeta {
  id: string
  documentKind: string
  documentId: number
  fileName: string
  mimeType: string
  sizeBytes: number
  sha256: string
  localRelativePath: string
  createdBy: string
  createdAt: string
}

/** المرفق نفسه ملف محلي؛ قاعدة البيانات تحفظ metadata ومساراً نسبياً فقط. */
export function validateDocumentAttachment(meta: DocumentAttachmentMeta): string[] {
  const errors: string[] = []
  const name = meta.fileName.trim()
  if (!name || name.length > 180 || name.includes('/') || name.includes('\\') || Array.from(name).some((char) => char < ' ')) errors.push('اسم المرفق غير صالح')
  if (!ALLOWED_MIME.has(meta.mimeType)) errors.push('نوع المرفق غير مسموح')
  if (!Number.isInteger(meta.sizeBytes) || meta.sizeBytes <= 0 || meta.sizeBytes > MAX_ATTACHMENT_BYTES) errors.push('حجم المرفق غير مسموح')
  if (!/^[a-f0-9]{64}$/.test(meta.sha256)) errors.push('بصمة المرفق SHA-256 غير صالحة')
  if (!/^[A-Za-z0-9/_-]+\.[A-Za-z0-9]+$/.test(meta.localRelativePath) || meta.localRelativePath.includes('..')) errors.push('مسار المرفق المحلي غير آمن')
  if (!meta.createdBy.trim()) errors.push('منشئ المرفق مطلوب')
  return errors
}

export const DOCUMENT_ATTACHMENT_LIMIT_BYTES = MAX_ATTACHMENT_BYTES
