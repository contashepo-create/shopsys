/**
 * سجل النشاطات (Audit Log) + التعقيم ضد الحقن — نواة خالصة (طلب المالك):
 *
 * ① سجل النشاطات: «من قام بكل شيء ومتى» — يُبنى تلقائياً من فروقات الحالة
 *    (قيود اليومية الجديدة + إضافة/حذف في السجلات الرئيسية) فلا يعتمد على
 *    تذكُّر المطوّر تسجيل كل إجراء يدوياً. يظهر فقط لدور «المالك».
 * ② حلقة محدودة: أقدم الأحداث تُحذف تلقائياً بعد AUDIT_MAX — لا انتفاخ للقاعدة.
 * ③ التعقيم: كل نص يدخل من المستخدم أو يصل من الخارج (بوت/ووركر) يمر عبر
 *    sanitizeText — إزالة محارف التحكم ووسوم HTML ومحارف الحقن، وقصّ الطول.
 */

import type { UserTreasuryAccess } from './treasuryAccess.ts'

export interface AuditEvent {
  id: number
  at: string // ISO
  user: string // من قام بالإجراء (اسم المستخدم النشط)
  kind: string // journal | add | remove | edit | auth | system
  title: string // وصف عربي جاهز للعرض
  refKey?: string // مرجع اختياري: sale:12 / entry:55 ...
}

/** الحد الأقصى للأحداث المحفوظة — حلقة: الأقدم يُحذف تلقائياً */
export const AUDIT_MAX = 3000

/* ─── التعقيم المركزي (ضد الحقن في الحقول والبوت) ─── */

/**
 * تعقيم نص وارد من مستخدم أو من الخارج:
 * - إزالة محارف التحكم (عدا سطر جديد وتاب)
 * - إزالة < و > (لا وسوم HTML/سكربت أبداً — النصوص تُعرض نصاً لا HTML)
 * - إزالة محارف العرض الخفية الخطرة (ZWSP/BOM/WordJoiner)
 * - قصّ الطول إلى maxLen
 */
export function sanitizeText(input: unknown, maxLen = 500): string {
  if (typeof input !== 'string') return ''
  return input
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .replace(/[<>]/g, '')
    .replace(/[\u200B\u2060\uFEFF]/g, '')
    .trim()
    .slice(0, maxLen)
}

/** معرف جهاز صالح للإرسال للووركر (لا نقبل أي شيء آخر في المسار) */
export function isValidDeviceId(id: string): boolean {
  return /^[A-Za-z0-9_-]{6,64}$/.test(id)
}

/* ─── بناء الأحداث من فروقات الحالة (قلب السجل التلقائي) ─── */

interface CollectionSpec {
  key: string
  labelAr: string
  nameField: string
  idField?: string // الافتراضي id
}

/**
 * السجلات التي تُرصد إضافتها/حذفها تلقائياً — (طلب المالك: كل تغيير يُسجَّل).
 * القيود المالية كلها مغطاة ببند القيود أعلاه؛ هذه القائمة تغطي السجلات
 * غير المالية في كل الأنشطة: مشاريع، عروض، مرضى، عقارات، عقود، مركبات…
 */
