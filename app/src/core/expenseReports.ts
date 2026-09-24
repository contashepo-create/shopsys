/**
 * تقارير المصروفات (طلب المالك) — من القيود مباشرة (مصدر الحقيقة الوحيد):
 * تقرير مجمّع: كل بند مصروف (5xxx + المخصصة) بإجمالي الفترة وعدد الحركات ونسبته
 * تقرير تفصيلي: كل حركات بند واحد حركة حركة بتاريخها وبيانها ومصدرها
 * فلترة: فترة + بند + مصدر العملية — والطباعة عبر غلاف التقارير الموحّد.
 */
import type { Minor } from './money.ts'
import type { JournalEntry } from './ledger.ts'

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
  projectId: number | null
  totalMinor: Minor
  paidMinor: Minor
  accruedMinor: Minor
  txCount: number
}

/** تحليل المصروفات الداخلية المرتبطة بالفواتير حسب مركز التكلفة وحالة السداد. */
export interface CostCenterExpenseFilter extends ExpenseReportFilter {
  projectId?: number | null | 'all'
  settlement?: 'paid_now' | 'payable_later' | 'all'
}

export function invoiceExpensesByCostCenter(
  documents: { date: string; internalExpenses?: { projectId?: number | null; amountMinor: Minor; settlement: 'paid_now' | 'payable_later' }[] }[],
  filter: CostCenterExpenseFilter,
): { rows: CostCenterExpenseRow[]; totalMinor: Minor } {
  const grouped = new Map<number | null, CostCenterExpenseRow>()
  for (const document of documents) {
    if (!inPeriod(document.date, filter)) continue
    for (const expense of document.internalExpenses ?? []) {
      const projectId = expense.projectId ?? null
      if (filter.projectId !== undefined && filter.projectId !== 'all' && projectId !== filter.projectId) continue
      if (filter.settlement && filter.settlement !== 'all' && expense.settlement !== filter.settlement) continue
      const row = grouped.get(projectId) ?? { projectId, totalMinor: 0, paidMinor: 0, accruedMinor: 0, txCount: 0 }
      row.totalMinor += expense.amountMinor
      if (expense.settlement === 'paid_now') row.paidMinor += expense.amountMinor
      else row.accruedMinor += expense.amountMinor
      row.txCount++
      grouped.set(projectId, row)
    }
  }
  const rows = [...grouped.values()].sort((a, b) => b.totalMinor - a.totalMinor)
  return { rows, totalMinor: rows.reduce((sum, row) => sum + row.totalMinor, 0) }
}

export function costCenterExpensesCsv(rows: CostCenterExpenseRow[], projectName: (id: number | null) => string): string {
  const quote = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`
  return ['مركز التكلفة,عدد الحركات,مدفوع,مستحق,الإجمالي', ...rows.map((row) => [projectName(row.projectId), row.txCount, row.paidMinor, row.accruedMinor, row.totalMinor].map(quote).join(','))].join('\n')
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
