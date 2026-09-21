/**
 * سجل التطبيق التقني (App Log) — طلب المالك:
 * سجل محلي على جهاز العميل يلتقط الأحداث والأخطاء لتتبع أي مشكلة،
 * ويُرسل للمطوّر فقط بموافقة صريحة من العميل عند التبليغ عن مشكلة.
 *
 * التصميم: حلقة محدودة (أحدث LOG_MAX سطراً) في localStorage —
 * لا ينتفخ أبداً، ولا يحتوي بيانات مالية (رسائل تقنية فقط).
 */

export type LogLevel = 'info' | 'warn' | 'error'

export interface LogLine {
  at: string // ISO
  level: LogLevel
  msg: string
}

export const LOG_MAX = 800
export const LOG_KEY = 'shopsys-log'
/** حد حجم اللوج المرفوع للمطور (يُقص الأقدم) */
export const LOG_EXPORT_MAX_CHARS = 60_000

/** إلحاق سطر بحلقة اللوج — دالة خالصة على المصفوفة */
export function pushLog(ring: readonly LogLine[], line: LogLine, max = LOG_MAX): LogLine[] {
  const next = [...ring, line]
  return next.length > max ? next.slice(next.length - max) : next
}

/** تحويل الحلقة لنص مقروء للإرسال — مقصوص من الأقدم عند تجاوز الحد */
export function logToText(ring: readonly LogLine[], maxChars = LOG_EXPORT_MAX_CHARS): string {
  const text = ring.map((l) => `[${l.at.slice(0, 19).replace('T', ' ')}] ${l.level.toUpperCase()}: ${l.msg}`).join('\n')
  return text.length > maxChars ? `…(قُص الأقدم)\n${text.slice(text.length - maxChars)}` : text
}

/* ─── الجانب غير الخالص: القراءة/الكتابة من localStorage (متسامح مع الفشل) ─── */

function readRing(): LogLine[] {
  try {
    const raw = localStorage.getItem(LOG_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter((l) => l && typeof l.msg === 'string') : []
  } catch { return [] }
}

/** تسجيل حدث — لا يرمي أبداً (السجل مساعد، لا يعطل التطبيق) */
export function logEvent(level: LogLevel, msg: string): void {
  try {
    const line: LogLine = { at: new Date().toISOString(), level, msg: String(msg).slice(0, 400) }
    localStorage.setItem(LOG_KEY, JSON.stringify(pushLog(readRing(), line)))
  } catch { /* صامت */ }
}

export function getLogLines(): LogLine[] { return readRing() }
export function getLogText(): string { return logToText(readRing()) }

/** تركيب مصائد الأخطاء العامة — تُستدعى مرة واحدة عند الإقلاع */
export function installErrorHooks(): void {
  try {
    window.addEventListener('error', (e) => logEvent('error', `${e.message} @${e.filename ?? '?'}:${e.lineno ?? '?'}`))
    window.addEventListener('unhandledrejection', (e) => logEvent('error', `Promise: ${String((e as PromiseRejectionEvent).reason).slice(0, 300)}`))
  } catch { /* صامت */ }
}