const WATCHED: CollectionSpec[] = [
  { key: 'items', labelAr: 'صنف', nameField: 'nameAr' },
  { key: 'categories', labelAr: 'قسم أصناف', nameField: 'nameAr' },
  { key: 'customers', labelAr: 'عميل', nameField: 'nameAr' },
  { key: 'suppliers', labelAr: 'مورد', nameField: 'nameAr' },
  { key: 'employees', labelAr: 'موظف', nameField: 'nameAr' },
  { key: 'treasuries', labelAr: 'خزينة/بنك', nameField: 'nameAr', idField: 'code' },
  { key: 'warehouses', labelAr: 'مخزن', nameField: 'nameAr' },
  { key: 'appUsers', labelAr: 'مستخدم', nameField: 'nameAr' },
  { key: 'issues', labelAr: 'بلاغ داخلي', nameField: 'title' },
  // المقاولات
  { key: 'projects', labelAr: 'مشروع مقاولات', nameField: 'nameAr' },
  { key: 'quotations', labelAr: 'عرض سعر/مناقصة', nameField: 'titleAr' },
  { key: 'boqItems', labelAr: 'بند جدول كميات', nameField: 'descriptionAr' },
  { key: 'subContracts', labelAr: 'عقد مقاول باطن', nameField: 'contractorName' },
  { key: 'changeOrders', labelAr: 'أمر تغيير', nameField: 'titleAr' },
  { key: 'projectTasks', labelAr: 'مهمة مشروع', nameField: 'nameAr' },
  // العقارات
  { key: 'properties', labelAr: 'عقار', nameField: 'nameAr' },
  { key: 'leases', labelAr: 'عقد إيجار عقاري', nameField: 'tenantName' },
  // الصحة والمعامل
  { key: 'labPatients', labelAr: 'مريض معمل', nameField: 'nameAr' },
  { key: 'labTests', labelAr: 'تحليل معمل', nameField: 'nameAr' },
  { key: 'labReferrers', labelAr: 'محيل معمل', nameField: 'nameAr' },
  { key: 'clinicPatients', labelAr: 'مريض عيادة', nameField: 'nameAr' },
  // اللوجستيات والتأجير والسيارات
  { key: 'vehicles', labelAr: 'مركبة', nameField: 'plateNumber' },
  { key: 'equipment', labelAr: 'معدة', nameField: 'nameAr' },
  { key: 'rentalContracts', labelAr: 'عقد تأجير معدة', nameField: 'contractNumber' },
  // التصنيع والوصفات وقوائم الأسعار
  { key: 'recipes', labelAr: 'وصفة إنتاج', nameField: 'nameAr' },
  { key: 'priceLists', labelAr: 'قائمة أسعار', nameField: 'nameAr' },
  // العهد
  { key: 'custodyFiles', labelAr: 'ملف عهدة', nameField: 'fileNumber' },
]

type AnyRec = Record<string, unknown>

/**
 * مقارنة الحالة السابقة بالرقعة الجديدة وإرجاع أحداث التدقيق:
 * - قيد يومية جديد ⇒ حدث بعنوان وصف القيد (يغطي كل العمليات المالية تلقائياً)
 * - إضافة/حذف في السجلات المراقبة ⇒ حدث إضافة/حذف بالاسم
 * - نمو editHistory في فاتورة ⇒ حدث «تعديل فاتورة»
 * دالة خالصة: لا تعرف zustand ولا localStorage.
 */
export function auditFromPatch(
  prev: AnyRec,
  patch: AnyRec,
  user: string,
  atIso: string,
): Omit<AuditEvent, 'id'>[] {
  const out: Omit<AuditEvent, 'id'>[] = []
  const u = sanitizeText(user, 60) || 'غير معروف'

  // ① قيود اليومية الجديدة — تغطي البيع والشراء والمرتجعات والسندات والرواتب...
  const prevJournal = Array.isArray(prev.journal) ? (prev.journal as AnyRec[]) : []
  const patchJournal = Array.isArray(patch.journal) ? (patch.journal as AnyRec[]) : null
  if (patchJournal && patchJournal !== prev.journal) {
    const known = new Set(prevJournal.map((e) => e.id))
    for (const e of patchJournal) {
      if (known.has(e.id)) continue
      out.push({
        at: atIso, user: u, kind: 'journal',
        title: sanitizeText(String(e.description ?? 'قيد'), 160),
        refKey: `entry:${e.id}`,
      })
    }
  }

  // ② إضافة/حذف في السجلات المراقبة
  for (const spec of WATCHED) {
    const before = Array.isArray(prev[spec.key]) ? (prev[spec.key] as AnyRec[]) : []
    const after = Array.isArray(patch[spec.key]) ? (patch[spec.key] as AnyRec[]) : null
    if (!after || after === prev[spec.key]) continue
    const idF = spec.idField ?? 'id'
    const beforeIds = new Set(before.map((r) => r[idF]))
    const afterIds = new Set(after.map((r) => r[idF]))
    for (const r of after) {
      if (!beforeIds.has(r[idF])) {
        out.push({ at: atIso, user: u, kind: 'add', title: `إضافة ${spec.labelAr}: ${sanitizeText(String(r[spec.nameField] ?? ''), 80)}` })
      }
    }
    for (const r of before) {
      if (!afterIds.has(r[idF])) {
        out.push({ at: atIso, user: u, kind: 'remove', title: `حذف ${spec.labelAr}: ${sanitizeText(String(r[spec.nameField] ?? ''), 80)}` })
      }
    }
  }

  // ③ تعديلات الفواتير (نمو editHistory) — للتوثيق الصريح بجانب قيد العكس
  for (const key of ['sales', 'purchases'] as const) {
    const before = Array.isArray(prev[key]) ? (prev[key] as AnyRec[]) : []
    const after = Array.isArray(patch[key]) ? (patch[key] as AnyRec[]) : null
    if (!after || after === prev[key]) continue
    const byId = new Map(before.map((r) => [r.id, r]))
    for (const r of after) {
      const old = byId.get(r.id)
      const oldLen = Array.isArray((old as AnyRec | undefined)?.editHistory) ? ((old as AnyRec).editHistory as unknown[]).length : 0
      const newLen = Array.isArray(r.editHistory) ? (r.editHistory as unknown[]).length : 0
      if (old && newLen > oldLen) {
        out.push({
          at: atIso, user: u, kind: 'edit',
          title: `تعديل ${key === 'sales' ? 'فاتورة بيع' : 'فاتورة شراء'} ${sanitizeText(String(r.invoiceNumber ?? ''), 30)}`,
          refKey: `${key === 'sales' ? 'sale' : 'purchase'}:${r.id}`,
        })
      }
    }
  }

  return out
}

