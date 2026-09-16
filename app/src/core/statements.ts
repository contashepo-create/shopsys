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
  saleReturns: { returnNumber: string; date: string; saleId: number; refund: 'cash' | 'credit' | 'store_credit'; totals: { totalMinor: Minor }; creditRefundMinor?: Minor }[]
  /** فواتير البيع كاملة لربط المرتجع بعميله */
  allSales: { id: number; customerId: number | null }[]
  vouchers: { voucherNumber: string; kind: string; date: string; partyKind?: string | null; partyId?: number | null; amountMinor: Minor }[]
  cheques: ChequeLike[]
  /** صفوف تسويات شاملة (SET-####) — فروق مطابقة موثقة تدخل الرصيد الجاري */
  adjustments?: { docLabel: string; date: string; debitMinor: Minor; creditMinor: Minor }[]
  /**
   * مستندات الوحدات الأخرى المدينة للعميل (إصلاح المالك: «كشف الحساب لا يظهر النقلات»):
   * نقلات آجلة/جزئية، أوامر صيانة على الحساب، عقود إيجار آجلة… تُبنى بـ customerUnitDocs.
   */
  extraDocs?: { docLabel: string; date: string; debitMinor: Minor; creditMinor: Minor }[]
}

/** ما يحتاجه الكشف من الشيك (متوافق مع core/cheques.Cheque) */
export interface ChequeLike {
  chequeNumber: string
  direction: string // incoming | outgoing
  partyId: number | null // null = شيك بلا طرف مسجل
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
  for (const d of input.extraDocs ?? []) {
    rows.push({ date: d.date, docLabel: d.docLabel, debitMinor: d.debitMinor, creditMinor: d.creditMinor })
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
    if (saleOwner.get(r.saleId) !== input.customerId) continue
    // الرد الهجين (R1) وإيداع الرصيد (G2): الجزء المخفِّض للذمم فقط — سجلات قديمة: كامل مرتجع «على الحساب»
    const creditPart = r.creditRefundMinor ?? (r.refund === 'credit' || r.refund === 'store_credit' ? r.totals.totalMinor : 0)
    if (creditPart <= 0) continue
    rows.push({ date: r.date, docLabel: `مرتجع ${r.returnNumber} (على الحساب)`, debitMinor: 0, creditMinor: creditPart })
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
  purchaseReturns: { returnNumber: string; date: string; purchaseId: number; refund: 'cash' | 'debt'; totalMinor: Minor; inputVatShareMinor?: Minor }[]
  allPurchases: { id: number; supplierId: number }[]
  vouchers: { voucherNumber: string; kind: string; date: string; partyKind?: string | null; partyId?: number | null; amountMinor: Minor }[]
  cheques: ChequeLike[]
  /** صفوف تسويات شاملة (SET-####) — فروق مطابقة موثقة تدخل الرصيد الجاري */
  adjustments?: { docLabel: string; date: string; debitMinor: Minor; creditMinor: Minor }[]
  /**
   * مستندات الوحدات الأخرى المدينة للعميل (إصلاح المالك: «كشف الحساب لا يظهر النقلات»):
   * نقلات آجلة/جزئية، أوامر صيانة على الحساب، عقود إيجار آجلة… تُبنى بـ customerUnitDocs.
   */
  extraDocs?: { docLabel: string; date: string; debitMinor: Minor; creditMinor: Minor }[]
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
  for (const d of input.extraDocs ?? []) {
    rows.push({ date: d.date, docLabel: d.docLabel, debitMinor: d.debitMinor, creditMinor: d.creditMinor })
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
    // N2: تخفيض دين المورد يشمل حصة ض.ق.م المدخلات المعكوسة — تطابق قيد 2101 مدين
    rows.push({ date: r.date, docLabel: `مرتجع شراء ${r.returnNumber}`, debitMinor: r.totalMinor + (r.inputVatShareMinor ?? 0), creditMinor: 0 })
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
  /** سداد نقدي لسلفة خارج المسير (إصلاح الترابط: كان يُسجَّل قيداً ولا يظهر بالكشف) */
  advanceRepayments?: { repayNumber: string; date: string; employeeId: number; amountMinor: Minor }[]
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
  for (const rp of input.advanceRepayments ?? []) {
    if (rp.employeeId !== input.employeeId) continue
    rows.push({ date: rp.date, docLabel: `سداد نقدي ${rp.repayNumber}`, debitMinor: 0, creditMinor: rp.amountMinor })
  }
  return runBalance(rows)
}

/** رصيد نهائي مختصر */
export function statementBalance(rows: StatementRow[]): Minor {
  return rows.length ? rows[rows.length - 1].balanceMinor : 0
}

/**
 * مستندات الوحدات غير الكاشير المدينة لعميل (إصلاح المالك):
 * الجزء غير المحصَّل فقط من كل مستند يدخل ذمة العميل —
 * نقلات (grand − paid)، صيانة مسلَّمة (creditMinor)، عقود إيجار (collectCreditMinor).
 */
export function customerUnitDocs(args: {
  customerId: number
  trips?: readonly { tripNumber: string; date: string; customerId: number | null; payment: string; paidMinor?: number; totals: { grandMinor: Minor }; refunds?: readonly { date: string; amountMinor: Minor; mode: string }[] }[]
  tickets?: readonly { ticketNumber: string; customerId: number | null; deliveredAt: string | null; totals: { creditMinor: Minor } | null; refunds?: readonly { date: string; amountMinor: Minor; mode: string }[] }[]
  rentals?: readonly { contractNumber: string; date: string; customerId: number | null; totals: { collectCreditMinor: Minor }; refunds?: readonly { date: string; amountMinor: Minor; mode: string }[] }[]
  /** زيارات العيادة الآجلة لمريض مرتبط بهذا العميل (ترقية العيادة) + تحصيلاته */
  clinicVisits?: readonly { visitNumber: string; date: string; patientId: number; totals: { dueMinor: Minor } }[]
  clinicCollections?: readonly { date: string; patientId: number; amountMinor: Minor; viaVoucherId?: number | null }[]
  /** معرفات المرضى المرتبطين بهذا العميل */
  linkedPatientIds?: readonly number[]
  /** طلبات معمل آجلة لمرضى معمل مرتبطين بهذا العميل (إصلاح الترابط الشامل) */
  labOrders?: readonly { orderNumber: string; date: string; patientId: number; payment: string; totals: { totalMinor: Minor }; refunds?: readonly { date: string; amountMinor: Minor; mode: string }[] }[]
  linkedLabPatientIds?: readonly number[]
  /** خدمات محافظ بجزء آجل على العميل */
  walletOps?: readonly { opNumber: string; date: string; customerId: number | null; status: string; totals: { remainingMinor: Minor } }[]
  /** مستخلصات مقاولات آجلة لمشروعات مربوطة بالعميل + دفعات مقدمة وتحصيلات المشروع */
  projectExtracts?: readonly { extractNumber: string; date: string; projectId: number; payment: string; totals: { dueMinor: Minor }; refunds?: readonly { date: string; amountMinor: Minor; mode: string }[] }[]
  linkedProjectIds?: readonly number[]
  /**
   * خطط أقساط العميل — قيودها (هامش تمويل مدين، مقدم وسدادات دائنة) لا سندات لها
   * فكانت غائبة تماماً عن الكشف (إصلاح الترابط الشامل)
   */
  installmentPlans?: readonly {
    planNumber: string; customerId: number; createdAt: string
    interestMinor?: number; downPaymentMinor: number
    items: readonly { seq: number; dueDate: string; paidMinor: Minor; paidAt: string | null }[]
  }[]
  /** G3: مرتجعات خدمة مغسلة أودعت في حساب العميل (customer_credit) — تخفض ذمته */
  laundryOrders?: readonly { orderNumber: string; customerId: number | null; refunds?: readonly { date: string; amountMinor: Minor; mode: string }[] }[]
}): { docLabel: string; date: string; debitMinor: Minor; creditMinor: Minor }[] {
  const rows: { docLabel: string; date: string; debitMinor: Minor; creditMinor: Minor }[] = []
  for (const o of args.laundryOrders ?? []) {
    if (o.customerId !== args.customerId) continue
    for (const r of o.refunds ?? []) {
      if (r.mode === 'customer_credit') rows.push({ docLabel: `مرتجع خدمة ${o.orderNumber} (إيداع في الحساب)`, date: r.date, debitMinor: 0, creditMinor: r.amountMinor })
    }
  }
  const patientSet = new Set(args.linkedPatientIds ?? [])
  for (const v of args.clinicVisits ?? []) {
    if (!patientSet.has(v.patientId)) continue
    if (v.totals.dueMinor > 0) rows.push({ docLabel: `زيارة عيادة ${v.visitNumber} (آجل)`, date: v.date, debitMinor: v.totals.dueMinor, creditMinor: 0 })
  }
  for (const c of args.clinicCollections ?? []) {
    if (!patientSet.has(c.patientId)) continue
    // التحصيل عبر سند قبض يظهر في الكشف بالسند نفسه — لا يُكرَّر هنا (منع الازدواج)
    if (c.viaVoucherId) continue
    rows.push({ docLabel: 'تحصيل من المريض', date: c.date, debitMinor: 0, creditMinor: c.amountMinor })
  }
  const labSet = new Set(args.linkedLabPatientIds ?? [])
  for (const o of args.labOrders ?? []) {
    if (!labSet.has(o.patientId)) continue
    if (o.payment === 'credit') rows.push({ docLabel: `طلب معمل ${o.orderNumber} (آجل)`, date: o.date, debitMinor: o.totals.totalMinor, creditMinor: 0 })
    for (const r of o.refunds ?? []) {
      if (r.mode === 'customer_credit') rows.push({ docLabel: `مرتجع تحاليل ${o.orderNumber} (على الحساب)`, date: r.date, debitMinor: 0, creditMinor: r.amountMinor })
    }
  }
  for (const w of args.walletOps ?? []) {
    if (w.customerId !== args.customerId || w.status === 'returned') continue
    if (w.totals.remainingMinor > 0) rows.push({ docLabel: `خدمة محفظة ${w.opNumber} (آجل)`, date: w.date, debitMinor: w.totals.remainingMinor, creditMinor: 0 })
  }
  const projSet = new Set(args.linkedProjectIds ?? [])
  for (const ex of args.projectExtracts ?? []) {
    if (!projSet.has(ex.projectId)) continue
    if (ex.payment === 'credit' && ex.totals.dueMinor > 0) rows.push({ docLabel: `مستخلص ${ex.extractNumber} (آجل)`, date: ex.date, debitMinor: ex.totals.dueMinor, creditMinor: 0 })
    for (const r of ex.refunds ?? []) {
      if (r.mode === 'customer_credit') rows.push({ docLabel: `إشعار دائن مستخلص ${ex.extractNumber}`, date: r.date, debitMinor: 0, creditMinor: r.amountMinor })
    }
  }
  for (const pl of args.installmentPlans ?? []) {
    if (pl.customerId !== args.customerId) continue
    const created = pl.createdAt.slice(0, 10)
    if ((pl.interestMinor ?? 0) > 0) rows.push({ docLabel: `هامش تقسيط ${pl.planNumber}`, date: created, debitMinor: pl.interestMinor ?? 0, creditMinor: 0 })
    if (pl.downPaymentMinor > 0) rows.push({ docLabel: `مقدم خطة ${pl.planNumber}`, date: created, debitMinor: 0, creditMinor: pl.downPaymentMinor })
    for (const it of pl.items) {
      if (it.paidMinor > 0) rows.push({ docLabel: `سداد قسط ${pl.planNumber}/${it.seq}`, date: (it.paidAt ?? it.dueDate).slice(0, 10), debitMinor: 0, creditMinor: it.paidMinor })
    }
  }
  for (const t of args.trips ?? []) {
    if (t.customerId !== args.customerId) continue
    const paid = t.paidMinor ?? (t.payment === 'cash' ? t.totals.grandMinor : 0)
    const due = t.totals.grandMinor - paid
    if (due > 0) rows.push({ docLabel: `نقلة ${t.tripNumber} (آجل)`, date: t.date, debitMinor: due, creditMinor: 0 })
    for (const r of t.refunds ?? []) {
      if (r.mode === 'customer_credit') rows.push({ docLabel: `مرتجع نقلة ${t.tripNumber} (على الحساب)`, date: r.date, debitMinor: 0, creditMinor: r.amountMinor })
    }
  }
  for (const tk of args.tickets ?? []) {
    if (tk.customerId !== args.customerId || !tk.deliveredAt || !tk.totals) continue
    if (tk.totals.creditMinor > 0) rows.push({ docLabel: `صيانة ${tk.ticketNumber} (على الحساب)`, date: tk.deliveredAt, debitMinor: tk.totals.creditMinor, creditMinor: 0 })
    for (const r of tk.refunds ?? []) {
      if (r.mode === 'customer_credit') rows.push({ docLabel: `مرتجع صيانة ${tk.ticketNumber} (على الحساب)`, date: r.date, debitMinor: 0, creditMinor: r.amountMinor })
    }
  }
  for (const rc of args.rentals ?? []) {
    if (rc.customerId !== args.customerId) continue
    if (rc.totals.collectCreditMinor > 0) rows.push({ docLabel: `إيجار ${rc.contractNumber} (آجل)`, date: rc.date, debitMinor: rc.totals.collectCreditMinor, creditMinor: 0 })
    for (const r of rc.refunds ?? []) {
      if (r.mode === 'customer_credit') rows.push({ docLabel: `مرتجع إيجار ${rc.contractNumber} (على الحساب)`, date: r.date, debitMinor: 0, creditMinor: r.amountMinor })
    }
  }
  return rows
}
