/**
 * كشوف حساب الأطراف — نواة خالصة (طلب المالك)
 * ─────────────────────────────────────────────
 * كشف عميل: فواتير البيع الآجلة (عليه) − مرتجعات على الحساب (له) −
 *           سندات قبض مربوطة به (له) − شيكات واردة (له، وترتد عليه لو ارتدت)
 * كشف مورد: فواتير الشراء الآجلة (له) − مرتجعات شراء على الحساب (عليه) −
 *           سندات صرف مربوطة به (عليه) − شيكات صادرة (عليه، وتُلغى)
 * كشف موظف: سلف مصروفة (عليه) − استقطاعات المسيرات (له)
 * كل صف بتاريخه ومستنده، والرصيد تراكمي.
 */
import type { Minor } from './money.ts'

export interface StatementRow {
  date: string
  docLabel: string // «فاتورة S-0001»، «سند قبض RV-0002»…
  debitMinor: Minor // عليه (يزيد مديونيته لنا) / للمورد: عليه هو
  creditMinor: Minor // له (يخفضها)
  balanceMinor: Minor // تراكمي بعد الصف
}

const byDate = (a: { date: string }, b: { date: string }) => a.date.localeCompare(b.date)

function runBalance(rows: Omit<StatementRow, 'balanceMinor'>[]): StatementRow[] {
  const sorted = [...rows].sort(byDate)
  let bal = 0
  return sorted.map((r) => {
    bal += r.debitMinor - r.creditMinor
    return { ...r, balanceMinor: bal }
  })
}

/* ─── كشف عميل ─── */

export interface CustomerStatementInput {
  customerId: number
  /** رصيد افتتاحي مثبت بقيد 1104/3101 (اختياري) — يظهر أول الكشف ويدخل الرصيد الجاري */
  openingMinor?: Minor
  sales: { invoiceNumber: string; date: string; customerId: number | null; payment: 'cash' | 'credit'; paidMinor?: number; totals: { totalMinor: Minor } }[]
  saleReturns: { returnNumber: string; date: string; saleId: number; refund: 'cash' | 'credit'; totals: { totalMinor: Minor } }[]
  /** فواتير البيع كاملة لربط المرتجع بعميله */
  allSales: { id: number; customerId: number | null }[]
  vouchers: { voucherNumber: string; kind: string; date: string; partyKind?: string | null; partyId?: number | null; amountMinor: Minor }[]
  cheques: ChequeLike[]
  /** صفوف تسويات شاملة (SET-####) — فروق مطابقة موثقة تدخل الرصيد الجاري */
  adjustments?: { docLabel: string; date: string; debitMinor: Minor; creditMinor: Minor }[]
}

/** ما يحتاجه الكشف من الشيك (متوافق مع core/cheques.Cheque) */
export interface ChequeLike {
  chequeNumber: string
  direction: string // incoming | outgoing
  partyId: number
  amountMinor: Minor
  status: string
  createdAt: string
  settledAt?: string | null
}

export function customerStatement(input: CustomerStatementInput): StatementRow[] {
  const rows: Omit<StatementRow, 'balanceMinor'>[] = []
  if (input.openingMinor && input.openingMinor > 0) {
    rows.push({ date: '0000-00-00', docLabel: 'رصيد افتتاحي', debitMinor: input.openingMinor, creditMinor: 0 })
  }
  for (const adj of input.adjustments ?? []) {
    rows.push({ date: adj.date, docLabel: adj.docLabel, debitMinor: adj.debitMinor, creditMinor: adj.creditMinor })
  }
  for (const s of input.sales) {
    if (s.customerId !== input.customerId) continue
    // الجزء الآجل فقط يدخل ذمة العميل (الدفع المجزأ)
    const paid = s.paidMinor ?? (s.payment === 'cash' ? s.totals.totalMinor : 0)
    const creditPart = s.totals.totalMinor - paid
    if (creditPart > 0) rows.push({ date: s.date, docLabel: `فاتورة ${s.invoiceNumber} (آجل)`, debitMinor: creditPart, creditMinor: 0 })
  }
  const saleOwner = new Map(input.allSales.map((s) => [s.id, s.customerId]))
  for (const r of input.saleReturns) {
    if (r.refund !== 'credit') continue
    if (saleOwner.get(r.saleId) !== input.customerId) continue
    rows.push({ date: r.date, docLabel: `مرتجع ${r.returnNumber} (على الحساب)`, debitMinor: 0, creditMinor: r.totals.totalMinor })
  }
  for (const v of input.vouchers) {
    if (v.partyKind !== 'customer' || v.partyId !== input.customerId || v.kind !== 'receipt') continue
    rows.push({ date: v.date, docLabel: `سند قبض ${v.voucherNumber}`, debitMinor: 0, creditMinor: v.amountMinor })
  }
  for (const c of input.cheques) {
    if (c.direction !== 'incoming' || c.partyId !== input.customerId) continue
    rows.push({ date: c.createdAt, docLabel: `شيك وارد ${c.chequeNumber}`, debitMinor: 0, creditMinor: c.amountMinor })
    if (c.status === 'bounced') {
      rows.push({ date: c.settledAt ?? c.createdAt, docLabel: `ارتداد شيك ${c.chequeNumber} ⚠️`, debitMinor: c.amountMinor, creditMinor: 0 })
    }
  }
  return runBalance(rows)
}

