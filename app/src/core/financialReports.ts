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

/**
 * التكاليف المباشرة (تكلفة الإيراد) — لعرض «مجمل الربح» متعدد المراحل
 * (المقارنة العالمية: QuickBooks/Xero يعرضان Revenue → COGS → Gross Profit → OpEx → Net):
 * 5101 تكلفة البضاعة، 5105 تشغيل المعدات، 5106 مصاريف النقلات،
 * 5109 عمولات المحيلين، 5110 تكاليف مشروعات المقاولات — كلها مرتبطة بالإيراد مباشرة.
 */
const COST_OF_SALES_CODES = new Set(['5101', '5105', '5106', '5109', '5110'])

export interface IncomeStatement {
  revenues: IncomeStatementRow[]
  /** التكاليف المباشرة (تكلفة الإيراد) — مرحلة مجمل الربح */
  costOfSales: IncomeStatementRow[]
  /** المصروفات التشغيلية (كل ما ليس تكلفة مباشرة) */
  operatingExpenses: IncomeStatementRow[]
  /** كل المصروفات معاً (توافق خلفي) */
  expenses: IncomeStatementRow[]
  totalRevenueMinor: Minor
  totalCostOfSalesMinor: Minor
  grossProfitMinor: Minor // مجمل الربح = الإيرادات − التكاليف المباشرة
  totalOperatingExpenseMinor: Minor
  totalExpenseMinor: Minor
  netProfitMinor: Minor // موجب = ربح
}

export function incomeStatement(journal: readonly JournalEntry[], p: FinPeriod, extraNames?: Record<string, string>): IncomeStatement {
  // قيود إقفال السنة تصفّر 4xxx/5xxx — تُستثنى هنا لتظل قائمة الدخل تعرض الأداء الحقيقي لأي فترة حتى بعد الإقفال
  const tb = trialBalance(journal.filter((e) => e.sourceType !== 'year_closing'), p, extraNames)
  const revenues = tb.rows
    .filter((r) => r.rootType === 'revenue')
    .map((r) => ({ code: r.code, nameAr: r.nameAr, amountMinor: r.creditMinor - r.debitMinor }))
    .filter((r) => r.amountMinor !== 0)
  const expenses = tb.rows
    .filter((r) => r.rootType === 'expenses')
    .map((r) => ({ code: r.code, nameAr: r.nameAr, amountMinor: r.debitMinor - r.creditMinor }))
    .filter((r) => r.amountMinor !== 0)
  const costOfSales = expenses.filter((r) => COST_OF_SALES_CODES.has(r.code))
  const operatingExpenses = expenses.filter((r) => !COST_OF_SALES_CODES.has(r.code))
  const totalRevenueMinor = revenues.reduce((a, r) => a + r.amountMinor, 0)
  const totalCostOfSalesMinor = costOfSales.reduce((a, r) => a + r.amountMinor, 0)
  const totalOperatingExpenseMinor = operatingExpenses.reduce((a, r) => a + r.amountMinor, 0)
  const totalExpenseMinor = totalCostOfSalesMinor + totalOperatingExpenseMinor
  return {
    revenues, costOfSales, operatingExpenses, expenses,
    totalRevenueMinor, totalCostOfSalesMinor,
    grossProfitMinor: totalRevenueMinor - totalCostOfSalesMinor,
    totalOperatingExpenseMinor, totalExpenseMinor,
    netProfitMinor: totalRevenueMinor - totalExpenseMinor,
  }
}

/* ─── ③ المركز المالي (الميزانية) ─── */

export interface BalanceSheetRow { code: string; nameAr: string; amountMinor: Minor }

export interface BalanceSheet {
  assets: BalanceSheetRow[]
  /** الأصول المتداولة (11xx وكل خزينة مخصصة) — التبويب المعياري (IAS 1) */
  currentAssets: BalanceSheetRow[]
  /** الأصول غير المتداولة/الثابتة (12xx: أصول ومعدات ومجمع الإهلاك) */
  nonCurrentAssets: BalanceSheetRow[]
  totalCurrentAssetsMinor: Minor
  totalNonCurrentAssetsMinor: Minor
  liabilities: BalanceSheetRow[]
  equity: BalanceSheetRow[]
  retainedEarningsMinor: Minor // أرباح مرحلة + نتيجة الفترة (تغلق قائمة الدخل هنا)
  totalAssetsMinor: Minor
  totalLiabilitiesEquityMinor: Minor
  balanced: boolean
}

