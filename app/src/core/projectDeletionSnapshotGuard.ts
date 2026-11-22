type Snapshot = Record<string, unknown>
type Deletion = Record<string, unknown> & { id: number }

function deletions(state: Snapshot): Deletion[] {
  const value = state.projectDeletionRecords
  if (value === undefined) return [] // نسخ قديمة قبل إضافة السجل
  if (!Array.isArray(value)) throw new Error('سجل حذف المشاريع غير صالح — راجع النسخة قبل الاستعادة')
  const ids = new Set<number>()
  return value.map((row: unknown) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('سجل حذف مشروع غير صالح — راجع النسخة')
    const record = row as Record<string, unknown>
    if (!Number.isSafeInteger(record.id) || (record.id as number) <= 0 || ids.has(record.id as number)) throw new Error('معرف مشروع محذوف غير صالح أو مكرر — راجع النسخة')
    ids.add(record.id as number)
    return record as Deletion
  })
}

// سجلات JSON الحقيقية لا تحتوي دورات؛ نقارن المفاتيح دون الاعتماد على ترتيبها.
function sameJson(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((item, index) => sameJson(item, right[index]))
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) || Array.isArray(right)) return false
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>
  const keys = Object.keys(a).filter(key => a[key] !== undefined).sort()
  const otherKeys = Object.keys(b).filter(key => b[key] !== undefined).sort()
  return keys.length === otherKeys.length && keys.every((key, index) => key === otherKeys[index] && sameJson(a[key], b[key]))
}

function referencesDeletedId(value: unknown, deleted: ReadonlySet<number>): boolean {
  if (typeof value === 'number') return deleted.has(value)
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const id = Number(value)
    return Number.isSafeInteger(id) && deleted.has(id)
  }
  return false
}

function refersToDeleted(value: unknown, deleted: ReadonlySet<number>, depth = 0): boolean {
  if (value == null) return false
  if (depth > 32) return true // بنية عميقة لا يمكن مراجعتها بأمان
  if (typeof value === 'string') {
    const trimmed = value.trimStart()
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false
    // قد يكون الرابط داخل JSON متداخل ومهروباً؛ افحص البنية بعد فكها
    // بدل البحث النصي عن مفتاح لا يظهر حرفياً في الطبقة الخارجية.
    try { return refersToDeleted(JSON.parse(value), deleted, depth + 1) } catch { return /projectId|sourceId/.test(value) }
  }
  if (Array.isArray(value)) return value.some(child => refersToDeleted(child, deleted, depth + 1))
  if (typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  if (referencesDeletedId(row.projectId, deleted)) return true
  if ((row.source === 'project' || row.sourceType === 'client_advance') && referencesDeletedId(row.sourceId, deleted)) return true
  return Object.values(row).some(child => refersToDeleted(child, deleted, depth + 1))
}

/**
 * يمنع إسقاط سجل حذف محلي أو إحياء مشروع/رابط ضمن لقطة واردة. لا يُدمج
 * التاريخ ولا يُختلق، ولا يضمن أن الحالة المحلية آخر حالة على الأجهزة الأخرى.
 */
export function assertProjectDeletionSnapshotSafe(current: Snapshot, incoming: Snapshot): void {
  const existing = deletions(current)
  const incomingRecords = deletions(incoming)
  const incomingById = new Map(incomingRecords.map(row => [row.id, row]))
  for (const record of existing) {
    const candidate = incomingById.get(record.id)
    if (!candidate || !sameJson(record, candidate)) throw new Error(`النسخة تسقط أو تغيّر سجل حذف المشروع #${record.id} — أوقف الاستعادة وراجع السجل`)
  }
  const deleted = new Set(incomingRecords.map(row => row.id))
  if (!deleted.size) return
  if (incoming.projects != null && !Array.isArray(incoming.projects)) throw new Error('قائمة المشاريع في النسخة غير صالحة — راجع السجل')
  if (Array.isArray(incoming.projects) && incoming.projects.some(row => row && typeof row === 'object' && referencesDeletedId((row as { id?: unknown }).id, deleted))) throw new Error('النسخة تعيد مشروعاً محذوفاً — راجع السجل قبل الاستعادة')
  for (const [key, value] of Object.entries(incoming)) {
    if (['projects', 'projectDeletionRecords', 'quotationDeletionRecords', 'surveyDeletionRecords', 'auditLog'].includes(key) || !Array.isArray(value)) continue
    const rows = key === 'quotations' ? value.filter(row => !row || typeof row !== 'object' || !(row as { deletedAt?: unknown }).deletedAt) : value
    if (refersToDeleted(rows, deleted)) throw new Error('النسخة تعيد مستنداً مرتبطاً بمشروع محذوف — راجع السجل قبل الاستعادة')
  }
}
