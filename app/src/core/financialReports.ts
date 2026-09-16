/**
 * التقارير المالية العالمية (أمر المالك: «أين قائمة الدخل والموازنة ودفتر الأستاذ…»):
 * كلها مشتقة من دفتر اليومية الموحد — مصدر حقيقة واحد فلا تتناقض أبداً:
 * ① ميزان المراجعة  ② قائمة الدخل (ربح/خسارة)  ③ المركز المالي (الميزانية)
 * ④ دفتر الأستاذ العام (حركة حساب برصيد جارٍ)  ⑤ التدفق النقدي (نقدية/سيولة)
 * ⑥ تقرير الضريبة (ض.ق.م مخرجات/مدخلات/صافي)
 * نواة خالصة — أموال صحيحة (Minor)، بلا واجهات.
 */
import type { Minor } from './money.ts'
import { STANDARD_COA, accountBalance, type AccountRootType, type JournalEntry } from './ledger.ts'

export interface FinPeriod {
  from: string // YYYY-MM-DD شامل
  to: string // YYYY-MM-DD شامل
}

const inP = (date: string, p: FinPeriod) => date >= p.from && date <= p.to
const beforeP = (date: string, p: FinPeriod) => date < p.from

/** اسم الحساب: الشجرة القياسية أو خزائن مخصصة عبر extraNames */
const nameOf = (code: string, extraNames?: Record<string, string>) =>
  extraNames?.[code] ?? STANDARD_COA.find((a) => a.code === code)?.nameAr ?? code

const rootOf = (code: string): AccountRootType => {
  const acc = STANDARD_COA.find((a) => a.code === code)
  if (acc) return acc.rootType
  // خزائن مخصصة 11xx = أصول؛ وإلا حسب أول رقم
  const c = code[0]
  return c === '1' ? 'assets' : c === '2' ? 'liabilities' : c === '3' ? 'equity' : c === '4' ? 'revenue' : 'expenses'
}

/* ─── ① ميزان المراجعة ─── */

export interface TrialBalanceRow {
  code: string
  nameAr: string
  rootType: AccountRootType
  debitMinor: Minor
  creditMinor: Minor
}

export interface TrialBalance {
  rows: TrialBalanceRow[]
  totalDebitMinor: Minor
  totalCreditMinor: Minor
  balanced: boolean
}

export function trialBalance(journal: readonly JournalEntry[], p: FinPeriod, extraNames?: Record<string, string>): TrialBalance {
  const t = new Map<string, { d: Minor; c: Minor }>()
  for (const e of journal) {
    if (!inP(e.date, p)) continue
    for (const l of e.lines) {
      const cur = t.get(l.accountCode) ?? { d: 0, c: 0 }
      cur.d += l.debit; cur.c += l.credit
      t.set(l.accountCode, cur)
    }
  }
  const rows: TrialBalanceRow[] = [...t.entries()]
    .map(([code, v]) => ({ code, nameAr: nameOf(code, extraNames), rootType: rootOf(code), debitMinor: v.d, creditMinor: v.c }))
    .filter((r) => r.debitMinor !== 0 || r.creditMinor !== 0)
    .sort((a, b) => a.code.localeCompare(b.code))
  const totalDebitMinor = rows.reduce((a, r) => a + r.debitMinor, 0)
  const totalCreditMinor = rows.reduce((a, r) => a + r.creditMinor, 0)
  return { rows, totalDebitMinor, totalCreditMinor, balanced: totalDebitMinor === totalCreditMinor }
}

/* ─── ② قائمة الدخل ─── */

export interface IncomeStatementRow { code: string; nameAr: string; amountMinor: Minor }

export interface IncomeStatement {
  revenues: IncomeStatementRow[]
  expenses: IncomeStatementRow[]
  totalRevenueMinor: Minor
  totalExpenseMinor: Minor
  netProfitMinor: Minor // موجب = ربح
}

