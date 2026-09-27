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

/**
 * تنقية رسائل اللوج قبل التخزين أو الإرسال:
 * اللوج تشخيصي وليس مكاناً للأسرار أو بيانات العملاء. نخفي القيم الشائعة
 * للأسرار والاعتمادات والـquery strings ونقص الرسالة حتى لا تتسرب حمولة كبيرة.
 */
export function redactLogMessage(input: unknown): string {
  return String(input)
    .replace(/(authorization|access_token|accessToken|anonKey|api[_-]?key|password|secret|token)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .replace(/\b(Bearer|Support)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [REDACTED]')
    .replace(/(https?:\/\/[^\s?]+)\?[^\s]*/gi, '$1?[REDACTED]')
    // التحكمية مقصودة هنا: اللوج لا يسمح بمحارف طرفية أو تحكمية.
    // oxlint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .slice(0, 400)
}

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
    return Array.isArray(arr)
      ? arr
        .filter((l): l is Partial<LogLine> => !!l && typeof l === 'object' && typeof l.msg === 'string')
        .map((l) => ({
          at: typeof l.at === 'string' ? l.at.slice(0, 30) : '',
          level: l.level === 'warn' || l.level === 'error' ? l.level : 'info',
          msg: redactLogMessage(l.msg),
        }))
      : []
  } catch { return [] }
}

/** تسجيل حدث — لا يرمي أبداً (السجل مساعد، لا يعطل التطبيق) */
export function logEvent(level: LogLevel, msg: string): void {
  try {
    const line: LogLine = { at: new Date().toISOString(), level, msg: redactLogMessage(msg) }
    localStorage.setItem(LOG_KEY, JSON.stringify(pushLog(readRing(), line)))
  } catch { /* صامت */ }
}

export function getLogLines(): LogLine[] { return readRing() }
export function getLogText(): string { return logToText(readRing()) }

/** تركيب مصائد الأخطاء العامة — تُستدعى مرة واحدة عند الإقلاع */
let hooksInstalled = false
export function installErrorHooks(): void {
  if (hooksInstalled) return
  hooksInstalled = true
  try {
    window.addEventListener('error', (e) => logEvent('error', `window error: ${e.message} @${e.filename ? '[redacted-file]' : '?'}:${e.lineno ?? '?'}`))
    window.addEventListener('unhandledrejection', (e) => logEvent('error', `Promise: ${String((e as PromiseRejectionEvent).reason)}`))
  } catch { /* صامت */ }
}
