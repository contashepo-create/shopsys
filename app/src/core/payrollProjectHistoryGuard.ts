type Row = Record<string, unknown>

function equal(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => equal(value, b[index]))
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  const x = a as Row, y = b as Row
  const keys = Object.keys(x).filter(key => x[key] !== undefined).sort(), other = Object.keys(y).filter(key => y[key] !== undefined).sort()
  return keys.length === other.length && keys.every((key, i) => key === other[i] && equal(x[key], y[key]))
}

/**
 * يحفظ لقطة تخصيص راتب قسيمة قائمة ومصدرها من تغييرات النسخ الواردة.
 * لا يثبت صحة الإلغاء أو القيد أو الإضافة الواردة، ولا ينشئ تخصيصاً لقديم.
 */
export function assertPayrollProjectHistoryPreserved(current: Row, incoming: Row): void {
  const old = current.payrollSlips
  if (!Array.isArray(old)) return
  const next = incoming.payrollSlips
  // القسيمة السابقة بلا توزيع قد تكون دليلاً لإلغاء سبق بديلة موزعة.
  // نحمي كل قسائم الموظف والشهر اللذين يظهر فيهما توزيع في إحدى اللقطتين.
  const allocatedPairs = [...old, ...(Array.isArray(next) ? next : [])]
    .filter(row => row && typeof row === 'object' && !Array.isArray(row) && row.projectAllocation != null)
    .map(row => [row.employeeId, row.month] as const)
  const inAllocatedHistory = (row: Row) => allocatedPairs.some(([employeeId, month]) => equal(employeeId, row.employeeId) && equal(month, row.month))
  const protectedIds = new Set(old.filter(row => row && typeof row === 'object' && !Array.isArray(row) && inAllocatedHistory(row)).map(row => row.id))
  if (!Array.isArray(next)) {
    if (protectedIds.size) throw new Error('النسخة تسقط قسائم بها توزيع رواتب موثق')
    return
  }
  const oldById = new Map<unknown, Row[]>(), nextById = new Map<unknown, Row[]>()
  for (const [rows, index] of [[old, oldById], [next, nextById]] as const) {
    for (const value of rows) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const row = value as Row
      const list = index.get(row.id) ?? []
      list.push(row); index.set(row.id, list)
    }
  }
  for (const [id, beforeRows] of oldById) {
    const afterRows = nextById.get(id) ?? []
    const touchesAllocation = beforeRows.some(row => inAllocatedHistory(row)) || afterRows.some(row => inAllocatedHistory(row))
    if (!touchesAllocation) continue
    if (!Number.isSafeInteger(id) || (id as number) <= 0 || beforeRows.length !== 1 || afterRows.length !== 1) throw new Error('قسيمة توزيع الرواتب غير فريدة أو سقطت من النسخة')
    const before = beforeRows[0], after = afterRows[0]
    if (!equal(before.projectAllocation, after.projectAllocation)) throw new Error('النسخة تسقط أو تغير توزيع الرواتب الموثق أو تضيفه لقسيمة قديمة')
    for (const key of ['id', 'branchId', 'slipNumber', 'runId', 'month', 'employeeId', 'employeeName', 'grossMinor', 'allowancesMinor', 'deductionsMinor', 'advanceMinor', 'netMinor', 'accrualEntryId', 'accruedAt', 'createdAt']) {
      if (!equal(before[key], after[key])) throw new Error('النسخة تغير أساس قسيمة توزيع الرواتب — راجع الأدلة')
    }
    if (before.cancellationEntryId != null && !equal(before.cancellationEntryId, after.cancellationEntryId)) throw new Error('النسخة تسقط أو تغيّر مرجع إلغاء قسيمة توزيع الرواتب')
    if (before.status === 'cancelled' && after.status !== 'cancelled') throw new Error('النسخة تعيد قسيمة توزيع رواتب ملغاة دون مراجعة')
  }
}
