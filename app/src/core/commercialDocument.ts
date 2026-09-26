import { isValidIdempotencyKey, type CommercialDocumentStatus } from './documentLifecycle.ts'

/** الحقول المشتركة لكل مستند بيع/شراء ومرتجع — قابلة للحفظ مباشرة في SQLite. */
export interface CommercialDocumentMeta {
  status: CommercialDocumentStatus
  documentDate: string
  postedAt: string | null
  dueDate: string | null
  externalReference: string | null
  notes: string
  createdBy: string
  createdAt: string
  approvedBy: string | null
  approvedAt: string | null
  postedBy: string | null
  idempotencyKey: string
}

/** سجلات قديمة قبل دورة الحياة؛ وجود قيد يعني أنها مرحّلة وليست مسودة. */
export interface LegacyDocumentMetaInput {
  status?: CommercialDocumentStatus
  date: string
  journalEntryId?: number | null
  createdBy?: string | null
  createdAt?: string | null
  notes?: string | null
  externalReference?: string | null
  dueDate?: string | null
  approvedBy?: string | null
  approvedAt?: string | null
  postedBy?: string | null
  postedAt?: string | null
  idempotencyKey?: string | null
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

export function validateCommercialDocumentMeta(meta: CommercialDocumentMeta): string[] {
  const errors: string[] = []
  if (!ISO_DATE.test(meta.documentDate.slice(0, 10))) errors.push('تاريخ المستند غير صالح')
  if (meta.dueDate && !ISO_DATE.test(meta.dueDate)) errors.push('تاريخ الاستحقاق غير صالح')
  if (meta.dueDate && meta.dueDate < meta.documentDate.slice(0, 10)) errors.push('تاريخ الاستحقاق يسبق تاريخ المستند')
  if (!ISO_INSTANT.test(meta.createdAt)) errors.push('وقت إنشاء المستند غير صالح')
  if (!meta.createdBy.trim()) errors.push('منشئ المستند مطلوب')
  if (!isValidIdempotencyKey(meta.idempotencyKey)) errors.push('مفتاح منع التكرار غير صالح')

  if (meta.status === 'approved' && (!meta.approvedBy || !meta.approvedAt)) {
    errors.push('المستند المعتمد يحتاج اسم ووقت الاعتماد')
  }
  if (['posted', 'partially_reversed', 'reversed'].includes(meta.status) && (!meta.postedAt || !meta.postedBy)) {
    errors.push('المستند المرحّل يحتاج اسم ووقت الترحيل')
  }
  if (meta.status === 'draft' && meta.postedAt) errors.push('المسودة لا تحمل وقت ترحيل')
  return errors
}

/**
 * توافق خلفي للقراءة فقط. المفتاح القديم ثابت مشتق من نوع/معرف المستند، ولا يستخدم
 * لإنشاء مستند جديد. عند النقل إلى SQLite يُحفظ مرة واحدة في migration.
 */
export function normalizeLegacyDocumentMeta(
  legacy: LegacyDocumentMetaInput,
  identity: { kind: string; id: number },
): CommercialDocumentMeta {
  const date = legacy.date.slice(0, 10)
  const createdAt = legacy.createdAt && ISO_INSTANT.test(legacy.createdAt)
    ? legacy.createdAt
    : `${date}T00:00:00.000Z`
  const inferredStatus: CommercialDocumentStatus = legacy.status
    ?? (legacy.journalEntryId != null ? 'posted' : 'draft')
  const actor = legacy.createdBy?.trim() || 'ترحيل بيانات قديمة'
  const posted = ['posted', 'partially_reversed', 'reversed'].includes(inferredStatus)

  return {
    status: inferredStatus,
    documentDate: date,
    postedAt: posted ? (legacy.postedAt ?? createdAt) : null,
    dueDate: legacy.dueDate ?? null,
    externalReference: legacy.externalReference?.trim() || null,
    notes: legacy.notes ?? '',
    createdBy: actor,
    createdAt,
    approvedBy: legacy.approvedBy ?? null,
    approvedAt: legacy.approvedAt ?? null,
    postedBy: posted ? (legacy.postedBy?.trim() || actor) : null,
    idempotencyKey: legacy.idempotencyKey && isValidIdempotencyKey(legacy.idempotencyKey)
      ? legacy.idempotencyKey
      : `legacy_${identity.kind}_${identity.id.toString().padStart(8, '0')}`,
  }
}

export type CommercialDocumentAuditAction = 'created' | 'approved' | 'reopened' | 'posted' | 'partially_reversed' | 'reversed' | 'voided'

export interface CommercialDocumentAuditEvent {
  documentKind: string
  documentId: number
  action: CommercialDocumentAuditAction
  fromStatus: CommercialDocumentStatus | null
  toStatus: CommercialDocumentStatus
  actor: string
  occurredAt: string
  relatedDocumentKind: string | null
  relatedDocumentId: number | null
  reason: string | null
}