/* ─── كشف مورد ─── */

export interface SupplierStatementInput {
  supplierId: number
  /** رصيد افتتاحي مثبت بقيد 3101/2101 (اختياري) — دائن له علينا */
  openingMinor?: Minor
  // supplierDueMinor = مستحق المورد فقط (بضاعة + مصاريف على حسابه) — المصاريف
  // المدفوعة من خزينتي/عهدتي لا تدخل دينه أبداً (طلب المالك). القديمة: grandTotal
  purchases: { invoiceNumber: string; date: string; supplierId: number; grandTotalMinor: Minor; supplierDueMinor?: Minor; paidMinor: Minor }[]
  purchaseReturns: { returnNumber: string; date: string; purchaseId: number; refund: 'cash' | 'debt'; totalMinor: Minor }[]
  allPurchases: { id: number; supplierId: number }[]
  vouchers: { voucherNumber: string; kind: string; date: string; partyKind?: string | null; partyId?: number | null; amountMinor: Minor }[]
  cheques: ChequeLike[]
  /** صفوف تسويات شاملة (SET-####) — فروق مطابقة موثقة تدخل الرصيد الجاري */
  adjustments?: { docLabel: string; date: string; debitMinor: Minor; creditMinor: Minor }[]
}

export function supplierStatement(input: SupplierStatementInput): StatementRow[] {
  // هنا «دائن» يعني له علينا — نعرضه creditMinor والرصيد الموجب = مستحق له
  const rows: Omit<StatementRow, 'balanceMinor'>[] = []
  if (input.openingMinor && input.openingMinor > 0) {
    rows.push({ date: '0000-00-00', docLabel: 'رصيد افتتاحي', debitMinor: 0, creditMinor: input.openingMinor })
  }
  for (const adj of input.adjustments ?? []) {
    rows.push({ date: adj.date, docLabel: adj.docLabel, debitMinor: adj.debitMinor, creditMinor: adj.creditMinor })
  }
  for (const p of input.purchases) {
    if (p.supplierId !== input.supplierId) continue
    const remaining = (p.supplierDueMinor ?? p.grandTotalMinor) - p.paidMinor
    if (remaining > 0) rows.push({ date: p.date, docLabel: `فاتورة شراء ${p.invoiceNumber} (آجل)`, debitMinor: 0, creditMinor: remaining })
  }
  const purchaseOwner = new Map(input.allPurchases.map((p) => [p.id, p.supplierId]))
  for (const r of input.purchaseReturns) {
    if (r.refund !== 'debt') continue // «debt» = على الحساب
    if (purchaseOwner.get(r.purchaseId) !== input.supplierId) continue
    rows.push({ date: r.date, docLabel: `مرتجع شراء ${r.returnNumber}`, debitMinor: r.totalMinor, creditMinor: 0 })
  }
  for (const v of input.vouchers) {
    if (v.partyKind !== 'supplier' || v.partyId !== input.supplierId || v.kind !== 'payment') continue
    rows.push({ date: v.date, docLabel: `سند صرف ${v.voucherNumber}`, debitMinor: v.amountMinor, creditMinor: 0 })
  }
  for (const c of input.cheques) {
    if (c.direction !== 'outgoing' || c.partyId !== input.supplierId) continue
    rows.push({ date: c.createdAt, docLabel: `شيك صادر ${c.chequeNumber}`, debitMinor: c.amountMinor, creditMinor: 0 })
    if (c.status === 'cancelled') {
      rows.push({ date: c.settledAt ?? c.createdAt, docLabel: `إلغاء شيك ${c.chequeNumber}`, debitMinor: 0, creditMinor: c.amountMinor })
    }
  }
  // رصيد المورد: دائن له علينا ⇒ نحسبه credit − debit ليكون الموجب «مستحق له»
  const sorted = [...rows].sort(byDate)
  let bal = 0
  return sorted.map((r) => {
    bal += r.creditMinor - r.debitMinor
    return { ...r, balanceMinor: bal }
  })
}

/* ─── كشف موظف (سلف واستقطاعات) ─── */

export interface EmployeeStatementInput {
  employeeId: number
  advances: { advanceNumber: string; date: string; employeeId: number; amountMinor: Minor }[]
  payrollRuns: { runNumber: string; date: string; lines: { employeeId: number; advancesMinor: Minor; deductionsMinor: Minor; netMinor: Minor }[] }[]
}

export function employeeStatement(input: EmployeeStatementInput): StatementRow[] {
  const rows: Omit<StatementRow, 'balanceMinor'>[] = []
  for (const a of input.advances) {
    if (a.employeeId !== input.employeeId) continue
    rows.push({ date: a.date, docLabel: `سلفة ${a.advanceNumber}`, debitMinor: a.amountMinor, creditMinor: 0 })
  }
  for (const run of input.payrollRuns) {
    const line = run.lines.find((l) => l.employeeId === input.employeeId)
    if (!line || line.advancesMinor <= 0) continue
    rows.push({ date: run.date, docLabel: `استقطاع سلفة — مسير ${run.runNumber}`, debitMinor: 0, creditMinor: line.advancesMinor })
  }
  return runBalance(rows)
}

/** رصيد نهائي مختصر */
export function statementBalance(rows: StatementRow[]): Minor {
  return rows.length ? rows[rows.length - 1].balanceMinor : 0
}
