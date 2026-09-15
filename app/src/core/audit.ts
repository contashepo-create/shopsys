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

/** السجلات التي تُرصد إضافتها/حذفها تلقائياً */
const WATCHED: CollectionSpec[] = [
  { key: 'items', labelAr: 'صنف', nameField: 'nameAr' },
  { key: 'customers', labelAr: 'عميل', nameField: 'nameAr' },
  { key: 'suppliers', labelAr: 'مورد', nameField: 'nameAr' },
  { key: 'employees', labelAr: 'موظف', nameField: 'nameAr' },
  { key: 'treasuries', labelAr: 'خزينة/بنك', nameField: 'nameAr', idField: 'code' },
  { key: 'warehouses', labelAr: 'مخزن', nameField: 'nameAr' },
  { key: 'appUsers', labelAr: 'مستخدم', nameField: 'nameAr' },
  { key: 'issues', labelAr: 'بلاغ داخلي', nameField: 'title' },
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
}

/** تجزئة الرقم السري (4-8 أرقام) — WebCrypto متاح في المتصفح وNode 18+ */
export async function hashPin(pin: string): Promise<string> {
  const clean = pin.trim()
  if (!/^\d{4,8}$/.test(clean)) throw new Error('الرقم السري: 4 إلى 8 أرقام')
  const data = new TextEncoder().encode(`tahakam:${clean}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function verifyPin(pin: string, pinHash: string): Promise<boolean> {
  if (!/^\d{4,8}$/.test(pin.trim())) return false
  return (await hashPin(pin)) === pinHash
}
