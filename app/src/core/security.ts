/**
 * طبقة الحماية (القرار 28) — نواة خالصة
 * ──────────────────────────────────────
 * 1) تشفير قاعدة البيانات محلياً: AES-256-GCM بمفتاح مشتق (PBKDF2) من
 *    معرّف الجهاز + ملح التطبيق — من ينسخ ملفات التخزين لجهاز آخر يجد
 *    شفرة لا نصاً. (في نسخة Electron يُضاف ربط بمخزن مفاتيح النظام.)
 * 2) جدولة النسخ الاحتياطي كل ساعة على جهاز العميل (حلقة snapshots).
 * 3) منطق القفل: انتهاء التجربة/الباقة/إرجاع الساعة/مفتاح محروق ⇒
 *    التحويل لقسم مقفل وظيفته فقط: تواصل مع المطوّر، تفعيل، تصدير بيانات.
 */
import { activityMatches, isRevoked, type LicensePayload, type LicenseState } from './license.ts'

/* ═══ 1) التشفير AES-256-GCM ═══ */

const ENC_PREFIX = 'SSENC1.' // بادئة تميز النص المشفر عن القديم غير المشفر
const APP_SALT = 'shopsys-at-rest-v1' // ملح ثابت للاشتقاق (يتغير مع كل إصدار صيغة)

function te(s: string): Uint8Array { return new TextEncoder().encode(s) }

function b64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}
function unb64(s: string): Uint8Array {
  const raw = atob(s)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/** اشتقاق مفتاح AES-256 من سر (معرّف الجهاز) — PBKDF2/SHA-256 بـ100k دورة */
export async function deriveKey(secret: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', te(secret + APP_SALT) as unknown as ArrayBuffer, 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: te(APP_SALT) as unknown as ArrayBuffer, iterations: 100_000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** تشفير نص → SSENC1.<iv-b64>.<ciphertext-b64> */
export async function encryptText(plain: string, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as unknown as ArrayBuffer }, key, te(plain) as unknown as ArrayBuffer)
  return `${ENC_PREFIX}${b64(iv)}.${b64(new Uint8Array(ct))}`
}

export function isEncrypted(stored: string): boolean {
  return stored.startsWith(ENC_PREFIX)
}

/** فك التشفير — يرمي لو الشفرة تالفة أو المفتاح خطأ (GCM يتحقق من السلامة) */
export async function decryptText(stored: string, key: CryptoKey): Promise<string> {
  if (!isEncrypted(stored)) throw new Error('ليست شفرة SSENC1')
  const parts = stored.slice(ENC_PREFIX.length).split('.')
  if (parts.length !== 2) throw new Error('شفرة تالفة')
  const iv = unb64(parts[0])
  const ct = unb64(parts[1])
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as unknown as ArrayBuffer }, key, ct as unknown as ArrayBuffer)
  return new TextDecoder().decode(pt)
}

/* ═══ 2) جدولة النسخ الاحتياطي كل ساعة ═══ */

export const HOURLY_BACKUP_INTERVAL_MS = 60 * 60 * 1000
/** عدد اللقطات المحفوظة محلياً (حلقة — الأقدم يُستبدل) */
export const HOURLY_BACKUP_KEEP = 3

export interface HourlySnapshot {
  at: string // ISO
  checksum: string
  data: string // JSON النسخة
}

/** هل حان موعد لقطة جديدة؟ الفاصل قابل للجدولة من الإعدادات (طلب المالك) — الافتراضي كل ساعة */
export function isBackupDue(lastAtIso: string | null, nowIso: string, intervalMs = HOURLY_BACKUP_INTERVAL_MS): boolean {
  if (!lastAtIso) return true
  return Date.parse(nowIso) - Date.parse(lastAtIso) >= intervalMs
}

/** خيارات جدولة النسخ التلقائي (بالدقائق) — تُعرض في صفحة النسخ الاحتياطي */
export const BACKUP_INTERVAL_CHOICES: { minutes: number; labelAr: string }[] = [
  { minutes: 30, labelAr: 'كل نصف ساعة' },
  { minutes: 60, labelAr: 'كل ساعة (مُوصى به)' },
  { minutes: 180, labelAr: 'كل 3 ساعات' },
  { minutes: 360, labelAr: 'كل 6 ساعات' },
  { minutes: 1440, labelAr: 'مرة يومياً' },
]

/** إضافة لقطة للحلقة مع إبقاء آخر KEEP فقط (الأحدث أولاً) */
export function pushSnapshot(ring: readonly HourlySnapshot[], snap: HourlySnapshot, keep = HOURLY_BACKUP_KEEP): HourlySnapshot[] {
  return [snap, ...ring].slice(0, keep)
}

/* ═══ 3) منطق القفل (القسم الخاص عند انتهاء الباقة) ═══ */

export type LockReason = 'trial_expired' | 'expired' | 'clock_tampered' | 'revoked' | 'activity_mismatch' | 'license_unverifiable' | 'license_invalid'

/**
 * هل يُحوَّل المستخدم لشاشة القفل؟
 * التجربة السارية والمفتاح الساري فقط يسمحان بالدخول — كل ما عدا ذلك قفل.
 */
