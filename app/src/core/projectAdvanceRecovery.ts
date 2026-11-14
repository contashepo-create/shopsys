import type { JournalEntry } from './ledger.ts'
import { assertBalanced } from './ledger.ts'
import { isValidExpiryDate } from './batches.ts'
import { FinancialDataReviewError } from './financialDataReview.ts'
import { planAdvanceCredit, type AdvanceCreditEvidence } from './projectAdvanceCreditPlan.ts'

export interface ProjectAdvanceAllocation { advanceId: number; journalEntryId: number; amountMinor: number }
export interface ProjectAdvanceRecord { id: number; projectId: number; date: string; amountMinor: number; recoveredMinor: number; journalEntryId: number }
interface RecoveryExtract {
  id: number; projectId: number; journalEntryId: number; date: string
  advanceRecoveryMinor?: number; advanceAllocations?: readonly ProjectAdvanceAllocation[]
  totals?: { dueMinor: number }
  quantityCreditVersion?: number
  refunds?: readonly { journalEntryId: number; date: string; amountMinor: number; restoredAdvanceMinor?: number; restoredAdvanceAllocations?: readonly ProjectAdvanceAllocation[] }[]
}

/** تحقق من أرصدة المقدمات قبل الاعتماد عليها؛ السجل القديم بلا توزيع لا يُخترع له توزيع. */
export function assertAdvanceRecoveryBasis(projectId: number, advances: readonly ProjectAdvanceRecord[], extracts: readonly RecoveryExtract[], journal: ReadonlyMap<number, JournalEntry>, treasuryCodes: ReadonlySet<string>, options?: { experimentalCreditReplay?: boolean }): void {
  const fail = (): never => { throw new FinancialDataReviewError('استرداد مقدمات المشروع', 'الدفعات أو تخصيصاتها لا تطابق قيودها') }
  const byId = new Map<number, ProjectAdvanceRecord>(), attributed = new Map<number, number>()
  let recovered = 0, lastId = 0, lastDate = '', lastEntryId = 0
  for (const a of advances) {
    const entry = journal.get(a.journalEntryId)
    if (a.projectId !== projectId || !Number.isSafeInteger(a.id) || a.id <= lastId || !isValidExpiryDate(a.date) || a.date < lastDate || !Number.isSafeInteger(a.journalEntryId) || a.journalEntryId <= lastEntryId || !Number.isSafeInteger(a.amountMinor) || a.amountMinor <= 0 || !Number.isSafeInteger(a.recoveredMinor) || a.recoveredMinor < 0 || a.recoveredMinor > a.amountMinor || !entry || entry.date !== a.date || entry.sourceType !== 'client_advance' || entry.sourceId !== projectId || (entry.sourceCollection != null && entry.sourceCollection !== 'clientAdvances') || entry.reversedByEntryId != null || entry.reversesEntryId != null || !Array.isArray(entry.lines) || entry.lines.some(line => !Number.isSafeInteger(line.debit) || !Number.isSafeInteger(line.credit) || line.debit < 0 || line.credit < 0)) return fail()
    try { assertBalanced(entry.lines) } catch { return fail() }
    const debit = entry.lines.reduce((sum, line) => sum + line.debit, 0)
    const advanceCredit = entry.lines.filter(line => line.accountCode === '2109').reduce((sum, line) => sum + line.credit - line.debit, 0)
    if (!Number.isSafeInteger(debit) || debit !== a.amountMinor || advanceCredit !== a.amountMinor || entry.lines.some(line => line.debit > 0 && !treasuryCodes.has(line.accountCode))) return fail()
    byId.set(a.id, a)
    recovered += a.recoveredMinor
    if (!Number.isSafeInteger(recovered)) return fail()
    lastId = a.id; lastDate = a.date; lastEntryId = a.journalEntryId
  }
  let claimed = 0, allAttributed = true
  for (const extract of extracts) {
    const value = extract.advanceRecoveryMinor ?? 0
    if (extract.projectId !== projectId || !Number.isSafeInteger(value) || value < 0) return fail()
    claimed += value
    if (!Number.isSafeInteger(claimed)) return fail()
    if (extract.advanceAllocations == null) { if (value) allAttributed = false; continue }
    if (!Array.isArray(extract.advanceAllocations) || (!value && extract.advanceAllocations.length)) return fail()
    let amount = 0
    const seen = new Set<number>()
    for (const row of extract.advanceAllocations) {
      if (!row || typeof row !== 'object') return fail()
      const a = byId.get(row.advanceId)
      if (!a || seen.has(row.advanceId) || row.journalEntryId !== a.journalEntryId || a.date > extract.date.slice(0, 10) || !Number.isSafeInteger(row.amountMinor) || row.amountMinor <= 0 || a.journalEntryId >= extract.journalEntryId) return fail()
      seen.add(row.advanceId)
      amount += row.amountMinor
      attributed.set(a.id, (attributed.get(a.id) ?? 0) + row.amountMinor)
      if (!Number.isSafeInteger(amount) || !Number.isSafeInteger(attributed.get(a.id))) return fail()
    }
    if (amount !== value) return fail()
  }
  // لا تغير الإشعارات تخصيص المستخلص الأصلي. يحتفظ التدقيق التجريبي
  // بحركات العكس لإعادة تشغيلها مع الاستردادات بترتيب القيد أدناه.
  const creditExtracts = extracts.filter(row => row.quantityCreditVersion === 3)
  const restoredByAdvance = new Map<number, number>()
  const creditEvents: { journalEntryId: number; date: string; allocations: readonly ProjectAdvanceAllocation[] }[] = []
  if (creditExtracts.length) {
    // تجريب تدقيق التسلسل لا يفعّل ترحيل الإشعار ولا يجعل التقارير الأخرى
    // متوافقة معه. المسارات الفعلية ترفض النسخة الجديدة حتى اكتمالها.
    if (!options?.experimentalCreditReplay || !allAttributed) return fail()
    const usedCreditEntries = new Set<number>()
    for (const extract of creditExtracts) {
      if (!extract.totals || !Array.isArray(extract.advanceAllocations) || !Array.isArray(extract.refunds) || !extract.refunds.length || (extract.advanceRecoveryMinor ?? 0) <= 0) return fail()
      const previous: AdvanceCreditEvidence[] = []
      let previousId = extract.journalEntryId, previousDate = extract.date.slice(0, 10)
      for (const refund of extract.refunds) {
        if (!refund || !Number.isSafeInteger(refund.journalEntryId) || refund.journalEntryId <= previousId || usedCreditEntries.has(refund.journalEntryId) || !isValidExpiryDate(refund.date) || refund.date < previousDate || !Number.isSafeInteger(refund.restoredAdvanceMinor) || !Array.isArray(refund.restoredAdvanceAllocations)) return fail()
        usedCreditEntries.add(refund.journalEntryId)
        const entry = journal.get(refund.journalEntryId)
        if (!entry || entry.sourceType !== 'project_extract' || entry.sourceId !== extract.id || (entry.sourceCollection != null && entry.sourceCollection !== 'projectExtracts') || entry.date !== refund.date || entry.reversedByEntryId != null || entry.reversesEntryId != null || !Array.isArray(entry.lines)) return fail()
        try { assertBalanced(entry.lines) } catch { return fail() }
        const advanceLines = entry.lines.filter(line => line.accountCode === '2109')
        const credit2109 = advanceLines.reduce((sum, line) => sum + line.credit, 0)
        if (!Number.isSafeInteger(credit2109) || advanceLines.some(line => line.debit !== 0) || credit2109 !== refund.restoredAdvanceMinor) return fail()
        let plan: ReturnType<typeof planAdvanceCredit>
        try { plan = planAdvanceCredit({ dueMinor: extract.totals.dueMinor, recoveryMinor: extract.advanceRecoveryMinor!, allocations: extract.advanceAllocations, previous, amountMinor: refund.amountMinor, restoredAdvanceMinor: refund.restoredAdvanceMinor! }) } catch { return fail() }
        if (plan.allocations.length !== refund.restoredAdvanceAllocations.length || plan.allocations.some((row, index) => row.advanceId !== refund.restoredAdvanceAllocations![index]?.advanceId || row.journalEntryId !== refund.restoredAdvanceAllocations![index]?.journalEntryId || row.amountMinor !== refund.restoredAdvanceAllocations![index]?.amountMinor)) return fail()
        for (const row of plan.allocations) {
          restoredByAdvance.set(row.advanceId, (restoredByAdvance.get(row.advanceId) ?? 0) + row.amountMinor)
          if (!Number.isSafeInteger(restoredByAdvance.get(row.advanceId))) return fail()
          claimed -= row.amountMinor
          attributed.set(row.advanceId, (attributed.get(row.advanceId) ?? 0) - row.amountMinor)
        }
        creditEvents.push({ journalEntryId: refund.journalEntryId, date: refund.date, allocations: plan.allocations })
        previous.push({ amountMinor: refund.amountMinor, restoredAdvanceMinor: refund.restoredAdvanceMinor!, allocations: refund.restoredAdvanceAllocations })
        previousId = refund.journalEntryId; previousDate = refund.date
      }
    }
  }
  if (claimed !== recovered) return fail()
  for (const a of advances) {
    const known = attributed.get(a.id) ?? 0
    if (known < 0 || known > a.recoveredMinor || (allAttributed && known !== a.recoveredMinor)) return fail()
  }
  // إذا كان التاريخ كله موثقاً، أعد تشغيل FIFO حسب القيد الحالي؛ مجرد
  // تطابق المجاميع لا يكشف استبدال تخصيصَي مستخلصين بالقيمة نفسها.
  if (allAttributed) {
    const running = advances.map(advance => ({ ...advance, recoveredMinor: 0 }))
    const recoveryExtracts = extracts.filter(row => (row.advanceRecoveryMinor ?? 0) > 0)
    if (creditExtracts.length) {
      // Replay only unambiguous journal events. The option remains experimental:
      // this does not validate the customer, retention, tax or cash side.
      const eventIds = new Set<number>(), extractIds = new Set<number>()
      const events: ({ kind: 'advance'; id: number; date: string } | { kind: 'recovery'; id: number; date: string; extract: RecoveryExtract } | { kind: 'credit'; id: number; date: string; allocations: readonly ProjectAdvanceAllocation[] })[] = []
      for (const advance of advances) events.push({ kind: 'advance', id: advance.journalEntryId, date: advance.date })
      for (const extract of recoveryExtracts) {
        const entry = journal.get(extract.journalEntryId), date = extract.date?.slice(0, 10)
        if (!Number.isSafeInteger(extract.id) || extract.id <= 0 || extractIds.has(extract.id) || !Number.isSafeInteger(extract.journalEntryId) || extract.journalEntryId <= 0 || !isValidExpiryDate(date) || !entry || entry.date !== date || entry.sourceType !== 'project_extract' || entry.sourceId !== extract.id || (entry.sourceCollection != null && entry.sourceCollection !== 'projectExtracts') || entry.reversedByEntryId != null || entry.reversesEntryId != null || !Array.isArray(entry.lines)) return fail()
        extractIds.add(extract.id)
        try { assertBalanced(entry.lines) } catch { return fail() }
        const lines = entry.lines.filter(line => line.accountCode === '2109')
        if (lines.some(line => !Number.isSafeInteger(line.debit) || !Number.isSafeInteger(line.credit) || line.credit !== 0 || line.debit < 0) || lines.reduce((sum, line) => sum + line.debit, 0) !== extract.advanceRecoveryMinor) return fail()
        events.push({ kind: 'recovery', id: extract.journalEntryId, date, extract })
      }
      for (const credit of creditEvents) events.push({ kind: 'credit', id: credit.journalEntryId, date: credit.date, allocations: credit.allocations })
      events.sort((a, b) => a.id - b.id)
      let lastEventDate = ''
      for (const event of events) {
        if (eventIds.has(event.id) || event.date < lastEventDate) return fail()
        eventIds.add(event.id); lastEventDate = event.date
        if (event.kind === 'advance') continue
        if (event.kind === 'credit') {
          for (const part of event.allocations) {
            const advance = running.find(row => row.id === part.advanceId)
            if (!advance || advance.journalEntryId !== part.journalEntryId || advance.recoveredMinor < part.amountMinor) return fail()
            advance.recoveredMinor -= part.amountMinor
          }
          continue
        }
        let left = event.extract.advanceRecoveryMinor!
        const expected: ProjectAdvanceAllocation[] = []
        for (const advance of running) {
          if (advance.journalEntryId >= event.id || advance.date > event.date || left === 0) continue
          const take = Math.min(left, advance.amountMinor - advance.recoveredMinor)
          if (take <= 0) continue
          advance.recoveredMinor += take; left -= take
          expected.push({ advanceId: advance.id, journalEntryId: advance.journalEntryId, amountMinor: take })
        }
        const actual = event.extract.advanceAllocations
        if (left || !actual || expected.length !== actual.length || expected.some((row, index) => row.advanceId !== actual[index]?.advanceId || row.journalEntryId !== actual[index]?.journalEntryId || row.amountMinor !== actual[index]?.amountMinor)) return fail()
      }
      if (running.some((row, index) => row.recoveredMinor !== advances[index].recoveredMinor)) return fail()
    } else {
      for (const extract of [...recoveryExtracts].sort((a, b) => a.journalEntryId - b.journalEntryId)) {
        let left = extract.advanceRecoveryMinor!
        const expected: ProjectAdvanceAllocation[] = []
        for (const advance of running) {
          if (advance.journalEntryId >= extract.journalEntryId || advance.date > extract.date.slice(0, 10) || left === 0) continue
          const take = Math.min(left, advance.amountMinor - advance.recoveredMinor)
          if (take <= 0) continue
          advance.recoveredMinor += take; left -= take
          expected.push({ advanceId: advance.id, journalEntryId: advance.journalEntryId, amountMinor: take })
        }
        const actual = extract.advanceAllocations
        if (left || !actual || expected.length !== actual.length || expected.some((row, index) => row.advanceId !== actual[index]?.advanceId || row.journalEntryId !== actual[index]?.journalEntryId || row.amountMinor !== actual[index]?.amountMinor)) return fail()
      }
      if (running.some((row, index) => row.recoveredMinor !== advances[index].recoveredMinor)) return fail()
    }
  }
}