/** إلحاق أحداث بالسجل مع ترقيم متسلسل وقص الحلقة عند AUDIT_MAX */
export function appendAudit(log: readonly AuditEvent[], events: readonly Omit<AuditEvent, 'id'>[], max = AUDIT_MAX): AuditEvent[] {
  if (!events.length) return log as AuditEvent[]
  let nextId = log.length ? Math.max(...log.map((e) => e.id)) + 1 : 1
  const merged = [...log, ...events.map((e) => ({ ...e, id: nextId++ }))]
  return merged.length > max ? merged.slice(merged.length - max) : merged
}

/* ─── البلاغات الداخلية (مستخدم فرعي → المدير/المحاسب) ─── */

export type IssueStatus = 'open' | 'in_progress' | 'resolved'

export interface IssueReport {
  id: number
  title: string
  details: string
  /** مرجع المستند محل المشكلة: sale:12 / purchase:5 / entry:80 / نص حر */
  refKey: string
  status: IssueStatus
  reportedBy: string
  reportedAt: string
  resolvedBy?: string
  resolvedAt?: string
  resolution?: string
}

export const ISSUE_STATUS_LABELS: Record<IssueStatus, { nameAr: string; icon: string }> = {
  open: { nameAr: 'مفتوح', icon: '🔴' },
  in_progress: { nameAr: 'قيد المعالجة', icon: '🟡' },
  resolved: { nameAr: 'تم الحل', icon: '🟢' },
}

/** تحقق مُدخلات البلاغ الداخلي — أخطاء عربية جاهزة */
export function validateIssue(input: { title: string; details: string }): string[] {
  const errors: string[] = []
  if (!sanitizeText(input.title, 120)) errors.push('عنوان المشكلة مطلوب')
  if (sanitizeText(input.details, 2000).length < 5) errors.push('اشرح المشكلة بجملة واحدة على الأقل')
  return errors
}

/* ─── المستخدمون والجلسة (لسجل «من فعل») ─── */

export interface AppUser {
  id: number
  nameAr: string
  roleId: string // من أدوار الصلاحيات (owner محجوز للمالك)
  pinHash: string // SHA-256 hex — لا يُخزن الرقم السري أبداً
  active: boolean
  /** استثناءات فردية (البند 4 — لكل موظف): ممنوح فوق الدور / محجوب رغم الدور */
  extraPerms?: string[]
  deniedPerms?: string[]
  /** خزائن/بنوك المستخدم وعملياتها؛ undefined = سجل قديم غير مقيّد مؤقتاً. */
  treasuryAccess?: UserTreasuryAccess
  /**
   * ربط الحساب بسجل الموظف (طلب المالك): المستخدم يجب أن يكون موظفاً مسجلاً
   * أولاً ببياناته المالية والوظيفية — فتُخصم عليه السلف/العجوزات وتُربط وردياته.
   * undefined/null = حساب قديم قبل الربط (يبقى صالحاً للتوافق الخلفي).
   */
  employeeId?: number | null
  /** هاتف الدخول (من سجل الموظف) — يُدخل به بدل الاسم */
  phone?: string
  /** بريد الدخول (من سجل الموظف) — يُدخل به بدل الاسم */
  email?: string
  /**
   * إجبار تغيير الرقم السري عند أول دخول (طلب المالك — النمط العالمي):
   * المدير يعيّن رقماً مبدئياً، وأول دخول به يفتح شاشة تعيين رقم جديد إلزامية.
   */
  mustChangePin?: boolean
  /** صورة شخصية (Data URL) — يرفعها المستخدم من بروفايله */
  avatarDataUrl?: string
  /**
   * الرقم المبدئي الذي عيّنه المدير — يظهر له في شاشة المستخدمين حتى يغيّره
   * الموظف عند أول دخول (بعدها يُمسح ولا يُعرف رقمه لأحد). طلب المالك:
   * «أريد أن أرى رقمه السري الجديد عندي في إعدادات المستخدمين».
   */
  initialPin?: string | null
}

