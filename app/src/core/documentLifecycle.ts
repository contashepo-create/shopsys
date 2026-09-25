/**
 * دورة حياة موحدة للمستندات التجارية.
 *
 * هذا الملف نواة domain خالصة بلا localStorage أو شبكة، لتعمل القواعد نفسها الآن
 * وفي Repository/SQLite لاحقاً داخل معاملة ذرية واحدة.
 */
export type CommercialDocumentStatus =
  | 'draft'
  | 'approved'
  | 'posted'
  | 'partially_reversed'
  | 'reversed'
  | 'voided'

export type CommercialDocumentAction =
  | 'approve'
  | 'reopen'
  | 'post'
  | 'record_partial_reversal'
  | 'record_full_reversal'
  | 'void'

export interface DocumentLifecycleContext {
  /** مستند مرحّل لا يُلغى صامتاً؛ يجب عكسه بمستند مرتبط. */
  hasPostedEffects?: boolean
  /** يوجد مستند عكسي جزئي واحد على الأقل. */
  hasPartialReversal?: boolean
  /** يوجد مستند عكسي يغطي كامل الأصل. */
  hasFullReversal?: boolean
}

export class InvalidDocumentTransitionError extends Error {
  readonly code = 'INVALID_DOCUMENT_TRANSITION'
  readonly status: CommercialDocumentStatus
  readonly action: CommercialDocumentAction

  constructor(status: CommercialDocumentStatus, action: CommercialDocumentAction, message: string) {
    super(message)
    this.name = 'InvalidDocumentTransitionError'
    this.status = status
    this.action = action
  }
}

const transitions: Record<CommercialDocumentStatus, Partial<Record<CommercialDocumentAction, CommercialDocumentStatus>>> = {
  draft: { approve: 'approved', void: 'voided' },
  approved: { reopen: 'draft', post: 'posted', void: 'voided' },
  posted: { record_partial_reversal: 'partially_reversed', record_full_reversal: 'reversed' },
  partially_reversed: { record_partial_reversal: 'partially_reversed', record_full_reversal: 'reversed' },
  reversed: {},
  voided: {},
}

/**
 * يحسب الحالة التالية فقط؛ الحفظ الفعلي مسؤولية Repository ومعاملة SQLite لاحقاً.
 * لا توجد انتقالات حذف/تعديل لمستند مرحّل.
 */
export function transitionDocument(
  status: CommercialDocumentStatus,
  action: CommercialDocumentAction,
  context: DocumentLifecycleContext = {},
): CommercialDocumentStatus {
  if (action === 'void' && (context.hasPostedEffects || status === 'posted' || status === 'partially_reversed')) {
    throw new InvalidDocumentTransitionError(status, action, 'لا يمكن إلغاء مستند ذي آثار مرحّلة — أنشئ مستنداً عكسياً مرتبطاً')
  }
  if (action === 'record_partial_reversal' && !context.hasPartialReversal) {
    throw new InvalidDocumentTransitionError(status, action, 'لا يمكن تسجيل عكس جزئي دون مستند عكسي مرتبط')
  }
  if (action === 'record_full_reversal' && !context.hasFullReversal) {
    throw new InvalidDocumentTransitionError(status, action, 'لا يمكن تسجيل العكس الكامل دون مستند عكسي يغطي الأصل')
  }

  const next = transitions[status][action]
  if (!next) {
    throw new InvalidDocumentTransitionError(status, action, `الانتقال «${action}» غير مسموح من حالة «${status}»`)
  }
  return next
}

export function isDocumentEditable(status: CommercialDocumentStatus): boolean {
  return status === 'draft'
}

export function isDocumentTerminal(status: CommercialDocumentStatus): boolean {
  return status === 'reversed' || status === 'voided'
}

/** مفتاح منع الترحيل المزدوج؛ يولده التطبيق مرة ويحفظه مع المستند محلياً. */
export function isValidIdempotencyKey(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{15,127}$/.test(value)
}