/** يوزع المتاح بالأقدم، ويعيد نسخة وتفصيلاً للتوثيق؛ لا يعدّل البيانات المدخلة. */
export function allocateProjectAdvance(projectId: number, advances: readonly ProjectAdvanceRecord[], amount: number): { advances: ProjectAdvanceRecord[]; allocations: ProjectAdvanceAllocation[] } {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('مبلغ استرداد المقدمة غير صالح')
  let left = amount
  const allocations: ProjectAdvanceAllocation[] = []
  const updated = advances.map(advance => {
    if (advance.projectId !== projectId || left === 0) return advance
    const take = Math.min(left, advance.amountMinor - advance.recoveredMinor)
    if (!Number.isSafeInteger(take) || take < 0) throw new Error('رصيد الدفعة غير صالح — راجع البيانات')
    if (!take) return advance
    left -= take
    allocations.push({ advanceId: advance.id, journalEntryId: advance.journalEntryId, amountMinor: take })
    return { ...advance, recoveredMinor: advance.recoveredMinor + take }
  })
  if (left !== 0) throw new Error('الاسترداد أكبر من رصيد الدفعات المقدمة')
  return { advances: updated, allocations }
}

/** عكس التوزيع المثبت فقط؛ السجلات التاريخية المتعددة بلا توزيع تحتاج مراجعة. */
export function undoProjectAdvanceRecovery(projectId: number, advances: readonly ProjectAdvanceRecord[], extracts: readonly RecoveryExtract[], target: RecoveryExtract): ProjectAdvanceRecord[] {
  const amount = target.advanceRecoveryMinor ?? 0
  if (!amount) return [...advances]
  if (extracts.some(row => row.id !== target.id && (row.advanceRecoveryMinor ?? 0) > 0 && row.journalEntryId > target.journalEntryId)) throw new Error('يوجد استرداد مقدمة أحدث — راجعه أولاً قبل تعديل المستخلص')
  const own = advances.filter(row => row.projectId === projectId)
  const hasLegacy = extracts.some(row => (row.advanceRecoveryMinor ?? 0) > 0 && row.advanceAllocations == null)
  if (hasLegacy && own.length !== 1) throw new Error('توزيع استرداد المقدمات التاريخي غير مثبت — راجع الدفعات قبل تعديل المستخلص')
  const allocations = target.advanceAllocations ?? (own.length === 1 ? [{ advanceId: own[0].id, journalEntryId: own[0].journalEntryId, amountMinor: amount }] : [])
  if (allocations.reduce((sum, row) => sum + row.amountMinor, 0) !== amount) throw new Error('توزيع استرداد المقدمة غير مكتمل — راجع المستخلص')
  const byId = new Map(allocations.map(row => [row.advanceId, row]))
  return advances.map(advance => {
    const allocation = byId.get(advance.id)
    if (!allocation || advance.projectId !== projectId) return advance
    if (advance.journalEntryId !== allocation.journalEntryId || advance.recoveredMinor < allocation.amountMinor) throw new Error('توزيع استرداد المقدمة لا يطابق الدفعة — راجع البيانات')
    return { ...advance, recoveredMinor: advance.recoveredMinor - allocation.amountMinor }
  })
}
