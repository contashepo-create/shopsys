/**
 * تقارير المصروفات (طلب المالك) — من القيود مباشرة (مصدر الحقيقة الوحيد):
 * تقرير مجمّع: كل بند مصروف (5xxx + المخصصة) بإجمالي الفترة وعدد الحركات ونسبته
 * تقرير تفصيلي: كل حركات بند واحد حركة حركة بتاريخها وبيانها ومصدرها
 * فلترة: فترة + بند + مصدر العملية — والطباعة عبر غلاف التقارير الموحّد.
 */
import type { Minor } from './money.ts'
import type { JournalEntry } from './ledger.ts'
import type { CostCenterBudget } from './costCenters.ts'

export interface ExpenseAccountRow {
  accountCode: string
  accountName: string
  totalMinor: Minor // صافي الفترة (مدين − دائن، فالمردودات تُخصم)
  txCount: number
  sharePercent: number // نسبته من إجمالي مصروفات الفترة
}

export interface ExpenseTxRow {
  entryId: number
  entryNumber: number
  date: string
  description: string
  sourceType: string
  amountMinor: Minor // موجب = مصروف، سالب = رد/عكس
}

export interface ExpenseReportFilter {
  from?: string // yyyy-mm-dd شامل
  to?: string
  accountCode?: string // بند واحد للتفصيلي
  sourceType?: string // فلترة بمصدر العملية
}

function inPeriod(date: string, f: ExpenseReportFilter): boolean {
  const d = date.slice(0, 10)
  if (f.from && d < f.from) return false
  if (f.to && d > f.to) return false
  return true
}

/** هل الكود بند مصروف؟ الشجرة القياسية 5xxx أو حساب مخصص جذره مصروفات */
export function isExpenseCode(code: string, customExpenseCodes: ReadonlySet<string>): boolean {
  return code.startsWith('5') || customExpenseCodes.has(code)
}

