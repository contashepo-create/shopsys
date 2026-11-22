import { isValidExpiryDate } from './batches.ts'
import { FinancialDataReviewError } from './financialDataReview.ts'
import { assertBalanced, type JournalEntry, type JournalLine } from './ledger.ts'
import { addMinor } from './money.ts'
import { monthLabelAr } from './payroll.ts'
import { isPayrollProjectSnapshotReadable } from './payrollProjectAllocation.ts'
import { buildSlipAccrualLines, type PayrollSlip } from './payrollSlips.ts'

export interface PayrollProjectCostRow {
  slipId: number
  slipNumber: string
  date: string
  projectId: number
  amountMinor: number
  basisPoints: number
  journalEntryId: number
}

type Inputs = {
  projectId: number
  asOf: string
  slips: readonly PayrollSlip[]
  visibleSlips: readonly PayrollSlip[]
  journal: readonly JournalEntry[]
  visibleJournal: readonly JournalEntry[]
  payrollRuns: readonly { id: number; month?: string; lines?: readonly { employeeId: number }[] }[]
  projectCosts: readonly { journalEntryId: number }[]
}

/**
 * يتحقق من قيد استحقاق مجموعة قسائم كاملة ومن أدلة إلغائها قبل قراءة تكلفتها.
 * لا يثبت حدوث المشاركة فعلياً أو كل تسويات 5102 المستقلة أو سلامة الأجهزة.
 * يمنع الاحتساب إذا كان أي قيد استحقاق مرتبطاً أيضاً ببند projectCosts.
 */
export function checkedPayrollProjectCosts(input: Inputs): PayrollProjectCostRow[] {
  const fail = (): never => { throw new FinancialDataReviewError('توزيع رواتب المشاريع', 'لقطة القسيمة أو قيدها أو دليل إلغائها غير مطابق أو غير ظاهر') }
  if (!Number.isSafeInteger(input.projectId) || input.projectId <= 0 || !isValidExpiryDate(input.asOf)) return fail()
  const relevant: PayrollSlip[] = []
  for (const slip of input.visibleSlips) {
    if (slip.projectAllocation == null) continue
    if (!isPayrollProjectSnapshotReadable(slip.projectAllocation, slip)) return fail()
    if (slip.projectAllocation.projects.some(project => project.projectId === input.projectId)) relevant.push(slip)
  }
  return checkedPayrollGroups(input, relevant)
}

/** يفحص جميع القسائم السابقة ومجموعاتها قبل إصدار بديل، حتى لو لم تُوزع على مشروع. */
export function assertPayrollReplacementHistory(input: Omit<Inputs, 'projectId'> & { priorSlipIds: readonly number[] }): void {
  const fail = (): never => { throw new FinancialDataReviewError('تاريخ قسائم الرواتب', 'القسيمة السابقة أو إلغاؤها غير مثبت') }
  if (!isValidExpiryDate(input.asOf)) return fail()
  const prior = input.priorSlipIds.map(id => {
    const matches = input.slips.filter(slip => slip.id === id)
    if (matches.length !== 1 || matches[0].status !== 'cancelled' || !Number.isSafeInteger(matches[0].accrualEntryId) || !Number.isSafeInteger(matches[0].cancellationEntryId) || matches[0].cancellationEntryId! <= matches[0].accrualEntryId) return fail()
    return matches[0]
  })
  checkedPayrollGroups({ ...input, projectId: 0 }, prior)
}

