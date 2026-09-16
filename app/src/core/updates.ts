/**
 * التحديث التلقائي عبر Cloudflare (أمر المالك — البند 6):
 * - زر «فحص التحديثات» في «حول» يسأل نقطة /version على عامل Cloudflare.
 * - مقارنة إصدارات دلالية صارمة (semver مبسط: major.minor.patch).
 * - خطة ما قبل التحديث: نسخة احتياطية معزولة في مجلد مؤقت خارج مسار التثبيت،
 *   والتراجع التلقائي عند الفشل — تُمثَّل هنا كخطوات نواة خالصة ينفذها غلاف
 *   Electron لاحقاً (المثبّت مؤجل بأمر المالك حتى يطلبه).
 * - بيانات المستخدم كلها خارج مسار التثبيت (user-data) — الحذف لا يمسها.
 */

export const APP_VERSION = '1.0.0' // إصدار النسخة الحالية — يرتفع مع كل إصدار منشور

export interface UpdateInfo {
  latestVersion: string
  downloadUrl: string
  releaseNotesAr: string
  sha256: string // بصمة الحزمة — تُفحص قبل التثبيت
  mandatory: boolean // إجباري (ثغرة أمنية مثلاً) — يمنع تأجيله
  publishedAt: string
}

/** تنقية استجابة /version — لا ثقة بأي شكل خارجي */
export function parseUpdateInfo(raw: unknown): UpdateInfo | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  const latestVersion = typeof o.latestVersion === 'string' ? o.latestVersion.trim() : ''
  if (!isValidVersion(latestVersion)) return null
  return {
    latestVersion,
    downloadUrl: typeof o.downloadUrl === 'string' ? o.downloadUrl : '',
    releaseNotesAr: typeof o.releaseNotesAr === 'string' ? o.releaseNotesAr : '',
    sha256: typeof o.sha256 === 'string' ? o.sha256 : '',
    mandatory: o.mandatory === true,
    publishedAt: typeof o.publishedAt === 'string' ? o.publishedAt : '',
  }
}

export function isValidVersion(v: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(v)
}

/** مقارنة دلالية: 1 لو a أحدث، −1 لو أقدم، 0 تساوٍ */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  if (!isValidVersion(a) || !isValidVersion(b)) throw new Error('إصدار غير صالح')
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1
    if (pa[i] < pb[i]) return -1
  }
  return 0
}

export type UpdateDecision =
  | { kind: 'up_to_date' }
  | { kind: 'update_available'; info: UpdateInfo }
  | { kind: 'mandatory_update'; info: UpdateInfo }

export function decideUpdate(current: string, info: UpdateInfo | null): UpdateDecision {
  if (!info || compareVersions(info.latestVersion, current) <= 0) return { kind: 'up_to_date' }
  return info.mandatory ? { kind: 'mandatory_update', info } : { kind: 'update_available', info }
}

/* ─── خطة التحديث الآمن (ينفذها غلاف سطح المكتب خطوة بخطوة) ─── */

export interface UpdatePlanStep {
  id: string
  titleAr: string
  /** فشل هذه الخطوة ⇒ تراجع كامل (rollback) واستعادة النسخة الاحتياطية */
  critical: boolean
}

/**
 * الخطوات المتفق عليها (البند 6): النسخة الاحتياطية أولاً وفي مجلد النظام
 * المؤقت خارج مسار التثبيت — ثم التنزيل والفحص والتثبيت والترحيل والتحقق.
 */
export function buildUpdatePlan(): UpdatePlanStep[] {
  return [
    { id: 'backup_db', titleAr: 'نسخة احتياطية معزولة لقاعدة البيانات في المجلد المؤقت (خارج مسار التثبيت)', critical: true },
    { id: 'download', titleAr: 'تنزيل حزمة التحديث في الخلفية', critical: true },
    { id: 'verify_hash', titleAr: 'التحقق من بصمة SHA-256 للحزمة', critical: true },
    { id: 'stage', titleAr: 'تجهيز التحديث (staging) بلا مساس بالنسخة العاملة', critical: true },
    { id: 'install', titleAr: 'تثبيت النسخة الجديدة', critical: true },
    { id: 'migrate_schema', titleAr: 'ترحيل قاعدة البيانات تلقائياً (بلا فقد بيانات)', critical: true },
    { id: 'verify_boot', titleAr: 'التحقق من إقلاع النسخة الجديدة وقراءة البيانات', critical: true },
    { id: 'cleanup', titleAr: 'تنظيف ملفات التحديث المؤقتة', critical: false },
  ]
}

/** عند فشل خطوة حرجة: التراجع = استعادة النسخة الاحتياطية + العودة للإصدار السابق */
export function rollbackFrom(failedStepId: string, plan: UpdatePlanStep[]): string[] {
  const idx = plan.findIndex((s) => s.id === failedStepId)
  if (idx === -1) throw new Error('خطوة مجهولة')
  const done = plan.slice(0, idx)
  const actions: string[] = []
  if (done.some((s) => s.id === 'install')) actions.push('إعادة تثبيت الإصدار السابق')
  if (done.some((s) => s.id === 'migrate_schema') || plan[idx].id === 'migrate_schema') actions.push('استعادة قاعدة البيانات من النسخة الاحتياطية المعزولة')
  actions.push('إبلاغ المستخدم برسالة عربية واضحة وتسجيل السبب')
  return actions
}

/* ─── ترحيل مخطط البيانات (بلا فقد) ─── */

export interface Migration {
  fromVersion: number
  toVersion: number
  /** تحويل خالص: يستلم الحالة القديمة ويعيد الجديدة — لا حذف حقول أبداً، فقط إضافة/تحويل */
  migrate: (old: Record<string, unknown>) => Record<string, unknown>
}

/** تشغيل سلسلة ترحيلات بالترتيب من إصدار الحالة الحالي حتى المستهدف */
export function runMigrations(
  data: Record<string, unknown>,
  currentVersion: number,
  migrations: readonly Migration[],
): { data: Record<string, unknown>; version: number; applied: number[] } {
  const sorted = [...migrations].sort((a, b) => a.fromVersion - b.fromVersion)
  let out = data
  let v = currentVersion
  const applied: number[] = []
  for (const m of sorted) {
    if (m.fromVersion !== v) continue
    if (m.toVersion !== v + 1) throw new Error(`ترحيل غير متسلسل: ${m.fromVersion}→${m.toVersion}`)
    out = m.migrate(out)
    v = m.toVersion
    applied.push(v)
  }
  return { data: out, version: v, applied }
}

/** جلب معلومات التحديث من عامل Cloudflare — فشل الشبكة يعيد null (لا يرمي أبداً) */
export async function fetchUpdateInfo(baseUrl: string): Promise<UpdateInfo | null> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 8000)
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/version`, { signal: ctrl.signal, cache: 'no-store' })
    clearTimeout(t)
    if (!res.ok) return null
    return parseUpdateInfo(await res.json())
  } catch {
    return null
  }
}
