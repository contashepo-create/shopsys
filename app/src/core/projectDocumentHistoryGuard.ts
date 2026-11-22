type Snapshot = Record<string, unknown>
type Row = Record<string, unknown> & { id: number }

/** مقارنة بيانات JSON دون اعتبار ترتيب المفاتيح أو الخصائص غير المحفوظة. */
function same(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, i) => same(value, right[i]))
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>
  const keys = Object.keys(a).filter(key => a[key] !== undefined).sort(), others = Object.keys(b).filter(key => b[key] !== undefined).sort()
  return keys.length === others.length && keys.every((key, i) => key === others[i] && same(a[key], b[key]))
}

function records(value: unknown, label: string): Row[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error(`${label} غير صالح — راجع النسخة`)
  const seen = new Set<number>()
  return value.map((value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} غير صالح — راجع النسخة`)
    const row = value as Record<string, unknown>
    if (!Number.isSafeInteger(row.id) || (row.id as number) <= 0 || seen.has(row.id as number)) throw new Error(`${label} يحتوي معرفاً غير صالح أو مكرراً — راجع النسخة`)
    seen.add(row.id as number)
    return row as Row
  })
}

/**
 * حماية ما حُفظ محلياً من محاضر الكميات وسجل حذف العروض والحصر، ومنع إحياء
 * مستند له سجل حذف في اللقطة الواردة. لا تثبت صحة الأدلة أو اكتمال التاريخ،
 * ولا تشمل استبدال ملف SQLite أو الكتّاب الذين يتجاوزون هذه المقارنة.
 */
export function assertProjectDocumentHistoryPreserved(current: Snapshot, incoming: Snapshot): void {
  const groups = [
    ['projectCloseouts', 'سجل محاضر الكميات (محضر الإقفال)'],
    ['quotationDeletionRecords', 'سجل حذف عروض الأسعار'],
    ['surveyDeletionRecords', 'سجل حذف الحصر'],
  ] as const
  for (const [key, label] of groups) {
    const old = records(current[key], label), next = records(incoming[key], label)
    const nextById = new Map(next.map(row => [row.id, row]))
    for (const row of old) if (!nextById.has(row.id) || !same(row, nextById.get(row.id))) throw new Error(`النسخة تسقط أو تغيّر ${label} #${row.id} — راجع التاريخ`)
  }
  for (const [deletedKey, documentsKey, label] of [
    ['quotationDeletionRecords', 'quotations', 'عرض سعر محذوف'],
    ['surveyDeletionRecords', 'projectSurveys', 'حصر محذوف'],
  ] as const) {
    const deleted = records(incoming[deletedKey], 'سجل الحذف')
    if (!deleted.length) continue
    const raw = incoming[documentsKey]
    if (raw != null && !Array.isArray(raw)) throw new Error(`قائمة المستندات المرتبطة بـ${label} غير صالحة`)
    const ids = new Set(deleted.map(row => row.id))
    if (Array.isArray(raw) && raw.some(row => row && typeof row === 'object' && !Array.isArray(row) && ids.has((row as { id: number }).id) && (documentsKey !== 'quotations' || !(row as { deletedAt?: unknown }).deletedAt))) throw new Error(`النسخة تعيد ${label} — راجع السجل`)
  }
}
