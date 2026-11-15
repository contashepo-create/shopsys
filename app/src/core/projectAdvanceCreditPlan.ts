import type { ProjectAdvanceAllocation } from './projectAdvanceRecovery.ts'

/** نموذج غير مرحّل: لا يثبت قيوداً ولا يغيّر أرصدة المقدمات أو التحصيل. */
export interface AdvanceCreditEvidence {
  amountMinor: number
  restoredAdvanceMinor: number
  allocations: readonly ProjectAdvanceAllocation[]
}

/**
 * توزيع مقترح لعكس الاسترداد المثبت بترتيب عكسي لتخصيص المستخلص الأصلي.
 * مبلغ المقدمة يحدده المستخدم، ولا يُستنتج من النسبة أو من كميات قديمة.
 * يجب على المستدعي تدقيق المستخلص والدفعات والقيود والتواريخ مستقلاً؛
 * هذه الدالة لا تدقق الدفتر أو تخصيصات المستخلصات الأخرى أو التحصيلات.
 */
export function planAdvanceCredit(args: {
  dueMinor: number
  recoveryMinor: number
  allocations: readonly ProjectAdvanceAllocation[]
  previous: readonly AdvanceCreditEvidence[]
  amountMinor: number
  restoredAdvanceMinor: number
}): { minRestoredMinor: number; maxRestoredMinor: number; customerMinor: number; allocations: ProjectAdvanceAllocation[] } {
  const fail = (): never => { throw new Error('توزيع المقدمة المعادة غير صالح أو غير مثبت — راجع المستخلص والإشعارات') }
  const nonnegative = (n: number) => Number.isSafeInteger(n) && n >= 0
  if (!nonnegative(args.dueMinor) || !nonnegative(args.recoveryMinor) || args.recoveryMinor > args.dueMinor || !Array.isArray(args.allocations) || !Array.isArray(args.previous)) return fail()
  const rows = args.allocations.map(row => {
    if (!row || !Number.isSafeInteger(row.advanceId) || row.advanceId <= 0 || !Number.isSafeInteger(row.journalEntryId) || row.journalEntryId <= 0 || !Number.isSafeInteger(row.amountMinor) || row.amountMinor <= 0) return fail()
    return { ...row, left: row.amountMinor }
  })
  if (new Set(rows.map(row => row.advanceId)).size !== rows.length || new Set(rows.map(row => row.journalEntryId)).size !== rows.length) return fail()
  let original = 0
  for (const row of rows) {
    original += row.amountMinor
    if (!Number.isSafeInteger(original)) return fail()
  }
  if (original !== args.recoveryMinor) return fail()
  let credited = 0, restored = 0
  const apply = (amount: number, value: number): { min: number; max: number; allocations: ProjectAdvanceAllocation[] } => {
    if (!nonnegative(amount) || amount <= 0 || !nonnegative(value) || amount > args.dueMinor - credited) return fail()
    const remainingRecovery = args.recoveryMinor - restored
    const remainingDue = args.dueMinor - credited - amount
    const min = Math.max(0, remainingRecovery - remainingDue)
    const max = Math.min(amount, remainingRecovery)
    if (value < min || value > max) return fail()
    let left = value
    const allocations: ProjectAdvanceAllocation[] = []
    for (let i = rows.length - 1; i >= 0 && left > 0; i--) {
      const row = rows[i], take = Math.min(left, row.left)
      if (take) { allocations.push({ advanceId: row.advanceId, journalEntryId: row.journalEntryId, amountMinor: take }); row.left -= take; left -= take }
    }
    if (left) return fail()
    credited += amount; restored += value
    return { min, max, allocations }
  }
  for (const row of args.previous) {
    if (!row || !Array.isArray(row.allocations)) return fail()
    const expected = apply(row.amountMinor, row.restoredAdvanceMinor).allocations
    if (row.allocations.length !== expected.length || expected.some((part, i) => part.advanceId !== row.allocations[i]?.advanceId || part.journalEntryId !== row.allocations[i]?.journalEntryId || part.amountMinor !== row.allocations[i]?.amountMinor)) return fail()
  }
  const result = apply(args.amountMinor, args.restoredAdvanceMinor)
  return { minRestoredMinor: result.min, maxRestoredMinor: result.max, customerMinor: args.amountMinor - args.restoredAdvanceMinor, allocations: result.allocations }
}
