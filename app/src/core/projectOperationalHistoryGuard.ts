type Row = Record<string, unknown>
const values = new Set(['running', 'on_hold', 'cancelled', 'finished'])
const object = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v)
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** حماية سجل الحالة التشغيلية عند الدمج والاستعادة؛ لا يُستنتج تاريخ للمشاريع القديمة. */
export function assertProjectOperationalHistoryPreserved(current: Row, incoming: Row): void {
  if (!Array.isArray(current.projects)) return
  const previous = current.projects.filter(object)
  const candidates = Array.isArray(incoming.projects) ? incoming.projects.filter(object) : []
  for (const project of previous) {
    const history = project.operationalStatusHistory
    const hasHistory = Array.isArray(history) && history.length > 0
    const matches = candidates.filter(row => row.id === project.id)
    if (!hasHistory && project.operationalStatus == null && matches.every(row => row.operationalStatus == null && row.operationalStatusHistory == null)) continue
    if (!matches.length && hasHistory) {
      const oldDeletes = Array.isArray(current.projectDeletionRecords) ? current.projectDeletionRecords.filter(object) : []
      const deletes = Array.isArray(incoming.projectDeletionRecords) ? incoming.projectDeletionRecords.filter(object) : []
      if (!oldDeletes.some(row => row.id === project.id) && deletes.some(row => row.id === project.id && typeof row.reason === 'string' && row.reason.trim())) continue
    }
    if (matches.length !== 1) throw new Error(`النسخة تسقط أو تكرر سجل حالة المشروع #${String(project.id)}`)
    const next = matches[0]
    if (equal(project.operationalStatus, next.operationalStatus) && equal(history, next.operationalStatusHistory)) continue
    if (history != null && !Array.isArray(history)) throw new Error('سجل حالة المشروع غير صالح')
    const before = Array.isArray(history) ? history : []
    if (!Array.isArray(next.operationalStatusHistory) || next.operationalStatusHistory.length < before.length || !before.every((row, i) => equal(row, (next.operationalStatusHistory as unknown[])[i]))) throw new Error('النسخة تسقط أو تغير سجل حالة المشروع')
    let status: unknown = 'running'
    for (const entry of next.operationalStatusHistory) {
      if (!object(entry) || entry.from !== status || typeof entry.to !== 'string' || !values.has(entry.to) || entry.to === entry.from || typeof entry.reason !== 'string' || !entry.reason.trim() || entry.reason.trim().length > 300 || typeof entry.at !== 'string' || !entry.at || typeof entry.by !== 'string' || !entry.by) throw new Error('تسلسل حالة المشروع غير صالح')
      status = entry.to
    }
    if (next.operationalStatus !== status) throw new Error('حالة المشروع لا تطابق سجل تغييراتها')
  }
}