/**
 * اقتراح دور تلقائي من المسمى الوظيفي (طلب المالك: «وظيفته وعلى أساسها
 * تتحدد صلاحياته بشكل تلقائي») — اقتراح قابل للتعديل، لا فرض.
 */
export function suggestRoleForJobTitle(jobTitle: string): string {
  const t = jobTitle.trim()
  if (/مدير|مشرف|supervisor|manager/i.test(t)) return 'branch_manager'
  if (/محاسب|حسابات|account/i.test(t)) return 'accountant'
  if (/بائع أول|senior/i.test(t)) return 'senior_seller'
  if (/كاشير|بائع|بيع|cashier|seller/i.test(t)) return 'cashier'
  return 'cashier'
}

/**
 * إيجاد الحساب بمعرّف يكتبه المستخدم بنفسه (طلب المالك — لا قائمة أسماء):
 * الاسم كاملاً أو الهاتف أو البريد. المطابقة حرفية بعد التشذيب —
 * لا بحث جزئي كي لا يُكشف وجود حسابات.
 */
/**
 * هوية دخول المالك (مراجعة المالك الأمنية): لا زر «دخول المالك» مميز —
 * المالك يدخل من نفس نموذج الجميع بمعرفه (اسم/هاتف/بريد) + رقمه السري،
 * فلا يعرف المخترق أي حقل يخص المالك ولا أن للمالك مدخلاً خاصاً.
 */
export interface OwnerProfile {
  nameAr: string
  phone: string
  email: string
  avatarDataUrl: string
}

export const DEFAULT_OWNER_PROFILE: OwnerProfile = { nameAr: 'المالك', phone: '', email: '', avatarDataUrl: '' }

/** هل المعرف المكتوب يخص المالك؟ نفس قواعد الموظف: مطابقة حرفية للاسم/الهاتف/البريد */
export function matchesOwnerIdentity(profile: OwnerProfile, identifier: string): boolean {
  const q = identifier.trim()
  if (!q) return false
  const qLower = q.toLowerCase()
  return profile.nameAr.trim() === q
    || (profile.phone.trim() !== '' && profile.phone.trim() === q)
    || (profile.email.trim() !== '' && profile.email.trim().toLowerCase() === qLower)
}

export function findUserByIdentifier(users: readonly AppUser[], identifier: string): AppUser | null {
  const q = identifier.trim()
  if (!q) return null
  const qLower = q.toLowerCase()
  return users.find((u) => u.active && (
    u.nameAr.trim() === q
    || (u.phone && u.phone.trim() === q)
    || (u.email && u.email.trim().toLowerCase() === qLower)
  )) ?? null
}

/**
 * تجزئة كلمة السر — WebCrypto متاح في المتصفح وNode 18+.
 * سياسة الطول (8-32 خانة، أرقام وحروف ورموز) تُفرض عند التعيين عبر
 * validatePinFormat في core/auth.ts — التجزئة نفسها محايدة حتى تظل
 * الأرقام القديمة (4-8 أرقام) صالحة للدخول ثم تُرقَّى عند أول تغيير.
 */
export async function hashPin(pin: string): Promise<string> {
  const clean = pin.trim()
  if (!clean || clean.length > 64) throw new Error('كلمة السر فارغة أو أطول من المسموح')
  const data = new TextEncoder().encode(`tahakam:${clean}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function verifyPin(pin: string, pinHash: string): Promise<boolean> {
  const clean = pin.trim()
  if (!clean || clean.length > 64) return false
  return (await hashPin(clean)) === pinHash
}
