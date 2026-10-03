/**
 * نظام اعتماد المستندات قبل الترحيل (طلب المالك).
 *
 * القاعدة المحاسبية الحاكمة: **لا قيد قبل الاعتماد**. المستند المعلَّق لا يمسّ
 * الدفتر ولا المخزون؛ يبقى طلباً حتى يعتمده صاحب صلاحية، فيُرحَّل عندها بقيده
 * الكامل. الإلغاء لا يترك أثراً محاسبياً إطلاقاً.
 *
 * التحكم كله من قسم الصلاحيات:
 *   - `docs.approve`      : يعتمد مستندات الآخرين.
 *   - `docs.autoApproved` : مستنداته معتمدة تلقائياً ويتجاوز النظام ولو كان مفعّلاً.
 */
import type { Minor } from './money.ts'

export type ApprovalDocKind = 'sale' | 'purchase' | 'receipt' | 'payment' | 'sale_return' | 'purchase_return'
export type DocApprovalStatus = 'pending' | 'approved' | 'rejected'

/** كل أنواع المستندات الخاضعة للاعتماد — تستخدمها شاشة الإعدادات */
export const APPROVAL_DOC_KINDS: ApprovalDocKind[] = ['sale', 'purchase', 'receipt', 'payment', 'sale_return', 'purchase_return']

export const APPROVAL_DOC_LABELS: Record<ApprovalDocKind, string> = {
  sale: 'فاتورة مبيعات',
  purchase: 'فاتورة مشتريات',
  receipt: 'سند قبض',
  payment: 'سند صرف',
  sale_return: 'مرتجع مبيعات',
  purchase_return: 'مرتجع مشتريات',
}

export interface ApprovalSettings {
  /** تشغيل/إيقاف النظام كله — عند الإيقاف يُرحَّل كل شيء فوراً */
  enabled: boolean
  /** أنواع المستندات الخاضعة للاعتماد */
  scope: ApprovalDocKind[]
  /** لا يحتاج اعتماداً إلا فوق هذا المبلغ (0 = كل المستندات) */
  thresholdMinor: Minor
  /** معرّفات المستخدمين المخوَّلين بالاعتماد (إضافة إلى صلاحية docs.approve) */
  approverUserIds: number[]
  /** معرّفات مستخدمين مستنداتهم معتمدة تلقائياً (تجاوز صريح) */
  autoApprovedUserIds: number[]
}

export const DEFAULT_APPROVALS: ApprovalSettings = {
  enabled: false,
  scope: ['sale', 'purchase', 'receipt', 'payment'],
  thresholdMinor: 0,
  approverUserIds: [],
  autoApprovedUserIds: [],
}

export interface DocApprovalRequest {
  id: number
  kind: ApprovalDocKind
  /** ملخص المستند المعروض في قائمة الطلبات */
  title: string
  partyName: string
  amountMinor: Minor
  /** حمولة المستند كاملة — تُرحَّل كما هي بعد الاعتماد */
  payload: string
  requestedBy: number | null
  requestedByName: string
  requestedAt: string
  status: DocApprovalStatus
  decidedBy?: number | null
  decidedByName?: string
  decidedAt?: string
  /** سبب الرفض — إلزامي عند الرفض */
  reason?: string
  /** رقم المستند بعد الترحيل الفعلي */
  postedDocumentId?: number | null
  /** مرجع المستند المرحَّل (رقم الفاتورة/السند) للعرض في سجل الطلبات */
  postedDocumentRef?: string | null
}

/** هل يحتاج هذا المستند اعتماداً قبل الترحيل؟ */
export function needsApproval(args: {
  settings: ApprovalSettings
  kind: ApprovalDocKind
  amountMinor: Minor
  userId: number | null
  userPermissions: Set<string>
}): boolean {
  const { settings, kind, amountMinor, userId, userPermissions } = args
  if (!settings.enabled) return false
  if (!settings.scope.includes(kind)) return false
  if (settings.thresholdMinor > 0 && amountMinor < settings.thresholdMinor) return false
  /* التجاوز الصريح: صلاحية «مستنداته معتمدة تلقائياً» أو قائمة التجاوز */
  if (userPermissions.has('docs.autoApproved')) return false
  if (userId != null && settings.autoApprovedUserIds.includes(userId)) return false
  return true
}

/** هل يملك هذا المستخدم حق اعتماد الطلبات؟ */
export function canApprove(args: {
  settings: ApprovalSettings
  userId: number | null
  userPermissions: Set<string>
}): boolean {
  const { settings, userId, userPermissions } = args
  if (userPermissions.has('docs.approve')) return true
  return userId != null && settings.approverUserIds.includes(userId)
}

/** طلبات معلّقة تخص هذا المعتمِد (لا يعتمد المستخدم مستنده بنفسه إلا بصلاحية) */
export function pendingForUser(requests: DocApprovalRequest[], userId: number | null, selfApprove: boolean): DocApprovalRequest[] {
  return requests.filter((row) => row.status === 'pending' && (selfApprove || row.requestedBy !== userId))
}

export function validateApprovalDecision(args: { status: DocApprovalStatus; reason?: string }): string[] {
  const errors: string[] = []
  if (args.status === 'rejected' && !(args.reason ?? '').trim()) errors.push('سبب الرفض مطلوب')
  return errors
}
