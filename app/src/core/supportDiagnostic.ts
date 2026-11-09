/**
 * مقتطف قابل للمعاينة من السجلات، لا السجل الخام. دفاع احترازي وليس ضماناً
 * لإزالة كل البيانات الشخصية: على المستخدم مراجعة النص قبل موافقته على إرساله.
 */
export const SUPPORT_MAIN_LOG_MAX_CHARS = 42_000
export const SUPPORT_RENDERER_LOG_MAX_CHARS = 12_000
const sensitive = /cookie|authorization|password|passphrase|secret|token|credential|private.?key|api[_-]?key|session(?:id)?|signature|bearer|support\s+[A-Za-z0-9_-]{20,}|\beyJ[A-Za-z0-9_-]{12,}\./i

function diagnosticLine(line: string): string {
  // oxlint-disable-next-line no-control-regex
  const cleaned = line.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
  if (sensitive.test(cleaned)) {
    // احتفظ برمز تشخيص شائع فقط، لا بباقي السطر الذي قد يحتوي اعتمادات.
    const code = cleaned.match(/\b(?:ERR_[A-Z0-9_]+|HTTP\s+\d{3}|E[A-Z]{3,})\b/)?.[0]
    const stamp = cleaned.match(/^\[(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z)\]/)?.[1]
    const prefix = stamp ? `[${stamp}] [محجوب] ` : '    at [محجوب] '
    return `${prefix}[سطر محجوب لاحتمال وجود بيانات حساسة${code ? ` — ${code}` : ''}]`
  }
  return cleaned
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[رابط محجوب]')
    .replace(/\b[A-Za-z]:\\[^\s"'<>]+/g, '[مسار محلي محجوب]')
    .replace(/\/(?:home|Users|home\/user)\/[^\s"'<>]+/g, '[مسار محلي محجوب]')
    .slice(0, 2000)
}

/** يستبعد استمرار رؤوس HTTP وكتل النص الخام؛ يستبقي سطور main.log وإطارات stack فقط. */
export function sanitizeMainLog(raw: string): string {
  const lines = raw.split(/\r?\n/).filter(line => /^\[\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z\] \[[^\]\r\n]{1,80}\]/.test(line) || /^\s+at\s/.test(line))
  return lines.map(diagnosticLine).join('\n').slice(-SUPPORT_MAIN_LOG_MAX_CHARS)
}

/** حلقة الواجهة أيضاً قد تحمل خطأ شبكة من مصدر غير موثوق؛ لا تُرسل خاماً. */
export function sanitizeRendererLog(raw: string): string {
  return raw.split(/\r?\n/).filter(line => /^\[\d{4}-\d\d-\d\d[^\]]*\] (?:INFO|WARN|ERROR):/.test(line))
    .map(diagnosticLine).join('\n').slice(-SUPPORT_RENDERER_LOG_MAX_CHARS)
}

export function combineSupportLogs(main: string | null, renderer: string): string {
  const ui = sanitizeRendererLog(renderer)
  const mainText = main === null ? 'غير متاح في نسخة الويب.' : sanitizeMainLog(main) || 'لا توجد سطور متاحة في ملف السجل.'
  return `=== مقتطف سجل العملية الرئيسية main.log ===\n${mainText}\n\n=== سجل الواجهة ===\n${ui || 'لا توجد سطور متاحة.'}`
}
