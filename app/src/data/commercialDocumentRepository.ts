import type { CommercialDocumentAuditEvent, CommercialDocumentMeta } from '../core/commercialDocument.ts'

/**
 * عقد التخزين لمنظومة المستندات. واجهة UI/domain لا تعرف هل التنفيذ الحالي مؤقت
 * أم SQLite؛ تنفيذ Desktop يجب أن ينجز transact كوحدة ذرية واحدة.
 */
export interface CommercialDocumentRecord<TPayload> {
  kind: string
  id: number
  number: string
  meta: CommercialDocumentMeta
  payload: TPayload
}

export interface AtomicDocumentMutation<TDocument, TState = unknown> {
  document: TDocument
  auditEvent: CommercialDocumentAuditEvent
  /** لقطة تغيرات المخزون/القيد التي يجب أن تحفظ مع المستند أو لا يحفظ شيء. */
  stateChanges: TState
}

export type AtomicWriteResult<TDocument> =
  | { outcome: 'created'; document: TDocument }
  | { outcome: 'duplicate'; document: TDocument }

export interface CommercialDocumentRepository {
  findById<TPayload>(kind: string, id: number): Promise<CommercialDocumentRecord<TPayload> | null>
  findByIdempotencyKey<TPayload>(key: string): Promise<CommercialDocumentRecord<TPayload> | null>
  /** يجب فرض UNIQUE(idempotency_key) داخل SQLite، لا بفحص ذاكرة قابل للسباق. */
  transact<TDocument, TState>(mutation: AtomicDocumentMutation<TDocument, TState>): Promise<AtomicWriteResult<TDocument>>
}
