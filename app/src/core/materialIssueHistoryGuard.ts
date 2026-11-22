type Snapshot = Record<string, unknown>
type Row = Record<string, unknown>

// مقارنة محتوى JSON بصرف النظر عن ترتيب المفاتيح (وخصائص undefined غير المحفوظة).
function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, i) => same(value, b[i]))
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  const x = a as Row, y = b as Row
  const keys = Object.keys(x).filter(k => x[k] !== undefined).sort(), other = Object.keys(y).filter(k => y[k] !== undefined).sort()
  return keys.length === other.length && keys.every((k, i) => k === other[i] && same(x[k], y[k]))
}
function records(value: unknown): Row[] {
  if (!Array.isArray(value)) return []
  return value.filter((row): row is Row => !!row && typeof row === 'object' && !Array.isArray(row))
}

/**
 * يحفظ أدلة صرف المواد المحلية الموجودة فعلاً عند استبدال لقطة أو دمجها.
 * لا يُنشئ أدلة مفقودة في سجل قديم، ولا يثبت أن التاريخ الموجود مكتمل أو صحيح.
 */
export function assertMaterialIssueHistoryPreserved(current: Snapshot, incoming: Snapshot): void {
  if (current.materialRequisitions == null) return
  if (!Array.isArray(current.materialRequisitions)) throw new Error('سجل صرف المواد المحلي غير صالح — راجع البيانات')
  const reqs = current.materialRequisitions
  if (!reqs.length) return
  if (!Array.isArray(incoming.materialRequisitions)) throw new Error('النسخة تسقط سجل صرف المواد — راجع البيانات')
  const preserve = (row: unknown, key: string) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('دليل صرف المواد المحلي غير صالح — راجع البيانات')
    const original = row as Row
    if (!Number.isSafeInteger(original.id) || (original.id as number) <= 0) throw new Error('معرف دليل صرف المواد المحلي غير صالح')
    const old = records(current[key]).filter(candidate => candidate.id === original.id)
    const next = records(incoming[key]).filter(candidate => candidate.id === original.id)
    if (old.length !== 1 || next.length !== 1 || !same(original, next[0])) throw new Error('النسخة تسقط أو تغيّر دليل صرف المواد — راجع الإذن وتكلفته وحركاته')
  }
  for (const value of reqs) {
    preserve(value, 'materialRequisitions')
    const req = value as Row
    for (const move of records(current.stockMoves).filter(row => row.docType === 'material_issue' && row.docId === req.id)) preserve(move, 'stockMoves')
    if (Number.isSafeInteger(req.journalEntryId)) {
      for (const cost of records(current.projectCosts).filter(row => row.journalEntryId === req.journalEntryId)) preserve(cost, 'projectCosts')
    }
  }
}