export function incomeStatement(journal: readonly JournalEntry[], p: FinPeriod, extraNames?: Record<string, string>): IncomeStatement {
  const tb = trialBalance(journal, p, extraNames)
  const revenues = tb.rows
    .filter((r) => r.rootType === 'revenue')
    .map((r) => ({ code: r.code, nameAr: r.nameAr, amountMinor: r.creditMinor - r.debitMinor }))
    .filter((r) => r.amountMinor !== 0)
  const expenses = tb.rows
    .filter((r) => r.rootType === 'expenses')
    .map((r) => ({ code: r.code, nameAr: r.nameAr, amountMinor: r.debitMinor - r.creditMinor }))
    .filter((r) => r.amountMinor !== 0)
  const totalRevenueMinor = revenues.reduce((a, r) => a + r.amountMinor, 0)
  const totalExpenseMinor = expenses.reduce((a, r) => a + r.amountMinor, 0)
  return { revenues, expenses, totalRevenueMinor, totalExpenseMinor, netProfitMinor: totalRevenueMinor - totalExpenseMinor }
}

/* ─── ③ المركز المالي (الميزانية) ─── */

export interface BalanceSheetRow { code: string; nameAr: string; amountMinor: Minor }

export interface BalanceSheet {
  assets: BalanceSheetRow[]
  liabilities: BalanceSheetRow[]
  equity: BalanceSheetRow[]
  retainedEarningsMinor: Minor // أرباح مرحلة + نتيجة الفترة (تغلق قائمة الدخل هنا)
  totalAssetsMinor: Minor
  totalLiabilitiesEquityMinor: Minor
  balanced: boolean
}

/** المركز المالي «حتى تاريخ» — تراكمي من أول قيد حتى نهاية الفترة */
export function balanceSheet(journal: readonly JournalEntry[], asOf: string, extraNames?: Record<string, string>): BalanceSheet {
  const p: FinPeriod = { from: '0000-01-01', to: asOf }
  const tb = trialBalance(journal, p, extraNames)
  const pick = (root: AccountRootType) =>
    tb.rows
      .filter((r) => r.rootType === root)
      .map((r) => ({ code: r.code, nameAr: r.nameAr, amountMinor: accountBalance(root, r.debitMinor, r.creditMinor) }))
      .filter((r) => r.amountMinor !== 0)
  const assets = pick('assets')
  const liabilities = pick('liabilities')
  const equity = pick('equity')
  const inc = incomeStatement(journal, p, extraNames)
  const retainedEarningsMinor = inc.netProfitMinor
  const totalAssetsMinor = assets.reduce((a, r) => a + r.amountMinor, 0)
  const totalLiabilitiesEquityMinor =
    liabilities.reduce((a, r) => a + r.amountMinor, 0) + equity.reduce((a, r) => a + r.amountMinor, 0) + retainedEarningsMinor
  return { assets, liabilities, equity, retainedEarningsMinor, totalAssetsMinor, totalLiabilitiesEquityMinor, balanced: totalAssetsMinor === totalLiabilitiesEquityMinor }
}

/* ─── ④ دفتر الأستاذ العام ─── */

export interface GeneralLedgerRow {
  date: string
  entryNumber: number
  description: string
  debitMinor: Minor
  creditMinor: Minor
  balanceMinor: Minor // رصيد جارٍ بطبيعة الحساب
}

export interface GeneralLedger {
  accountCode: string
  accountName: string
  openingMinor: Minor
  rows: GeneralLedgerRow[]
  closingMinor: Minor
}

export function generalLedger(
  journal: readonly JournalEntry[],
  accountCode: string,
  p: FinPeriod,
  extraNames?: Record<string, string>,
): GeneralLedger {
  const root = rootOf(accountCode)
  let opening = 0
  const rows: GeneralLedgerRow[] = []
  const sorted = [...journal].sort((a, b) => (a.date === b.date ? a.id - b.id : a.date.localeCompare(b.date)))
  for (const e of sorted) {
    for (const l of e.lines) {
      if (l.accountCode !== accountCode) continue
      if (beforeP(e.date, p)) {
        opening += accountBalance(root, l.debit, l.credit)
      } else if (inP(e.date, p)) {
        rows.push({ date: e.date, entryNumber: e.entryNumber, description: e.description, debitMinor: l.debit, creditMinor: l.credit, balanceMinor: 0 })
      }
    }
  }
  let running = opening
  for (const r of rows) {
    running += accountBalance(root, r.debitMinor, r.creditMinor)
    r.balanceMinor = running
  }
  return { accountCode, accountName: nameOf(accountCode, extraNames), openingMinor: opening, rows, closingMinor: running }
}