/** هل الحساب أصل غير متداول؟ الشجرة القياسية فرع 12، والمخصصة بالبادئة 12 */
const isNonCurrentAsset = (code: string): boolean => {
  const acc = STANDARD_COA.find((a) => a.code === code)
  return acc ? acc.parentCode === '12' : code.startsWith('12')
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
  const currentAssets = assets.filter((r) => !isNonCurrentAsset(r.code))
  const nonCurrentAssets = assets.filter((r) => isNonCurrentAsset(r.code))
  const liabilities = pick('liabilities')
  const equity = pick('equity')
  const inc = incomeStatement(journal, p, extraNames)
  // ما أُقفل رسمياً في 3102 (قيود year_closing) صار ضمن حقوق الملكية أعلاه — يُطرح من نتيجة الفترة الجارية
  const closedNetMinor = journal
    .filter((e) => e.sourceType === 'year_closing' && e.date <= asOf)
    .reduce((a, e) => a + e.lines.filter((l) => l.accountCode === '3102').reduce((x, l) => x + l.credit - l.debit, 0), 0)
  const retainedEarningsMinor = inc.netProfitMinor - closedNetMinor
  const totalAssetsMinor = assets.reduce((a, r) => a + r.amountMinor, 0)
  const totalLiabilitiesEquityMinor =
    liabilities.reduce((a, r) => a + r.amountMinor, 0) + equity.reduce((a, r) => a + r.amountMinor, 0) + retainedEarningsMinor
  return {
    assets, currentAssets, nonCurrentAssets,
    totalCurrentAssetsMinor: currentAssets.reduce((a, r) => a + r.amountMinor, 0),
    totalNonCurrentAssetsMinor: nonCurrentAssets.reduce((a, r) => a + r.amountMinor, 0),
    liabilities, equity, retainedEarningsMinor, totalAssetsMinor, totalLiabilitiesEquityMinor,
    balanced: totalAssetsMinor === totalLiabilitiesEquityMinor,
  }
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

export type CashFlowActivity = 'operating' | 'investing' | 'financing'

export interface CashFlowRow { label: string; amountMinor: Minor; activity: CashFlowActivity } // موجب = داخل

export interface CashFlowReport {
  openingCashMinor: Minor
  inflows: CashFlowRow[]
  outflows: CashFlowRow[]
  totalInMinor: Minor
  totalOutMinor: Minor
  /** صافي كل نشاط (IAS 7): تشغيلي / استثماري / تمويلي — مجموعها = صافي التغير */
  operatingNetMinor: Minor
  investingNetMinor: Minor
  financingNetMinor: Minor
  netChangeMinor: Minor
  closingCashMinor: Minor
}

/**
 * تصنيف الحساب المقابل لنشاط التدفق (IAS 7 — الطريقة المباشرة):
 * استثماري: الأصول الثابتة ومجمع الإهلاك (1201/1202 وبادئة 12)
 * تمويلي: رأس المال وجاري الشريك والأرباح المرحلة (3xxx)
 * تشغيلي: كل الباقي (مبيعات/مشتريات/موردون/عملاء/رواتب/ضرائب/مصروفات…)
 */
const activityOf = (code: string): CashFlowActivity => {
  const acc = STANDARD_COA.find((a) => a.code === code)
  if (acc ? acc.parentCode === '12' : code.startsWith('12')) return 'investing'
  if (code.startsWith('3')) return 'financing'
  return 'operating'
}

/**
 * تدفق نقدي مباشر: كل حركة على حسابات النقدية (الخزائن/البنوك) داخل الفترة،
 * مجمعة بالحساب المقابل الأبرز في القيد ومصنفة تشغيلي/استثماري/تمويلي (IAS 7).
 * التحويلات بين الخزائن تتصافر داخل القيد فلا تظهر تدفقاً وهمياً.
 */
export function cashFlowReport(
  journal: readonly JournalEntry[],
  cashCodes: readonly string[],
  p: FinPeriod,
  extraNames?: Record<string, string>,
): CashFlowReport {
  const cashSet = new Set(cashCodes)
  let opening = 0
  const inMap = new Map<string, { amountMinor: Minor; activity: CashFlowActivity }>()
  const outMap = new Map<string, { amountMinor: Minor; activity: CashFlowActivity }>()
  let operatingNetMinor = 0, investingNetMinor = 0, financingNetMinor = 0
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
    const activity = counter ? activityOf(counter.accountCode) : 'operating'
    if (activity === 'operating') operatingNetMinor += cashDelta
    else if (activity === 'investing') investingNetMinor += cashDelta
    else financingNetMinor += cashDelta
    const map = cashDelta > 0 ? inMap : outMap
    const cur = map.get(label) ?? { amountMinor: 0, activity }
    cur.amountMinor += Math.abs(cashDelta)
    map.set(label, cur)
  }
  const inflows = [...inMap.entries()].map(([label, v]) => ({ label, amountMinor: v.amountMinor, activity: v.activity })).sort((a, b) => b.amountMinor - a.amountMinor)
  const outflows = [...outMap.entries()].map(([label, v]) => ({ label, amountMinor: v.amountMinor, activity: v.activity })).sort((a, b) => b.amountMinor - a.amountMinor)
  const totalInMinor = inflows.reduce((a, r) => a + r.amountMinor, 0)
  const totalOutMinor = outflows.reduce((a, r) => a + r.amountMinor, 0)
  const netChangeMinor = totalInMinor - totalOutMinor
  return { openingCashMinor: opening, inflows, outflows, totalInMinor, totalOutMinor, operatingNetMinor, investingNetMinor, financingNetMinor, netChangeMinor, closingCashMinor: opening + netChangeMinor }
}