function checkedPayrollGroups(input: Inputs, relevant: readonly PayrollSlip[]): PayrollProjectCostRow[] {
  const fail = (): never => { throw new FinancialDataReviewError('توزيع رواتب المشاريع', 'لقطة القسيمة أو قيدها أو دليل إلغائها غير مطابق أو غير ظاهر') }
  const visibleIds = new Set(input.visibleSlips.map(slip => slip.id))
  const visibleEntryIds = new Set(input.visibleJournal.map(entry => entry.id))
  const runIds = new Set(relevant.map(slip => slip.runId))
  const result: PayrollProjectCostRow[] = []
  try {
    for (const runId of runIds) {
      if (!Number.isSafeInteger(runId) || runId <= 0 || input.payrollRuns.some(run => run.id === runId)) return fail()
      const group = input.slips.filter(slip => slip.runId === runId)
      if (!group.length) return fail()
      const employeeIds = new Set<number>(), slipIds = new Set<number>(), numbers = new Set<string>()
      const entryId = group[0].accrualEntryId, day = group[0].accruedAt?.slice(0, 10) ?? '', month = group[0].month
      if (!Number.isSafeInteger(entryId) || entryId <= 0 || !isValidExpiryDate(day) || day > input.asOf || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return fail()
      for (const slip of group) {
        if (!Number.isSafeInteger(slip.id) || slip.id <= 0 || slipIds.has(slip.id) || input.slips.filter(row => row.id === slip.id).length !== 1 || !visibleIds.has(slip.id) || !Number.isSafeInteger(slip.employeeId) || slip.employeeId <= 0 || employeeIds.has(slip.employeeId) || typeof slip.slipNumber !== 'string' || !slip.slipNumber.trim() || numbers.has(slip.slipNumber) || typeof slip.employeeName !== 'string' || !slip.employeeName.trim()) return fail()
        slipIds.add(slip.id); employeeIds.add(slip.employeeId); numbers.add(slip.slipNumber)
        // افحص كل مجموعات القسائم لنفس الموظف والشهر، لا الحالة المجردة.
        // أرقام القيود هنا ترتب المنشأ المحلي: لا بد أن يسبق قيد الإلغاء
        // قيد استحقاق البديل، وإلا لا يثبت أن الاستحقاقين لم يتداخلا.
        const history = input.slips.filter(other => other.employeeId === slip.employeeId && other.month === slip.month)
          .sort((a, b) => a.accrualEntryId - b.accrualEntryId)
        if (history.filter(other => other.status !== 'cancelled').length > 1) return fail()
        for (let i = 0; i < history.length; i++) {
          const current = history[i]
          runIds.add(current.runId)
          if (i + 1 === history.length) continue
          const next = history[i + 1]
          const cancellation = input.journal.find(row => row.id === current.cancellationEntryId)
          if (current.status !== 'cancelled' || !Number.isSafeInteger(current.accrualEntryId) || !Number.isSafeInteger(current.cancellationEntryId) || !Number.isSafeInteger(next.accrualEntryId) || current.accrualEntryId >= current.cancellationEntryId! || current.cancellationEntryId! >= next.accrualEntryId || !cancellation || !isValidExpiryDate(cancellation.date) || cancellation.date > (next.accruedAt?.slice(0, 10) ?? '')) return fail()
        }
        if (input.payrollRuns.some(run => run.month === slip.month && (!Array.isArray(run.lines) || run.lines.some(line => line.employeeId === slip.employeeId)))) return fail()
        if (slip.accrualEntryId !== entryId || slip.accruedAt?.slice(0, 10) !== day || slip.month !== month || !['accrued', 'paid', 'cancelled'].includes(slip.status)) return fail()
        if (![slip.grossMinor, slip.allowancesMinor, slip.deductionsMinor, slip.advanceMinor, slip.netMinor].every(value => Number.isSafeInteger(value) && value >= 0)) return fail()
        if (addMinor(slip.grossMinor, slip.allowancesMinor) - addMinor(slip.deductionsMinor, slip.advanceMinor) !== slip.netMinor) return fail()
        if (slip.projectAllocation != null && !isPayrollProjectSnapshotReadable(slip.projectAllocation, slip)) return fail()
      }
      const entries = input.journal.filter(entry => entry.id === entryId), entry = entries[0]
      if (entries.length !== 1 || !visibleEntryIds.has(entryId) || entry.sourceType !== 'payroll' || entry.sourceId !== runId || (entry.sourceCollection != null && entry.sourceCollection !== 'payrollSlips') || entry.date !== day || entry.reversedByEntryId != null || entry.reversesEntryId != null || input.journal.some(row => row.reversesEntryId === entryId) || !Array.isArray(entry.lines) || input.projectCosts.some(cost => cost.journalEntryId === entryId)) return fail()
      assertBalanced(entry.lines)
      const signature = (line: JournalLine) => JSON.stringify([line.accountCode, line.debit, line.credit, line.note ?? ''])
      const actual = entry.lines.map(signature).sort()
      const expected = buildSlipAccrualLines(group, monthLabelAr(month)).map(signature).sort()
      if (JSON.stringify(actual) !== JSON.stringify(expected)) return fail()
      const cancellationIds = new Set<number>()
      for (const slip of group) {
        if (slip.status !== 'cancelled') {
          if (slip.cancellationEntryId != null) return fail()
          continue
        }
        const cancelId = slip.cancellationEntryId
        if (!Number.isSafeInteger(cancelId) || (cancelId as number) <= 0 || cancellationIds.has(cancelId!) || input.slips.filter(row => row.cancellationEntryId === cancelId).length !== 1 || (slip.payments?.length ?? 0) > 0 || slip.paidEntryId != null) return fail()
        cancellationIds.add(cancelId!)
        const matches = input.journal.filter(row => row.id === cancelId), cancel = matches[0]
        if (matches.length !== 1 || !visibleEntryIds.has(cancelId!) || cancel.sourceType !== 'payroll' || cancel.sourceId !== runId || (cancel.sourceCollection != null && cancel.sourceCollection !== 'payrollSlips') || cancel.description !== `إلغاء قسيمة ${slip.slipNumber}` || !isValidExpiryDate(cancel.date) || cancel.date < day || cancel.date > input.asOf || cancel.reversedByEntryId != null || cancel.reversesEntryId != null || input.journal.some(row => row.reversesEntryId === cancelId) || !Array.isArray(cancel.lines) || input.projectCosts.some(cost => cost.journalEntryId === cancelId)) return fail()
        assertBalanced(cancel.lines)
        const accountSignature = (line: JournalLine) => JSON.stringify([line.accountCode, line.debit, line.credit])
        const expectedCancel = [
          { accountCode: '2104', debit: slip.netMinor, credit: 0 },
          ...(slip.advanceMinor > 0 ? [{ accountCode: '1107', debit: slip.advanceMinor, credit: 0 }] : []),
          { accountCode: '5102', debit: 0, credit: addMinor(slip.netMinor, slip.advanceMinor) },
        ].map(accountSignature).sort()
        if (JSON.stringify(cancel.lines.map(accountSignature).sort()) !== JSON.stringify(expectedCancel) || !cancel.lines.some(line => line.accountCode === '2104' && line.note?.startsWith(`إلغاء ${slip.slipNumber} — `))) return fail()
      }
      // لا نغفل إلغاءً يتيماً أو قيداً آخر يغيّر 5102 لنفس المصدر.
      if (input.journal.some(row => row.sourceType === 'payroll' && row.sourceId === runId && row.id !== entryId && Array.isArray(row.lines) && row.lines.some(line => line.accountCode === '5102' && (line.debit !== 0 || line.credit !== 0)) && !cancellationIds.has(row.id))) return fail()
      for (const slip of group) {
        if (slip.status === 'cancelled' || !slip.projectAllocation) continue
        for (const project of slip.projectAllocation.projects) if (project.projectId === input.projectId) result.push({ slipId: slip.id, slipNumber: slip.slipNumber, date: day, projectId: project.projectId, amountMinor: project.amountMinor, basisPoints: project.basisPoints, journalEntryId: entryId })
      }
    }
  } catch (error) {
    if (error instanceof FinancialDataReviewError) throw error
    return fail()
  }
  return result
}