/* ─── ⑤ التدفق النقدي (نقدية وسيولة) ─── */

export interface CashFlowRow { label: string; amountMinor: Minor } // موجب = داخل

export interface CashFlowReport {
  openingCashMinor: Minor
  inflows: CashFlowRow[]
  outflows: CashFlowRow[]
  totalInMinor: Minor
  totalOutMinor: Minor
  netChangeMinor: Minor
  closingCashMinor: Minor
}

/**
 * تدفق نقدي مباشر: كل حركة على حسابات النقدية (الخزائن/البنوك) داخل الفترة،
 * مجمعة بالحساب المقابل الأبرز في القيد (تبسيط عملي يوازن دائماً مع الدفتر).
 */
export function cashFlowReport(
  journal: readonly JournalEntry[],
  cashCodes: readonly string[],
  p: FinPeriod,
  extraNames?: Record<string, string>,
): CashFlowReport {
  const cashSet = new Set(cashCodes)
  let opening = 0
  const inMap = new Map<string, Minor>()
  const outMap = new Map<string, Minor>()
  for (const e of journal) {
    const cashDelta = e.lines.reduce((a, l) => a + (cashSet.has(l.accountCode) ? l.debit - l.credit : 0), 0)
    if (cashDelta === 0) continue
    if (beforeP(e.date, p)) { opening += cashDelta; continue }
    if (!inP(e.date, p)) continue
    // الحساب المقابل الأبرز: أكبر سطر غير نقدي بالقيد
    const counter = [...e.lines]
      .filter((l) => !cashSet.has(l.accountCode))
      .sort((a, b) => (b.debit + b.credit) - (a.debit + a.credit))[0]
    const label = counter ? nameOf(counter.accountCode, extraNames) : 'تحويلات نقدية'
    if (cashDelta > 0) inMap.set(label, (inMap.get(label) ?? 0) + cashDelta)
    else outMap.set(label, (outMap.get(label) ?? 0) + -cashDelta)
  }
  const inflows = [...inMap.entries()].map(([label, amountMinor]) => ({ label, amountMinor })).sort((a, b) => b.amountMinor - a.amountMinor)
  const outflows = [...outMap.entries()].map(([label, amountMinor]) => ({ label, amountMinor })).sort((a, b) => b.amountMinor - a.amountMinor)
  const totalInMinor = inflows.reduce((a, r) => a + r.amountMinor, 0)
  const totalOutMinor = outflows.reduce((a, r) => a + r.amountMinor, 0)
  const netChangeMinor = totalInMinor - totalOutMinor
  return { openingCashMinor: opening, inflows, outflows, totalInMinor, totalOutMinor, netChangeMinor, closingCashMinor: opening + netChangeMinor }
}

/* ─── ⑥ تقرير الضريبة ─── */

export interface VatReport {
  outputVatMinor: Minor // ضريبة مخرجات (دائن 2102 من المبيعات)
  inputVatMinor: Minor // ضريبة مدخلات (مدين 2102 من المشتريات/المرتجعات)
  netDueMinor: Minor // موجب = مستحق للدولة
}

export function vatReport(journal: readonly JournalEntry[], p: FinPeriod, vatCode = '2102'): VatReport {
  let output = 0, input = 0
  for (const e of journal) {
    if (!inP(e.date, p)) continue
    for (const l of e.lines) {
      if (l.accountCode !== vatCode) continue
      output += l.credit
      input += l.debit
    }
  }
  return { outputVatMinor: output, inputVatMinor: input, netDueMinor: output - input }
}

/* ─── تصدير CSV احترافي (أمر المالك: تصدير Excel بكل التقارير) ─── */

/** CSV بترميز UTF-8 BOM ليفتح في Excel بالعربية سليماً */
export function toCsv(headers: readonly string[], rows: readonly (readonly (string | number)[])[]): string {
  const escape = (v: string | number) => {
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return '\uFEFF' + [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n')
}