/* ─── ⑥ تقرير الضريبة ─── */

export interface VatReport {
  outputVatMinor: Minor // ضريبة مخرجات: صافي جانب المبيعات (مبيعات − مرتجعاتها)
  inputVatMinor: Minor // ضريبة مدخلات: صافي جانب المشتريات (مشتريات − مرتجعاتها)
  netDueMinor: Minor // إقرار الفترة: مخرجات − مدخلات (موجب = مستحق للدولة)
  settledMinor: Minor // المسدد للمصلحة خلال الفترة (سندات على 2102) — لا يدخل الإقرار
  remainingMinor: Minor // المتبقي بعد السداد = netDue − settled
}

/**
 * مصادر جانب المدخلات: التي تقيّد 2102 مديناً كمدخلات (وعكسها دائناً بالمرتجع).
 * project_cost أُضيف مع عزل ضريبة تكاليف المشاريع (دفعة الـ18) — بدونه كانت
 * مدخلات المشروع تُخصم خطأً من بند المخرجات في الإقرار (الصافي صحيح والبندان مشوهان).
 */
const VAT_INPUT_SOURCES = new Set(['purchase', 'purchase_return', 'project_cost'])
/** تسويات لا تدخل الإقرار: سداد/استرداد مع المصلحة وقيود الإقفال */
const VAT_SETTLEMENT_SOURCES = new Set(['payment_voucher', 'receipt_voucher', 'year_closing'])

/**
 * تقرير ض.ق.م بتصنيف مصدر القيد (إصلاح المراجعة):
 * كان التصنيف باتجاه السطر (دائن = مخرجات / مدين = مدخلات) فظهر عكس مدخلات
 * مرتجع الشراء «مخرجاتٍ» وسداد الضريبة للمصلحة «مدخلاتٍ» — الآن:
 * جانب المشتريات ومرتجعاتها = مدخلات، السندات على 2102 = تسوية سداد منفصلة،
 * وكل مصادر الإيراد (بيع/خدمات/عقود…) ومرتجعاتها = مخرجات.
 * قيود بلا sourceType (بيانات خارجية) تعود للتصنيف الاتجاهي القديم.
 */
export function vatReport(journal: readonly JournalEntry[], p: FinPeriod, vatCode = '2102'): VatReport {
  let output = 0, input = 0, settled = 0
  for (const e of journal) {
    if (!inP(e.date, p)) continue
    let credit = 0, debit = 0
    for (const l of e.lines) {
      if (l.accountCode !== vatCode) continue
      credit += l.credit; debit += l.debit
    }
    if (credit === 0 && debit === 0) continue
    const st = (e as { sourceType?: string }).sourceType
    if (st === undefined) { output += credit; input += debit }
    else if (VAT_INPUT_SOURCES.has(st)) input += debit - credit
    else if (VAT_SETTLEMENT_SOURCES.has(st)) settled += debit - credit
    else output += credit - debit
  }
  const netDueMinor = output - input
  return { outputVatMinor: output, inputVatMinor: input, netDueMinor, settledMinor: settled, remainingMinor: netDueMinor - settled }
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
