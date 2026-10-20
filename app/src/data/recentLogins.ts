/**
 * قائمة «من استخدم هذا الجهاز من قبل» — أسماء فقط، بلا أي كلمة سر أو تجزئة
 * لها (طلب المالك — عكَس سياسة إخفاء الأسماء السابقة لتسريع اختيار الحساب
 * على جهاز POS بمستخدمين متعددين). كل دخول ناجح يُسجَّل تلقائياً هنا —
 * لا خانة «تذكرني»: الاسم وحده غير حساس فيُحفظ دوماً، وكلمة السر لا تُحفظ
 * إطلاقاً (يكتبها صاحبها يدوياً في كل مرة — طلب المالك الأمني الثاني).
 *
 * محدودة الطول (الأحدث استخداماً أولاً) وقابلة لحذف أي بطاقة بضغطة زر
 * صريحة من شاشة الدخول (مثلاً عند مغادرة موظف الجهاز المشترك).
 */

const RECENT_LOGINS_KEY = 'tahakam-recent-logins'
const MAX_RECENT_LOGINS = 8

export interface RecentLogin {
  /** النص المطابق فعلياً عند الدخول (الاسم الكامل/الهاتف/البريد كما كُتب) */
  identifier: string
  /** الاسم المعروض على البطاقة — ليس بالضرورة نفس identifier (قد يكون هاتفاً/بريداً) */
  displayName: string
  /** ISO — للترتيب بالأحدث أولاً وتقليم القائمة */
  lastLoginAt: string
}

function isRecentLogin(v: unknown): v is RecentLogin {
  const r = v as Partial<RecentLogin> | null
  return !!r && typeof r.identifier === 'string' && typeof r.displayName === 'string' && typeof r.lastLoginAt === 'string'
}

export function loadRecentLogins(): RecentLogin[] {
  try {
    const raw = localStorage.getItem(RECENT_LOGINS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isRecentLogin).sort((a, b) => b.lastLoginAt.localeCompare(a.lastLoginAt))
  } catch {
    return [] // بيانات تالفة — تجاهل بصمت
  }
}

/** يُستدعى بعد كل دخول ناجح — يرفع صاحب الدخول لأعلى القائمة أو يضيفه جديداً */
export function rememberRecentLogin(identifier: string, displayName: string): void {
  try {
    const trimmedId = identifier.trim()
    if (!trimmedId) return
    const rest = loadRecentLogins().filter((r) => r.identifier !== trimmedId)
    const next = [{ identifier: trimmedId, displayName: displayName.trim() || trimmedId, lastLoginAt: new Date().toISOString() }, ...rest].slice(0, MAX_RECENT_LOGINS)
    localStorage.setItem(RECENT_LOGINS_KEY, JSON.stringify(next))
  } catch {
    /* صامت — لا يعطل الدخول نفسه */
  }
}

/** حذف بطاقة واحدة من القائمة (مثلاً: موظف غادر الجهاز المشترك) */
export function forgetRecentLogin(identifier: string): void {
  try {
    localStorage.setItem(RECENT_LOGINS_KEY, JSON.stringify(loadRecentLogins().filter((r) => r.identifier !== identifier)))
  } catch {
    /* صامت */
  }
}

/** تنظيف ميراث خانة «حفظ بيانات الدخول» القديمة (كانت تحفظ كلمة السر نفسها
 * مشفَّرة) — تُستدعى مرة عند تحميل شاشة الدخول حتى لا يبقى رقم سري قديم
 * على القرص بلا داعٍ بعد إلغاء هذه الميزة. */
export function purgeLegacySavedPin(): void {
  try {
    localStorage.removeItem('tahakam-saved-login')
  } catch {
    /* صامت */
  }
}
