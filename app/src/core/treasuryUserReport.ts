export interface TreasuryUserJournalEntry {
  id: number
  date: string
  createdBy?: string | null
  sourceType: string
  lines: { accountCode: string; debit: number; credit: number }[]
}

export interface TreasuryUserSummary {
  userName: string
  receiptsMinor: number
  paymentsMinor: number
  netMinor: number
  operationsCount: number
}

/** تقرير تدقيق نقدي من القيود نفسها؛ التحويل يظهر خروجاً للمصدر ودخولاً للوجهة. */
export function summarizeTreasuryByUser(
  journal: TreasuryUserJournalEntry[],
  treasuryCodes: string[],
  fromDate?: string,
  toDate?: string,
): TreasuryUserSummary[] {
  const allowed = new Set(treasuryCodes)
  const summaries = new Map<string, TreasuryUserSummary>()
  for (const entry of journal) {
    if (fromDate && entry.date < fromDate) continue
    if (toDate && entry.date > toDate) continue
    const cashLines = entry.lines.filter((line) => allowed.has(line.accountCode))
    if (!cashLines.length) continue
    const userName = entry.createdBy?.trim() || 'غير محدد (سجل قديم)'
    const current = summaries.get(userName) ?? { userName, receiptsMinor: 0, paymentsMinor: 0, netMinor: 0, operationsCount: 0 }
    current.receiptsMinor += cashLines.reduce((sum, line) => sum + line.debit, 0)
    current.paymentsMinor += cashLines.reduce((sum, line) => sum + line.credit, 0)
    current.netMinor = current.receiptsMinor - current.paymentsMinor
    current.operationsCount += 1
    summaries.set(userName, current)
  }
  return [...summaries.values()].sort((a, b) => b.operationsCount - a.operationsCount || a.userName.localeCompare(b.userName, 'ar'))
}

function csvCell(value: string | number): string {
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/** CSV UTF-8 قابل للفتح في برامج الجداول؛ القيم المالية تبقى minor units بلا فقد دقة. */
export function treasuryUserSummaryCsv(rows: TreasuryUserSummary[]): string {
  const header = ['المستخدم', 'عدد العمليات', 'المقبوضات (وحدة صغرى)', 'المدفوعات (وحدة صغرى)', 'الصافي (وحدة صغرى)']
  return `\uFEFF${[header, ...rows.map((row) => [row.userName, row.operationsCount, row.receiptsMinor, row.paymentsMinor, row.netMinor])]
    .map((row) => row.map(csvCell).join(','))
    .join('\n')}`
}