export function lockReasonFor(
  state: LicenseState,
  extra?: { revoked?: boolean; activityMismatch?: boolean; unverifiable?: boolean },
): LockReason | null {
  if (extra?.revoked) return 'revoked'
  /* ث9 (مراجعة المرحلة ②): تعذّر التحقق البيئي ليس «انتهت التجربة» — عميل
     مدفوع له مفتاح محفوظ يجب أن يُقال له السبب الحقيقي لا حكم خاطئ. */
  if (extra?.unverifiable) return 'license_unverifiable'
  if (extra?.activityMismatch) return 'activity_mismatch'
  if (state.status === 'trial' || state.status === 'active') return null
  if (state.status === 'trial_expired') return 'trial_expired'
  if (state.status === 'clock_tampered') return 'clock_tampered'
  if (state.status === 'expired') return 'expired'
  /* ح2: قيمة زمنية تالفة في الترخيص ≠ «انتهى اشتراكك» — سبب صادق يطلب الدعم */
  if (state.status === 'invalid') return 'license_invalid'
  return 'expired' // invalid وغيرها ⇒ قفل
}

/** الحد الأدنى من حالة المتجر التي يحتاجها قرار القفل (متوافق بنيوياً مع AppState) */
export interface LockStoreSlice {
  activatedKey: string | null
  activatedPayload: LicensePayload | null
  revokedKeys: readonly string[]
  licenseAudit: { status: string }
  setup: { completed: boolean; activityId: string | null; activityKeyHistory: readonly string[] }
}

/**
 * القرار الموحّد للقفل (ح6 — مراجعة ③): الواجهة **والمهام الخلفية** (إرسال تليجرام
 * المجدول، المزامنة السحابية، خادم الشبكة) تستعمل هذه الدالة نفسها. قبلها كانت المهام
 * الخلفية تكتفي بـ hasFeature، فتستمر خلف شاشة القفل عند الإبطال أو عدم تطابق النشاط.
 */
export function currentLockReason(state: LicenseState, store: LockStoreSlice): LockReason | null {
  const { activatedKey, activatedPayload, revokedKeys, setup } = store
  return lockReasonFor(state, {
    revoked: activatedKey != null && isRevoked(activatedKey, revokedKeys),
    unverifiable: store.licenseAudit.status === 'unverifiable',
    activityMismatch: activatedPayload != null && setup.completed
      && !activityMatches(activatedPayload, setup.activityId, setup.activityKeyHistory),
  })
}

export const LOCK_REASON_LABELS: Record<LockReason, { title: string; desc: string; icon: string }> = {
  license_invalid: {
    title: 'بيانات الترخيص غير صالحة',
    desc: 'مرساة الترخيص المحفوظة تالفة أو معدّلة يدوياً. تواصل مع المطوّر لإعادة ضبط الترخيص — بياناتك محفوظة بالكامل.',
    icon: '⚠️',
  },
  trial_expired: {
    title: 'انتهت الفترة التجريبية',
    desc: 'انتهت أيام التجربة الـ14. فعّل باقة للاستمرار — بياناتك محفوظة بالكامل ويمكنك تصديرها.',
    icon: '⏳',
  },
  expired: {
    title: 'انتهى اشتراكك',
    desc: 'انتهت مدة الباقة الحالية. جدّد الاشتراك من المطوّر لاستعادة كامل الوظائف — بياناتك بأمان.',
    icon: '📆',
  },
  clock_tampered: {
    title: 'تم رصد تلاعب بساعة الجهاز',
    desc: 'تاريخ الجهاز أقدم من آخر استخدام مسجل. اضبط الساعة الصحيحة أو تواصل مع المطوّر.',
    icon: '🕰️',
  },
  revoked: {
    title: 'مفتاح التفعيل محروق',
    desc: 'أُبطل هذا المفتاح من المطوّر (يُحرق عند تغيير النشاط أو مخالفة الشروط) ولا يُعاد استخدامه.',
    icon: '🔥',
  },
  license_unverifiable: {
    title: 'تعذّر التحقق من مفتاح التفعيل',
    desc: 'مفتاحك محفوظ كما هو ولم يُحذف، لكن بيئة التشغيل الحالية لا تتيح التحقق من التوقيع. افتح التطبيق من نسخة سطح المكتب أو عبر اتصال آمن https — ويعود العمل تلقائياً بلا فقدان للمفتاح.',
    icon: '🛡️',
  },
  activity_mismatch: {
    title: 'المفتاح لنشاط آخر',
    desc: 'مفتاحك صادر للنشاط الذي سجّلت به أولاً. أنشأت قاعدة بيانات بنشاط مختلف — اطلب مفتاحاً جديداً من المطوّر.',
    icon: '🔒',
  },
}

/* ═══ تصدير البيانات من شاشة القفل (حق العميل في بياناته) ═══ */

/**
 * تحويل مصفوفة كائنات إلى CSV (UTF-8 مع BOM لفتح صحيح في Excel عربي).
 * - العناوين = اتحاد مفاتيح كل الصفوف بترتيب ظهورها الأول: أي حقل يظهر في
 *   صف لاحق لا يُسقط بصمت (تصدير LockScreen/EmployeesPage يمرّ ببيانات مستخدم).
 * - تحييد حقن الصيغ (CSV injection): Excel يفسّر خلية تبدأ بـ = + - @ (أو محرف
 *   تحكم) كصيغة عند الفتح، والقيم هنا مدخلات مستخدم (أسماء/ملاحظات) — نُسبق
 *   البادئات الخطرة بعلامة ' فتُعرض نصاً. الأرقام السالبة تبقى كما هي
 *   كي لا تتشوه الأرصدة والتقارير المالية في التصدير.
 */
export function toCsv(rows: readonly Record<string, unknown>[]): string {
  if (!rows.length) return '\uFEFF'
  const headers: string[] = []
  for (const r of rows) for (const k of Object.keys(r)) if (!headers.includes(k)) headers.push(k)
  const escape = (v: unknown) => {
    let s = v == null ? '' : String(v)
    if (/^[=+\t\r@]/.test(s) || (/^-/.test(s) && !/^-\d[\d.,]*$/.test(s))) s = "'" + s
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))]
  return '\uFEFF' + lines.join('\n')
}
