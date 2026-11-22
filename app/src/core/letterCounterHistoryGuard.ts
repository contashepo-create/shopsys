type Snapshot = Record<string, unknown>

/** لا نفترض وجود عداد في النسخ التي تسبق الخطابات، لكن لا نقبل عداداً تالفاً. */
function counters(state: Snapshot): Record<string, number> {
  const value = state.letterNumberCounters
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('عدادات الخطابات غير صالحة — راجع النسخة قبل تطبيقها')
  for (const [key, count] of Object.entries(value)) {
    if (!key || ['__proto__', 'prototype', 'constructor'].includes(key) || typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0 || count > 999999999) throw new Error('عدادات الخطابات غير صالحة — راجع النسخة قبل تطبيقها')
  }
  return value as Record<string, number>
}

/** حارس للعداد المحلي فقط، ولا يثبت اكتمال سجل الخطابات أو تزامن الأجهزة. */
export function assertLetterCountersPreserved(current: Snapshot, incoming: Snapshot): void {
  const old = counters(current), next = counters(incoming)
  for (const [key, count] of Object.entries(old)) {
    if (count > 0 && (!Object.hasOwn(next, key) || next[key] < count)) throw new Error(`النسخة تسقط أو تخفض عداد الخطابات (${key}) — راجع الترقيم قبل تطبيقها`)
  }
}
