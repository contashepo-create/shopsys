import { assertJournalHistoryPreserved } from './ledgerHistoryGuard.ts'
import { assertProjectExtractOriginalIntegrity } from './projectExtractRefundIntegrity.ts'
import type { JournalEntry } from './ledger.ts'

type Row = Record<string, unknown>

/** يتحقق فقط من انتقال ختامي محلي بين قيديه؛ لا يعيد بناء أساس كل تعديل وسيط. */
function assertFinalEditEvidence(old: Row, candidate: Row, current: Row, incoming: Row): void {
  const fail = (): never => { throw new Error(`تسلسل تعديل المستخلص الختامي #${String(old.id)} غير مثبت — راجع الأدلة`) }
  if (!Number.isSafeInteger(old.journalEntryId) || (old.journalEntryId as number) <= 0 || !Number.isSafeInteger(candidate.journalEntryId) || (candidate.journalEntryId as number) <= 0 || !Array.isArray(current.journal) || !Array.isArray(incoming.journal)) return fail()
  const previous = current.journal as JournalEntry[], next = incoming.journal as JournalEntry[]
  try { assertJournalHistoryPreserved(previous, next) } catch { return fail() }
  const oldEntries = previous.filter(row => row?.id === old.journalEntryId)
  if (oldEntries.length !== 1 || oldEntries[0].sourceType !== 'project_extract' || oldEntries[0].sourceId !== old.id || oldEntries[0].reversedByEntryId != null || oldEntries[0].reversesEntryId != null) return fail()
  let entry = oldEntries[0], lastReversal: number | undefined
  const visited = new Set<number>()
  while (entry.id !== candidate.journalEntryId) {
    if (visited.has(entry.id)) return fail()
    visited.add(entry.id)
    const position = next.findIndex(row => row?.id === entry.id)
    const marked = next[position]
    const reversalPosition = next.findIndex(row => row?.id === marked?.reversedByEntryId)
    const reversal = next[reversalPosition], replacement = next[reversalPosition + 1]
    if (position < 0 || reversalPosition < previous.length || reversalPosition <= position || !reversal || !replacement || reversal.id >= Number.MAX_SAFE_INTEGER || replacement.id !== reversal.id + 1 || replacement.sourceType !== 'project_extract' || replacement.sourceId !== old.id || (replacement.sourceCollection != null && replacement.sourceCollection !== 'projectExtracts') || replacement.reversesEntryId != null || (replacement.branchId ?? null) !== (entry.branchId ?? null)) return fail()
    try { assertJournalHistoryPreserved([{ ...entry, reversedByEntryId: null }], [marked, reversal]) } catch { return fail() }
    lastReversal = reversal.id
    entry = replacement
  }
  if (lastReversal == null || candidate.editReversalEntryId !== lastReversal || entry.reversedByEntryId != null || typeof candidate.date !== 'string' || candidate.date.slice(0, 10) !== entry.date) return fail()
  try {
    assertProjectExtractOriginalIntegrity(candidate as unknown as Parameters<typeof assertProjectExtractOriginalIntegrity>[0], new Map(next.map(row => [row.id, row])))
  } catch { return fail() }
}

function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, i) => same(value, b[i]))
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  const x = a as Row, y = b as Row
  const keys = Object.keys(x).filter(key => x[key] !== undefined).sort(), other = Object.keys(y).filter(key => y[key] !== undefined).sort()
  return keys.length === other.length && keys.every((key, i) => key === other[i] && same(x[key], y[key]))
}