/** التقرير المجمّع: كل بند بإجماليه ونسبته — مرتب تنازلياً */
export function expensesSummary(
  journal: JournalEntry[],
  filter: ExpenseReportFilter,
  accountName: (code: string) => string,
  customExpenseCodes: ReadonlySet<string>,
): { rows: ExpenseAccountRow[]; grandTotalMinor: Minor; txCount: number } {
  const map = new Map<string, { totalMinor: number; txCount: number }>()
  for (const e of journal) {
    if (!inPeriod(e.date, filter)) continue
    if (filter.sourceType && e.sourceType !== filter.sourceType) continue
    for (const l of e.lines) {
      if (!isExpenseCode(l.accountCode, customExpenseCodes)) continue
      const cur = map.get(l.accountCode) ?? { totalMinor: 0, txCount: 0 }
      cur.totalMinor += l.debit - l.credit
      cur.txCount++
      map.set(l.accountCode, cur)
    }
  }
  const grandTotalMinor = [...map.values()].reduce((a, v) => a + v.totalMinor, 0)
  const rows = [...map.entries()]
    .map(([accountCode, v]) => ({
      accountCode,
      accountName: accountName(accountCode),
      totalMinor: v.totalMinor,
      txCount: v.txCount,
      sharePercent: grandTotalMinor > 0 ? Math.round((v.totalMinor / grandTotalMinor) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.totalMinor - a.totalMinor)
  return { rows, grandTotalMinor, txCount: rows.reduce((a, r) => a + r.txCount, 0) }
}

export interface CostCenterExpenseRow {
  /** المركز العام — مستقل عن المشروع ومركز تكلفة المركبة */
  costCenterId?: number | null
  /** مشروع المقاولات القديم/التشغيلي، ويمكن أن يظهر مع المركز العام معاً */
  projectId: number | null
  totalMinor: Minor
  paidMinor: Minor
  accruedMinor: Minor
  txCount: number
}

/** تحليل المصروفات الداخلية المرتبطة بالفواتير حسب المركز العام/المشروع وحالة السداد. */
export interface CostCenterExpenseFilter extends ExpenseReportFilter {
  costCenterId?: number | null | 'all'
  projectId?: number | null | 'all'
  settlement?: 'paid_now' | 'payable_later' | 'all'
}

export function invoiceExpensesByCostCenter(
  documents: { date: string; internalExpenses?: { costCenterId?: number | null; projectId?: number | null; amountMinor: Minor; settlement: 'paid_now' | 'payable_later' }[] }[],
  filter: CostCenterExpenseFilter,
): { rows: CostCenterExpenseRow[]; totalMinor: Minor } {
  const grouped = new Map<string, CostCenterExpenseRow>()
  for (const document of documents) {
    if (!inPeriod(document.date, filter)) continue
    for (const expense of document.internalExpenses ?? []) {
      const costCenterId = expense.costCenterId ?? null
      const projectId = expense.projectId ?? null
      if (filter.costCenterId !== undefined && filter.costCenterId !== 'all' && costCenterId !== filter.costCenterId) continue
      if (filter.projectId !== undefined && filter.projectId !== 'all' && projectId !== filter.projectId) continue
      if (filter.settlement && filter.settlement !== 'all' && expense.settlement !== filter.settlement) continue
      const key = `${costCenterId ?? 'none'}:${projectId ?? 'none'}`
      let row = grouped.get(key)
      if (!row) {
        row = { projectId, totalMinor: 0, paidMinor: 0, accruedMinor: 0, txCount: 0 }
        if (costCenterId != null) row.costCenterId = costCenterId
      }
      row.totalMinor += expense.amountMinor
      if (expense.settlement === 'paid_now') row.paidMinor += expense.amountMinor
      else row.accruedMinor += expense.amountMinor
      row.txCount++
      grouped.set(key, row)
    }
  }
  const rows = [...grouped.values()].sort((a, b) => b.totalMinor - a.totalMinor)
  return { rows, totalMinor: rows.reduce((sum, row) => sum + row.totalMinor, 0) }
}

export function costCenterExpensesCsv(rows: CostCenterExpenseRow[], projectName: (id: number | null) => string, costCenterName: (id: number | null) => string = () => ''): string {
  const quote = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`
  return ['مركز التكلفة العام,المشروع,عدد الحركات,مدفوع,مستحق,الإجمالي', ...rows.map((row) => [costCenterName(row.costCenterId ?? null) || 'بدون مركز عام', projectName(row.projectId), row.txCount, row.paidMinor, row.accruedMinor, row.totalMinor].map(quote).join(','))].join('\n')
}

export function expenseSummaryCsv(rows: ExpenseAccountRow[]): string {
  const quote = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`
  return ['الكود,البند,عدد الحركات,النسبة,الإجمالي', ...rows.map((row) => [row.accountCode, row.accountName, row.txCount, `${row.sharePercent}%`, row.totalMinor].map(quote).join(','))].join('\n')
}

export function expenseDetailsCsv(rows: (ExpenseTxRow & { accountCode: string })[]): string {
  const quote = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`
  return ['القيد,التاريخ,الكود,البيان,المصدر,المبلغ', ...rows.map((row) => [row.entryNumber, row.date, row.accountCode, row.description, row.sourceType, row.amountMinor].map(quote).join(','))].join('\n')
}

export interface InvoiceExpenseCategoryRow {
  label: string
  accountCode: string
  totalMinor: Minor
  paidMinor: Minor
  accruedMinor: Minor
  taxMinor: Minor
  txCount: number
  costCenterCount: number
}

/** تحليل تشغيلي حسب نوع المصروف، ويشمل العمولات والضريبة وحالة الاستحقاق. */
export function invoiceExpensesByCategory(
  documents: { date: string; internalExpenses?: { label: string; accountCode: string; costCenterId?: number | null; projectId?: number | null; amountMinor: Minor; settlement: 'paid_now' | 'payable_later'; taxTreatment?: 'exempt' | 'exclusive' | 'inclusive'; taxPercent?: number }[] }[],
  filter: ExpenseReportFilter,
): { rows: InvoiceExpenseCategoryRow[]; totalMinor: Minor; taxMinor: Minor } {
  const grouped = new Map<string, InvoiceExpenseCategoryRow & { centers: Set<string> }>()
  for (const document of documents) {
    if (!inPeriod(document.date, filter)) continue
    for (const expense of document.internalExpenses ?? []) {
      const key = `${expense.accountCode}\u0000${expense.label}`
      const row = grouped.get(key) ?? { label: expense.label, accountCode: expense.accountCode, totalMinor: 0, paidMinor: 0, accruedMinor: 0, taxMinor: 0, txCount: 0, costCenterCount: 0, centers: new Set<string>() }
      const rate = Math.max(0, expense.taxPercent ?? 0)
      const tax = expense.taxTreatment === 'exclusive' ? Math.round(expense.amountMinor * rate / 100) : expense.taxTreatment === 'inclusive' && rate > 0 ? expense.amountMinor - Math.round(expense.amountMinor / (1 + rate / 100)) : 0
      row.totalMinor += expense.amountMinor
      row.taxMinor += tax
      if (expense.settlement === 'paid_now') row.paidMinor += expense.amountMinor
      else row.accruedMinor += expense.amountMinor
      if (expense.projectId != null) row.centers.add(`project:${expense.projectId}`)
      if (expense.costCenterId != null) row.centers.add(`general:${expense.costCenterId}`)
      row.txCount++
      grouped.set(key, row)
    }
  }
  const rows = [...grouped.values()].map(({ centers, ...row }) => ({ ...row, costCenterCount: centers.size })).sort((a, b) => b.totalMinor - a.totalMinor)
  return { rows, totalMinor: rows.reduce((sum, row) => sum + row.totalMinor, 0), taxMinor: rows.reduce((sum, row) => sum + row.taxMinor, 0) }
}


export interface JournalCostCenterExpenseRow {
  costCenterId: number
  accountCode: string
  totalMinor: Minor
  txCount: number
}

export interface CostCenterReturnRow {
  costCenterId: number
  kind: 'sale_return' | 'purchase_return'
  totalMinor: Minor
  txCount: number
}

/** المرتجعات التي تحمل مراكز مرتبطة بالمستند الأصلي؛ تقرير ارتباط لا يخلطها بمصروفات الفترة. */
export function returnsByCostCenter(
  documents: { date: string; totalMinor: Minor; costCenterIds?: number[]; kind: CostCenterReturnRow['kind'] }[],
  filter: ExpenseReportFilter,
): CostCenterReturnRow[] {
  const grouped = new Map<string, CostCenterReturnRow>()
  for (const document of documents) {
    if (!inPeriod(document.date, filter)) continue
    for (const costCenterId of new Set(document.costCenterIds ?? [])) {
      const key = `${costCenterId}:${document.kind}`
      const row = grouped.get(key) ?? { costCenterId, kind: document.kind, totalMinor: 0, txCount: 0 }
      row.totalMinor += document.totalMinor
      row.txCount++
      grouped.set(key, row)
    }
  }
  return [...grouped.values()].sort((a, b) => b.totalMinor - a.totalMinor)
}

/** قيود المصروفات التي تحمل وسم مركز عام فعلياً، بما فيها الأنشطة خارج الفواتير. */
export function journalExpensesByCostCenter(
  journal: JournalEntry[],
  filter: ExpenseReportFilter & { costCenterId?: number | null | 'all' },
  customExpenseCodes: ReadonlySet<string>,
): { rows: JournalCostCenterExpenseRow[]; totalMinor: Minor } {
  const grouped = new Map<string, JournalCostCenterExpenseRow>()
  for (const entry of journal) {
    if (!inPeriod(entry.date, filter)) continue
    if (filter.sourceType && entry.sourceType !== filter.sourceType) continue
    for (const line of entry.lines) {
      if (line.costCenterId == null || !isExpenseCode(line.accountCode, customExpenseCodes)) continue
      if (filter.costCenterId !== undefined && filter.costCenterId !== 'all' && line.costCenterId !== filter.costCenterId) continue
      const key = `${line.costCenterId}:${line.accountCode}`
      const row = grouped.get(key) ?? { costCenterId: line.costCenterId, accountCode: line.accountCode, totalMinor: 0, txCount: 0 }
      row.totalMinor += line.debit - line.credit
      row.txCount++
      grouped.set(key, row)
    }
  }
  const rows = [...grouped.values()].sort((a, b) => b.totalMinor - a.totalMinor)
  return { rows, totalMinor: rows.reduce((sum, row) => sum + row.totalMinor, 0) }
}

export interface CostCenterBudgetReportRow extends CostCenterBudget {
  actualMinor: Minor
  varianceMinor: Minor
  utilizationPercent: number
}

/** مقارنة موازنة المركز بالمصروف الفعلي من سطور القيود الموسومة. */
export function costCenterBudgetReport(
  budgets: CostCenterBudget[],
  journal: JournalEntry[],
  filter: ExpenseReportFilter,
  customExpenseCodes: ReadonlySet<string>,
  centers: { id: number; parentId?: number | null }[] = [],
): CostCenterBudgetReportRow[] {
  const children = new Map<number, number[]>()
  for (const center of centers) if (center.parentId != null) children.set(center.parentId, [...(children.get(center.parentId) ?? []), center.id])
  const includedCenters = (rootId: number) => {
    const ids = new Set([rootId])
    const queue = [rootId]
    while (queue.length) for (const childId of children.get(queue.shift()!) ?? []) { if (!ids.has(childId)) { ids.add(childId); queue.push(childId) } }
    return ids
  }
  return budgets.filter((budget) => (!filter.from || budget.to >= filter.from) && (!filter.to || budget.from <= filter.to)).map((budget) => {
    const budgetCenters = includedCenters(budget.costCenterId)
    const actualMinor = journal.reduce((sum, entry) => {
      if (entry.date.slice(0, 10) < budget.from || entry.date.slice(0, 10) > budget.to || !inPeriod(entry.date, filter)) return sum
      return sum + entry.lines.filter((line) => line.costCenterId != null && budgetCenters.has(line.costCenterId) && isExpenseCode(line.accountCode, customExpenseCodes)).reduce((lineSum, line) => lineSum + line.debit - line.credit, 0)
    }, 0)
    return { ...budget, actualMinor, varianceMinor: budget.amountMinor - actualMinor, utilizationPercent: budget.amountMinor > 0 ? Math.round(actualMinor / budget.amountMinor * 1000) / 10 : 0 }
  }).sort((a, b) => a.from.localeCompare(b.from) || a.costCenterId - b.costCenterId)
}

export function invoiceExpenseCategoriesCsv(rows: InvoiceExpenseCategoryRow[]): string {
  const quote = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`
  return ['النوع,الحساب,الحركات,مراكز التكلفة,مدفوع,مستحق,الضريبة,الإجمالي', ...rows.map((row) => [row.label, row.accountCode, row.txCount, row.costCenterCount, row.paidMinor, row.accruedMinor, row.taxMinor, row.totalMinor].map(quote).join(','))].join('\n')
}

/** التقرير التفصيلي: حركات بند واحد حركة حركة (أو كل البنود لو بلا accountCode) */
export function expenseDetails(
  journal: JournalEntry[],
  filter: ExpenseReportFilter,
  customExpenseCodes: ReadonlySet<string>,
): { rows: (ExpenseTxRow & { accountCode: string })[]; totalMinor: Minor } {
  const rows: (ExpenseTxRow & { accountCode: string })[] = []
  for (const e of journal) {
    if (!inPeriod(e.date, filter)) continue
    if (filter.sourceType && e.sourceType !== filter.sourceType) continue
    for (const l of e.lines) {
      if (!isExpenseCode(l.accountCode, customExpenseCodes)) continue
      if (filter.accountCode && l.accountCode !== filter.accountCode) continue
      rows.push({
        entryId: e.id, entryNumber: e.entryNumber, date: e.date.slice(0, 10),
        description: l.note || e.description, sourceType: e.sourceType,
        accountCode: l.accountCode,
        amountMinor: l.debit - l.credit,
      })
    }
  }
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.entryId - a.entryId))
  return { rows, totalMinor: rows.reduce((a, r) => a + r.amountMinor, 0) }
}