function rows(value: unknown, label: string): Row[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error(`${label} غير صالح — راجع الأدلة`)
  const ids = new Set<number>()
  return value.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} غير صالح — راجع الأدلة`)
    const row = value as Row
    if (!Number.isSafeInteger(row.id) || (row.id as number) <= 0 || ids.has(row.id as number)) throw new Error(`${label} يحتوي معرفاً غير صالح أو مكرراً`)
    ids.add(row.id as number)
    return row
  })
}

function value(row: Row, key: string): number {
  const amount = row[key] === undefined ? 0 : row[key]
  if (!Number.isSafeInteger(amount) || (amount as number) < 0) throw new Error('مبالغ إشعار المستخلص غير صالحة — راجع التاريخ')
  return amount as number
}

/** يفحص التخصيص الموثق دون اختلاق توزيع لسجل قديم لا يحفظه. */
function allocationTotals(projectId: number, advances: Row[], extracts: Row[]): { complete: boolean; amounts: Map<unknown, number> } {
  const byId = new Map(advances.filter(row => row.projectId === projectId).map(row => [row.id, row]))
  const amounts = new Map<unknown, number>()
  let complete = true
  for (const extract of extracts) {
    if (extract.projectId !== projectId) continue
    const recovery = extract.advanceRecoveryMinor === undefined ? 0 : extract.advanceRecoveryMinor
    if (!Number.isSafeInteger(recovery) || (recovery as number) < 0) throw new Error('استرداد المستخلص غير صالح — راجع التخصيص')
    const allocations = extract.advanceAllocations
    if (allocations == null) { if (recovery !== 0) complete = false; continue }
    if (!Array.isArray(allocations)) throw new Error('توزيع استرداد المقدمة غير صالح — راجع الأدلة')
    let total = 0
    const seen = new Set<unknown>()
    for (const value of allocations) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('توزيع استرداد المقدمة غير صالح — راجع الأدلة')
      const row = value as Row, advance = byId.get(row.advanceId)
      if (!advance || seen.has(row.advanceId) || !Number.isSafeInteger(row.journalEntryId) || (row.journalEntryId as number) <= 0 || row.journalEntryId !== advance.journalEntryId || !Number.isSafeInteger(row.amountMinor) || (row.amountMinor as number) <= 0) throw new Error('توزيع استرداد المقدمة لا يطابق الدفعة — راجع الأدلة')
      seen.add(row.advanceId)
      total += row.amountMinor as number
      const sum = (amounts.get(row.advanceId) ?? 0) + (row.amountMinor as number)
      if (!Number.isSafeInteger(total) || !Number.isSafeInteger(sum)) throw new Error('مجموع تخصيص المقدمة غير آمن — راجع الأدلة')
      amounts.set(row.advanceId, sum)
    }
    if (total !== recovery) throw new Error('توزيع استرداد المقدمة لا يطابق مبلغ المستخلص — راجع الأدلة')
  }
  return { complete, amounts }
}

/**
 * يحفظ أصل دفعات المقدمة وتحصيلات المحتجز وأدلة الإشعارات الموجودة محلياً.
 * لا يختلق أدلة قديمة، ولا يثبت صحة التخصيص أو القيود أو التحصيل أو كميات الإشعار.
 * المستخلص بلا دليل إشعار غير محمي هنا كي لا نحظر تعديله المشروع بقيد عكسي.
 */
export function assertProjectFinancialHistoryPreserved(current: Row, incoming: Row): void {
  const localAdvances = rows(current.clientAdvances, 'سجل دفعات المقدمة المحلي')
  const incomingAdvances = rows(incoming.clientAdvances, 'سجل دفعات المقدمة الوارد')
  const indexed = new Map(incomingAdvances.map(row => [row.id, row]))
  const changedProjects = new Set<number>()
  const addProject = (row: Row) => {
    if (!Number.isSafeInteger(row.projectId) || (row.projectId as number) <= 0) throw new Error('مشروع استرداد المقدمة غير صالح — راجع الأدلة')
    changedProjects.add(row.projectId as number)
  }
  const origin = (row: Row) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'recoveredMinor'))
  for (const old of localAdvances) {
    const candidate = indexed.get(old.id)
    if (!candidate || !same(origin(old), origin(candidate))) throw new Error(`النسخة تسقط أو تغيّر أصل دفعة المقدمة #${String(old.id)} — راجع الأدلة`)
    if (old.recoveredMinor !== candidate.recoveredMinor) {
      const amount = old.amountMinor, before = old.recoveredMinor, after = candidate.recoveredMinor
      if (!Number.isSafeInteger(amount) || (amount as number) <= 0 || !Number.isSafeInteger(before) || (before as number) < 0 || (before as number) > (amount as number) || !Number.isSafeInteger(after) || (after as number) < 0 || (after as number) > (amount as number)) throw new Error('تغيّر رصيد استرداد المقدمة بقيمة غير صالحة — راجع الأدلة')
      addProject(old)
    }
  }
  const localIds = new Set(localAdvances.map(row => row.id))
  for (const row of incomingAdvances) if (!localIds.has(row.id) && row.recoveredMinor !== 0) addProject(row)

  const previousExtracts = rows(current.projectExtracts, 'سجل المستخلصات المحلي')
  const nextExtracts = rows(incoming.projectExtracts, 'سجل المستخلصات الوارد')
  const beforeExtracts = new Map(previousExtracts.map(row => [row.id, row]))
  const afterExtracts = new Map(nextExtracts.map(row => [row.id, row]))
  // نصون هوية الختامي المحلي وأساسه عند بقاء قيده نفسه. لا يُثبت
  // اختلاف رقم القيد وحده صحة تعديل وارد؛ باقي حراسات الدفتر مستقلة.
  for (const old of previousExtracts) {
    if (old.isFinal !== true) continue
    const candidate = afterExtracts.get(old.id)
    if (!candidate || candidate.isFinal !== true || !same(old.projectId, candidate.projectId) || !same(old.branchId, candidate.branchId) || !same(old.extractNumber, candidate.extractNumber) || !same(old.createdAt, candidate.createdAt)) throw new Error(`النسخة تسقط أو تغيّر هوية المستخلص الختامي #${String(old.id)} — راجع التاريخ`)
    if (!same(old.journalEntryId, candidate.journalEntryId)) assertFinalEditEvidence(old, candidate, current, incoming)
    const financialFields = ['date', 'payment', 'totals', 'lines', 'advanceRecoveryMinor', 'advanceAllocations']
    if (financialFields.some(key => !same(old[key], candidate[key]))) {
      const before = old.journalEntryId, after = candidate.journalEntryId
      if (!Number.isSafeInteger(before) || (before as number) <= 0 || !Number.isSafeInteger(after) || (after as number) <= 0 || before === after) throw new Error(`النسخة تغيّر أساس المستخلص الختامي #${String(old.id)} دون تغيير مرجع قيد صالح — راجع التاريخ`)
    }
    for (const next of nextExtracts) {
      if (next.projectId !== old.projectId || next.id === old.id) continue
      const previous = beforeExtracts.get(next.id)
      // المعرفات هنا قرينة ترتيب تحفظية، لا إثبات زمني؛ السجلات القديمة
      // الملتبسة تحتاج مراجعة بدلاً من إدراج مستخلص لاحق بصمت.
      if ((!previous || previous.projectId !== old.projectId) && (next.id as number) > (old.id as number) || next.isFinal === true && (!previous || previous.projectId !== old.projectId || previous.isFinal !== true)) throw new Error(`النسخة تضيف مستخلصاً لاحقاً أو ختامياً آخر بعد المستخلص الختامي #${String(old.id)} — راجع التاريخ`)
    }
  }
  for (const id of new Set([...beforeExtracts.keys(), ...afterExtracts.keys()])) {
    const before = beforeExtracts.get(id), after = afterExtracts.get(id)
    const oldAmount = before?.advanceRecoveryMinor === undefined ? 0 : before.advanceRecoveryMinor
    const newAmount = after?.advanceRecoveryMinor === undefined ? 0 : after.advanceRecoveryMinor
    const allocationChanged = !same(before?.advanceAllocations, after?.advanceAllocations)
    // تغيير الوصف أو إضافة مستخلص بلا استرداد لا يغير أساس المقدمة.
    if (same(oldAmount, newAmount) && (same(before?.projectId, after?.projectId) || oldAmount === 0) && (!allocationChanged || (oldAmount === 0 && newAmount === 0))) continue
    if (before && after && Array.isArray(before.advanceAllocations)) {
      if (newAmount !== 0 && !Array.isArray(after.advanceAllocations)) throw new Error('النسخة تسقط توزيع استرداد المقدمة الموثق — راجع الأدلة')
      if (allocationChanged && Number.isSafeInteger(before.journalEntryId) && (before.journalEntryId as number) > 0 && before.journalEntryId === after.journalEntryId) throw new Error('تغيير توزيع المقدمة دون قيد مستخلص بديل — راجع الأدلة')
    }
    if (before && after && oldAmount !== 0 && before.advanceAllocations == null && Array.isArray(after.advanceAllocations) && (!Number.isSafeInteger(before.journalEntryId) || (before.journalEntryId as number) <= 0 || !Number.isSafeInteger(after.journalEntryId) || (after.journalEntryId as number) <= 0 || before.journalEntryId === after.journalEntryId)) throw new Error('لا يُختلق توزيع استرداد قديم بلا قيد مستخلص بديل — راجع الأدلة')
    if (before && oldAmount !== 0) addProject(before)
    if (after && newAmount !== 0) addProject(after)
  }
  if (changedProjects.size) {
    if (!Array.isArray(current.clientAdvances) || !Array.isArray(incoming.clientAdvances) || !Array.isArray(current.projectExtracts) || !Array.isArray(incoming.projectExtracts)) throw new Error('تعذّر مقارنة مستخلصات استرداد المقدمة — راجع الأدلة')
    for (const projectId of changedProjects) {
      const total = (records: Row[], extract = false): number => {
        let sum = 0
        for (const row of records) {
          if (row.projectId !== projectId) continue
          // النسخة التجريبية تعكس المقدمة بإشعار، ولا يدعمها مسار الترحيل الحالي.
          if (extract && row.quantityCreditVersion === 3) throw new Error('استرداد مقدمة بإشعار تجريبي يحتاج مراجعة منفصلة')
          const amount = extract ? (row.advanceRecoveryMinor === undefined ? 0 : row.advanceRecoveryMinor) : row.recoveredMinor
          if (!Number.isSafeInteger(amount) || (amount as number) < 0 || !Number.isSafeInteger(sum + (amount as number))) throw new Error('مجموع استرداد المقدمة غير صالح — راجع الأدلة')
          if (!extract && (!Number.isSafeInteger(row.amountMinor) || (row.amountMinor as number) <= 0 || (amount as number) > (row.amountMinor as number))) throw new Error('رصيد دفعة المقدمة غير صالح — راجع الأدلة')
          sum += amount as number
        }
        return sum
      }
      const before = total(localAdvances), after = total(incomingAdvances)
      const beforeRecovery = total(previousExtracts, true), afterRecovery = total(nextExtracts, true)
      if (after - before !== afterRecovery - beforeRecovery) throw new Error('تغيّر رصيد استرداد المقدمة لا يطابق تغيّر مستخلصات المشروع — راجع الأدلة')
      const oldAllocations = allocationTotals(projectId, localAdvances, previousExtracts)
      const newAllocations = allocationTotals(projectId, incomingAdvances, nextExtracts)
      if (oldAllocations.complete && newAllocations.complete) {
        const oldById = new Map(localAdvances.filter(row => row.projectId === projectId).map(row => [row.id, row]))
        const newById = new Map(incomingAdvances.filter(row => row.projectId === projectId).map(row => [row.id, row]))
        for (const id of new Set([...oldById.keys(), ...newById.keys()])) {
          const oldRecovered = (oldById.get(id)?.recoveredMinor ?? 0) as number
          const newRecovered = (newById.get(id)?.recoveredMinor ?? 0) as number
          if (newRecovered - oldRecovered !== (newAllocations.amounts.get(id) ?? 0) - (oldAllocations.amounts.get(id) ?? 0)) throw new Error('تغيّر رصيد الدفعة لا يطابق توزيع استردادها — راجع الأدلة')
        }
      }
    }
  }
  const localReleases = rows(current.retentionReleases, 'سجل تحصيل المحتجز المحلي')
  if (localReleases.length) {
    const next = rows(incoming.retentionReleases, 'سجل تحصيل المحتجز الوارد')
    const indexed = new Map(next.map(row => [row.id, row]))
    for (const row of localReleases) if (!indexed.has(row.id) || !same(row, indexed.get(row.id))) throw new Error(`النسخة تسقط أو تغيّر تحصيل المحتجز #${String(row.id)} — راجع الأدلة`)
    // إذا كان المشروع المحلي مقفلاً وله تحصيل محفوظ، فلا تُسقط اللقطة
    // حالته أو توقيته أو فرعه. لا نستنتج إقفالاً من تحصيل تاريخي وحده.
    if (Array.isArray(current.projects)) {
      for (const release of localReleases) {
        const projects = current.projects.filter((item): item is Row => !!item && typeof item === 'object' && !Array.isArray(item) && item.id === release.projectId)
        if (!projects.some(project => project.status === 'completed')) continue
        const candidates = Array.isArray(incoming.projects) ? incoming.projects.filter((item): item is Row => !!item && typeof item === 'object' && !Array.isArray(item) && item.id === release.projectId) : []
        const before = projects[0], after = candidates[0]
        if (projects.length !== 1 || candidates.length !== 1 || after.status !== 'completed' || !same(before.completedAt, after.completedAt) || !same(before.branchId, after.branchId)) throw new Error(`النسخة تسقط أو تغيّر إقفال المشروع المرتبط بتحصيل المحتجز #${String(release.id)} — راجع الأدلة`)
      }
    }
    // تحصيل كامل موزع يعتمد على المستخلصات التي أنشأت المحتجز وإشعاراتها.
    // حفظ التحصيل وحده لا يكفي إن أسقطت نسخة المستخلص أو بدلت أساسه.
    for (const release of localReleases) {
      if (release.allocationEvidence == null) continue // لا نخترع أدلة للسجل القديم
      const evidence = release.allocationEvidence
      const fail = (): never => { throw new Error(`النسخة تسقط أو تغيّر أساس توزيع تحصيل المحتجز #${String(release.id)} — راجع الأدلة`) }
      if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return fail()
      const record = evidence as Row
      if (record.version !== 1 || !Array.isArray(record.allocations) || !record.allocations.length || !Number.isSafeInteger(release.journalEntryId) || !Number.isSafeInteger(release.amountMinor)) return fail()
      let sum = 0
      const ids = new Set<unknown>()
      for (const item of record.allocations) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return fail()
        const allocation = item as Row
        if (!Number.isSafeInteger(allocation.extractId) || (allocation.extractId as number) <= 0 || ids.has(allocation.extractId) || !Number.isSafeInteger(allocation.journalEntryId) || (allocation.journalEntryId as number) <= 0 || (allocation.journalEntryId as number) >= (release.journalEntryId as number) || !Number.isSafeInteger(allocation.amountMinor) || (allocation.amountMinor as number) <= 0) return fail()
        ids.add(allocation.extractId)
        const old = beforeExtracts.get(allocation.extractId), candidate = afterExtracts.get(allocation.extractId)
        if (!old || old.projectId !== release.projectId || old.journalEntryId !== allocation.journalEntryId || !candidate || !same(old, candidate)) return fail()
        sum += allocation.amountMinor as number
        if (!Number.isSafeInteger(sum)) return fail()
      }
      if (sum !== release.amountMinor) return fail()
      // المستخلص ذو محتجز ردته الإشعارات بالكامل قد لا يظهر في قائمة
      // الحصص، ولكنه جزء من أساس التسلسل ولا يجوز إسقاطه أيضاً.
      for (const old of previousExtracts) {
        const totals = old.totals
        if (old.projectId !== release.projectId || !Number.isSafeInteger(old.journalEntryId) || (old.journalEntryId as number) >= (release.journalEntryId as number) || !totals || typeof totals !== 'object' || Array.isArray(totals) || !Number.isSafeInteger((totals as Row).retentionMinor) || ((totals as Row).retentionMinor as number) <= 0) continue
        if (!afterExtracts.has(old.id) || !same(old, afterExtracts.get(old.id))) return fail()
      }
      for (const next of nextExtracts) {
        const totals = next.totals
        if (next.projectId !== release.projectId || !Number.isSafeInteger(next.journalEntryId) || (next.journalEntryId as number) >= (release.journalEntryId as number) || !totals || typeof totals !== 'object' || Array.isArray(totals) || !Number.isSafeInteger((totals as Row).retentionMinor) || ((totals as Row).retentionMinor as number) <= 0) continue
        if (!beforeExtracts.has(next.id)) return fail()
      }
    }
    // تحصيل الماكينة الجديد يحمل لقطة للحركة؛ لا تسمح الاستعادة أو الدمج
    // بإسقاط الحركة الأصلية أو تغييرها حتى لو بقي سجل التحصيل نفسه.
    for (const row of localReleases) {
      const evidence = row.paymentEvidence
      const charge = evidence && typeof evidence === 'object' && !Array.isArray(evidence) ? (evidence as Row).terminalCharge : undefined
      if (charge == null) {
        // السجل القديم بلا لقطة ماكينة ليس إثباتاً للتسوية، لكن الروابط
        // المعروفة فيه لا تُمحى أو تُستحدث عند الاستبدال بصمت.
        const linked = (value: unknown): Row[] => Array.isArray(value) ? value.filter((item): item is Row => !!item && typeof item === 'object' && !Array.isArray(item) && item.kind === 'charge' && item.documentType === 'project_extract' && item.documentId === `retention:${String(row.id)}`) : []
        const before = linked(current.paymentTerminalTransactions), after = linked(incoming.paymentTerminalTransactions)
        if (!same(before, after)) throw new Error(`النسخة تغيّر حركة ماكينة تحصيل المحتجز التاريخية #${String(row.id)} — راجع الأدلة`)
        const ids = new Set<string>()
        for (const original of before) {
          if (typeof original.id !== 'string' || !original.id || ids.has(original.id)) throw new Error('معرّف حركة ماكينة تحصيل المحتجز التاريخية غير صالح — راجع الأدلة')
          ids.add(original.id)
          const reversals = (value: unknown): unknown[] => Array.isArray(value) ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item) && (item as Row).originalTransactionId === original.id && ((item as Row).kind === 'refund' || (item as Row).kind === 'void')) : []
          if (!same(reversals(current.paymentTerminalTransactions), reversals(incoming.paymentTerminalTransactions))) throw new Error(`النسخة تغيّر رد ماكينة تحصيل المحتجز #${String(row.id)} دون تسوية مثبتة — راجع الأدلة`)
        }
        continue
      }
      if (typeof charge !== 'object' || Array.isArray(charge) || typeof (charge as Row).id !== 'string' || !(charge as Row).id) throw new Error('دليل ماكينة تحصيل المحتجز غير صالح — راجع الأدلة')
      const id = (charge as Row).id
      const matching = (value: unknown): unknown[] => Array.isArray(value) ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item) && (item as Row).id === id) : []
      const before = matching(current.paymentTerminalTransactions), after = matching(incoming.paymentTerminalTransactions)
      if (before.length !== 1 || after.length !== 1 || !same(before[0], charge) || !same(after[0], charge)) throw new Error(`النسخة تسقط أو تغيّر حركة ماكينة تحصيل المحتجز #${String(row.id)} — راجع الأدلة`)
      const reversals = (value: unknown): unknown[] => Array.isArray(value) ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item) && (item as Row).originalTransactionId === id && ((item as Row).kind === 'refund' || (item as Row).kind === 'void')) : []
      // لا يؤكد رد الماكينة تسوية المحتجز أو قيده؛ أي تغيير في سجل الردود
      // يتطلب مراجعة بدلاً من دمجه أو محوه وكأنه عكس محاسبي مكتمل.
      if (!same(reversals(current.paymentTerminalTransactions), reversals(incoming.paymentTerminalTransactions))) throw new Error(`النسخة تغيّر رد ماكينة تحصيل المحتجز #${String(row.id)} دون تسوية مثبتة — راجع الأدلة`)
    }
  }

  const protectedRows = previousExtracts.filter(row => row.quantityCreditVersion != null || row.refunds != null && (!Array.isArray(row.refunds) || row.refunds.length > 0) || (row.refundedMinor ?? 0) !== 0 || (row.refundedTaxMinor ?? 0) !== 0)
  if (!protectedRows.length) return
  for (const old of protectedRows) {
    const candidate = afterExtracts.get(old.id)
    if (!candidate) throw new Error(`النسخة تسقط مستخلصاً ذا إشعار #${String(old.id)} — راجع الأدلة`)
    const oldRefunds = old.refunds === undefined ? [] : old.refunds
    const newRefunds = candidate.refunds === undefined ? [] : candidate.refunds
    if (!Array.isArray(oldRefunds) || !Array.isArray(newRefunds) || newRefunds.length < oldRefunds.length || !oldRefunds.every((row, i) => same(row, newRefunds[i]))) throw new Error('النسخة تسقط أو تغيّر دليل إشعار مستخلص — راجع التاريخ')
    // لا يُعدّل أصل المستخلص بعد إشعار؛ المجاميع وحدها تزيد بإضافة إشعار.
    const base = (row: Row) => Object.fromEntries(Object.entries(row).filter(([key]) => !['refunds', 'refundedMinor', 'refundedTaxMinor', 'quantityCreditVersion'].includes(key)))
    if (!same(base(old), base(candidate))) throw new Error('النسخة تغيّر أصل مستخلص ذي إشعار — راجع التاريخ')
    if (old.quantityCreditVersion != null && old.quantityCreditVersion !== candidate.quantityCreditVersion) throw new Error('النسخة تغيّر نسخة دليل إشعار المستخلص')
    if (old.quantityCreditVersion == null && (oldRefunds.length || value(old, 'refundedMinor') || value(old, 'refundedTaxMinor')) && candidate.quantityCreditVersion != null) throw new Error('لا يُحوّل إشعار قديم بلا دليل كمي إلى دليل جديد تلقائياً')
    let amount = value(old, 'refundedMinor'), tax = value(old, 'refundedTaxMinor')
    for (const event of newRefunds.slice(oldRefunds.length)) {
      if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('دليل إشعار مستخلص جديد غير صالح')
      const refund = event as Row, increment = value(refund, 'amountMinor'), taxIncrement = value(refund, 'taxShareMinor')
      if (increment <= 0 || !Number.isSafeInteger(amount + increment) || !Number.isSafeInteger(tax + taxIncrement)) throw new Error('مبلغ إشعار مستخلص جديد غير صالح')
      amount += increment; tax += taxIncrement
    }
    if (value(candidate, 'refundedMinor') !== amount || value(candidate, 'refundedTaxMinor') !== tax) throw new Error('مجاميع إشعارات المستخلص لا تطابق الأدلة المضافة')
  }
}
