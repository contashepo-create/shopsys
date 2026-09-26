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
  /** قيمة المستند/العملية كما حدثت، حتى تظهر العمليات المسددة بالكامل أيضاً. */
  operationMinor?: Minor
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
  saleReturns: { returnNumber: string; date: string; saleId: number; refund: 'cash' | 'credit' | 'store_credit' | 'custom'; totals: { totalMinor: Minor }; creditRefundMinor?: Minor; storeCreditRefundMinor?: Minor }[]
  /** فواتير البيع كاملة لربط المرتجع بعميله */
  allSales: { id: number; customerId: number | null }[]
  vouchers: { voucherNumber: string; kind: string; date: string; partyKind?: string | null; partyId?: number | null; amountMinor: Minor; reversalEntryId?: number | null }[]
  cheques: ChequeLike[]
  /** صفوف تسويات شاملة (SET-####) — فروق مطابقة موثقة تدخل الرصيد الجاري */
  adjustments?: { docLabel: string; date: string; operationMinor?: Minor; debitMinor: Minor; creditMinor: Minor }[]
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
    rows.push({ date: '0000-00-00', docLabel: 'رصيد افتتاحي', operationMinor: input.openingMinor, debitMinor: input.openingMinor, creditMinor: 0 })
  }
  for (const adj of input.adjustments ?? []) {
    rows.push({ date: adj.date, docLabel: adj.docLabel, operationMinor: adj.operationMinor ?? Math.max(adj.debitMinor, adj.creditMinor), debitMinor: adj.debitMinor, creditMinor: adj.creditMinor })
  }
  for (const d of input.extraDocs ?? []) {
    rows.push({ date: d.date, docLabel: d.docLabel, debitMinor: d.debitMinor, creditMinor: d.creditMinor })
  }
  for (const s of input.sales) {
    if (s.customerId !== input.customerId) continue
    // لا نسقط الفاتورة النقدية أو المسددة بالكامل: كشف الحساب يعرض العملية كلها،
    // ويضع المدفوع في الدائن حتى يبقى الرصيد الجاري هو المتبقي فعلاً.
    const total = Math.max(0, s.totals.totalMinor)
    if (total <= 0) continue
    const paid = Math.min(total, Math.max(0, s.paidMinor ?? (s.payment === 'cash' ? total : 0)))
    const status = paid >= total ? 'نقدي/مسدد' : paid > 0 ? 'جزئي' : 'آجل'
    rows.push({ date: s.date, docLabel: `فاتورة ${s.invoiceNumber} (${status})`, operationMinor: total, debitMinor: total, creditMinor: paid })
  }
  const saleOwner = new Map(input.allSales.map((s) => [s.id, s.customerId]))
  for (const r of input.saleReturns) {
    if (saleOwner.get(r.saleId) !== input.customerId) continue
    // الرد الهجين (R1) وإيداع الرصيد (G2): الجزء المخفِّض للذمم فقط.
    // المرتجع النقدي يظهر كسطر توثيقي حتى لا تختفي العملية، دون تغيير رصيد العميل.
    const total = Math.max(0, r.totals.totalMinor)
    if (total <= 0) continue
    const creditPart = Math.min(total, Math.max(0, r.creditRefundMinor ?? r.storeCreditRefundMinor ?? (r.refund === 'credit' || r.refund === 'store_credit' ? total : 0)))
    const mode = creditPart > 0 ? (creditPart < total ? 'هجين' : 'على الحساب') : 'نقدي'
    rows.push({ date: r.date, docLabel: `مرتجع ${r.returnNumber} (${mode})`, operationMinor: total, debitMinor: 0, creditMinor: creditPart })
  }
  for (const v of input.vouchers) {
    if (v.reversalEntryId || v.partyKind !== 'customer' || v.partyId !== input.customerId || v.kind !== 'receipt') continue
    rows.push({ date: v.date, docLabel: `سند قبض ${v.voucherNumber}`, operationMinor: v.amountMinor, debitMinor: 0, creditMinor: v.amountMinor })
  }
  for (const c of input.cheques) {
    if (c.direction !== 'incoming' || c.partyId !== input.customerId) continue
    rows.push({ date: c.createdAt, docLabel: `شيك وارد ${c.chequeNumber}`, operationMinor: c.amountMinor, debitMinor: 0, creditMinor: c.amountMinor })
    if (c.status === 'bounced') {
      rows.push({ date: c.settledAt ?? c.createdAt, docLabel: `ارتداد شيك ${c.chequeNumber} ⚠️`, operationMinor: c.amountMinor, debitMinor: c.amountMinor, creditMinor: 0 })
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
  purchaseReturns: { returnNumber: string; date: string; purchaseId: number; refund: 'cash' | 'debt'; totalMinor: Minor; inputVatShareMinor?: Minor; supplierValueMinor?: Minor }[]
  allPurchases: { id: number; supplierId: number }[]
  vouchers: { voucherNumber: string; kind: string; date: string; partyKind?: string | null; partyId?: number | null; amountMinor: Minor; reversalEntryId?: number | null }[]
  cheques: ChequeLike[]
  /** صفوف تسويات شاملة (SET-####) — فروق مطابقة موثقة تدخل الرصيد الجاري */
  adjustments?: { docLabel: string; date: string; operationMinor?: Minor; debitMinor: Minor; creditMinor: Minor }[]
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
    rows.push({ date: '0000-00-00', docLabel: 'رصيد افتتاحي', operationMinor: input.openingMinor, debitMinor: 0, creditMinor: input.openingMinor })
  }
  for (const adj of input.adjustments ?? []) {
    rows.push({ date: adj.date, docLabel: adj.docLabel, operationMinor: adj.operationMinor ?? Math.max(adj.debitMinor, adj.creditMinor), debitMinor: adj.debitMinor, creditMinor: adj.creditMinor })
  }
  for (const d of input.extraDocs ?? []) {
    rows.push({ date: d.date, docLabel: d.docLabel, debitMinor: d.debitMinor, creditMinor: d.creditMinor })
  }
  for (const p of input.purchases) {
    if (p.supplierId !== input.supplierId) continue
    // إظهار فاتورة الشراء حتى لو سُددت بالكامل؛ الدائن قيمة الاستحقاق
    // والمدين ما سُدد فعلاً، فيبقى الرصيد الجاري هو المتبقي للمورد.
    const supplierDue = Math.max(0, p.supplierDueMinor ?? p.grandTotalMinor)
    if (supplierDue <= 0) continue
    const paid = Math.min(supplierDue, Math.max(0, p.paidMinor))
    const status = paid >= supplierDue ? 'نقدي/مسدد' : paid > 0 ? 'جزئي' : 'آجل'
    rows.push({ date: p.date, docLabel: `فاتورة شراء ${p.invoiceNumber} (${status})`, operationMinor: supplierDue, debitMinor: paid, creditMinor: supplierDue })
  }
  const purchaseOwner = new Map(input.allPurchases.map((p) => [p.id, p.supplierId]))
  for (const r of input.purchaseReturns) {
    if (purchaseOwner.get(r.purchaseId) !== input.supplierId) continue
    // إظهار المرتجع النقدي أيضاً؛ تخفيض الذمة يحدث فقط في مرتجع «على الحساب».
    const total = Math.max(0, (r.supplierValueMinor ?? r.totalMinor) + (r.inputVatShareMinor ?? 0))
    if (total <= 0) continue
    const debitPart = r.refund === 'debt' ? total : 0
    const mode = debitPart > 0 ? 'على الحساب' : 'نقدي'
    rows.push({ date: r.date, docLabel: `مرتجع شراء ${r.returnNumber} (${mode})`, operationMinor: total, debitMinor: debitPart, creditMinor: 0 })
  }
  for (const v of input.vouchers) {
    if (v.reversalEntryId || v.partyKind !== 'supplier' || v.partyId !== input.supplierId || v.kind !== 'payment') continue
    rows.push({ date: v.date, docLabel: `سند صرف ${v.voucherNumber}`, operationMinor: v.amountMinor, debitMinor: v.amountMinor, creditMinor: 0 })
  }
  for (const c of input.cheques) {
    if (c.direction !== 'outgoing' || c.partyId !== input.supplierId) continue
    rows.push({ date: c.createdAt, docLabel: `شيك صادر ${c.chequeNumber}`, operationMinor: c.amountMinor, debitMinor: c.amountMinor, creditMinor: 0 })
    if (c.status === 'cancelled') {
      rows.push({ date: c.settledAt ?? c.createdAt, docLabel: `إلغاء شيك ${c.chequeNumber}`, operationMinor: c.amountMinor, debitMinor: 0, creditMinor: c.amountMinor })
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
  payrollRuns: { runNumber: string; date: string; lines: { employeeId: number; baseMinor: Minor; allowancesMinor: Minor; overtimeMinor: Minor; advancesMinor: Minor; deductionsMinor: Minor; grossMinor: Minor; netMinor: Minor }[] }[]
  /** سداد نقدي لسلفة خارج المسير (إصلاح الترابط: كان يُسجَّل قيداً ولا يظهر بالكشف) */
  advanceRepayments?: { repayNumber: string; date: string; employeeId: number; amountMinor: Minor }[]
  /** عمولات الموظف المستحقة/المصروفة، وهي عمليات على حساب الموظف وليست سندات قبض/صرف عادية. */
  commissions?: { code: string; date: string; employeeId: number; amountMinor: Minor; status: 'accrued' | 'paid' | 'cancelled'; description: string }[]
  /** حركات العهدة: تمويلها يزيد ما على الموظف ومصروفاتها/مرتجعاتها تخفضه. */
  custodyTransactions?: { date: string; employeeId: number; type: 'fund' | 'expense' | 'invoice' | 'return' | 'shortage'; amountMinor: Minor; description: string }[]
  /**
   * جزاءات/خصومات مسجلة (مراجعة الموظفين — طلب المالك: «يجب أن يكون هناك قسم خصومات»):
   * ليست حركة نقدية ولا ديناً على 1107، لكنها التزام موثق يظهر بالكشف.
   */
  deductions?: { dedNumber: string; date: string; employeeId: number; amountMinor: Minor; recoveredMinor: number; waivedMinor?: number; reason: string }[]
}

export function employeeStatement(input: EmployeeStatementInput): StatementRow[] {
  const rows: Omit<StatementRow, 'balanceMinor'>[] = []
  for (const a of input.advances) {
    if (a.employeeId !== input.employeeId) continue
    rows.push({ date: a.date, docLabel: `سلفة ${a.advanceNumber}`, operationMinor: a.amountMinor, debitMinor: a.amountMinor, creditMinor: 0 })
  }
  for (const run of input.payrollRuns) {
    const line = run.lines.find((l) => l.employeeId === input.employeeId)
    if (!line) continue
    // يظهر كل مسير للموظف، حتى لو لم يتضمن استقطاع سلفة؛ تفاصيل الراتب في البيان.
    const payrollEffect = line.advancesMinor > 0 ? line.advancesMinor : 0
    const payrollInfo = `مسير ${run.runNumber} — إجمالي ${line.grossMinor}، صافي ${line.netMinor}`
    rows.push({ date: run.date, docLabel: payrollInfo, operationMinor: line.grossMinor, debitMinor: 0, creditMinor: payrollEffect })
  }
  for (const rp of input.advanceRepayments ?? []) {
    if (rp.employeeId !== input.employeeId) continue
    rows.push({ date: rp.date, docLabel: `سداد نقدي ${rp.repayNumber}`, operationMinor: rp.amountMinor, debitMinor: 0, creditMinor: rp.amountMinor })
  }
  for (const commission of input.commissions ?? []) {
    if (commission.employeeId !== input.employeeId) continue
    const amount = Math.max(0, commission.amountMinor)
    if (amount <= 0) continue
    if (commission.status === 'accrued') rows.push({ date: commission.date, docLabel: `عمولة ${commission.code} — ${commission.description} (مستحقة)`, operationMinor: amount, debitMinor: 0, creditMinor: amount })
    else if (commission.status === 'paid') rows.push({ date: commission.date, docLabel: `عمولة ${commission.code} — ${commission.description} (مصروفة)`, operationMinor: amount, debitMinor: amount, creditMinor: amount })
    else rows.push({ date: commission.date, docLabel: `عمولة ${commission.code} — ${commission.description} (ملغاة)`, operationMinor: amount, debitMinor: 0, creditMinor: 0 })
  }
  for (const tx of input.custodyTransactions ?? []) {
    if (tx.employeeId !== input.employeeId || tx.amountMinor <= 0) continue
    const isDebit = tx.type === 'fund' || tx.type === 'shortage'
    rows.push({ date: tx.date, docLabel: `${tx.description || 'حركة عهدة'} (${tx.type})`, operationMinor: tx.amountMinor, debitMinor: isDebit ? tx.amountMinor : 0, creditMinor: isDebit ? 0 : tx.amountMinor })
  }
  // الجزاءات: صفوف توثيقية بمبلغ صفري — تُعلم القارئ دون أن تلوث رصيد السلف النقدي.
  for (const d of input.deductions ?? []) {
    if (d.employeeId !== input.employeeId) continue
    const status = (d.waivedMinor ?? 0) > 0 ? 'معفو عنه' : d.recoveredMinor >= d.amountMinor ? 'خُصم بالكامل' : d.recoveredMinor > 0 ? 'خُصم جزئياً' : 'قائم'
    rows.push({ date: d.date.slice(0, 10), docLabel: `جزاء ${d.dedNumber} (${d.reason}) — ${status}`, operationMinor: d.amountMinor, debitMinor: 0, creditMinor: 0 })
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
  tickets?: readonly { ticketNumber: string; customerId: number | null; deliveredAt: string | null; totals: { grandMinor: Minor; paidMinor: Minor; creditMinor: Minor } | null; refunds?: readonly { date: string; amountMinor: Minor; mode: string }[] }[]
  rentals?: readonly { contractNumber: string; date: string; customerId: number | null; totals: { grandMinor: Minor; collectCreditMinor: Minor }; refunds?: readonly { date: string; amountMinor: Minor; mode: string }[] }[]
  /** زيارات العيادة الآجلة لمريض مرتبط بهذا العميل (ترقية العيادة) + تحصيلاته */
  clinicVisits?: readonly { visitNumber: string; date: string; patientId: number; totals: { totalMinor: Minor; paidMinor: Minor; dueMinor: Minor } }[]
  clinicCollections?: readonly { date: string; patientId: number; amountMinor: Minor; viaVoucherId?: number | null }[]
  /** معرفات المرضى المرتبطين بهذا العميل */
  linkedPatientIds?: readonly number[]
  /** طلبات معمل آجلة لمرضى معمل مرتبطين بهذا العميل (إصلاح الترابط الشامل) */
  labOrders?: readonly { orderNumber: string; date: string; patientId: number; payment: string; totals: { totalMinor: Minor }; refunds?: readonly { date: string; amountMinor: Minor; mode: string }[] }[]
  linkedLabPatientIds?: readonly number[]
  /** خدمات محافظ بجزء آجل على العميل */
  walletOps?: readonly { opNumber: string; date: string; customerId: number | null; status: string; chargeMinor: Minor; paidMinor: Minor; totals: { remainingMinor: Minor } }[]
  /** مستخلصات مقاولات آجلة لمشروعات مربوطة بالعميل + دفعات مقدمة وتحصيلات المشروع */
  projectExtracts?: readonly { extractNumber: string; date: string; projectId: number; payment: string; totals: { dueMinor: Minor }; advanceRecoveryMinor?: Minor; refunds?: readonly { date: string; amountMinor: Minor; mode: string }[] }[]
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
  laundryOrders?: readonly { orderNumber: string; customerId: number | null; receivedAt: string; status?: string; grandMinor?: Minor; prepaidMinor?: Minor; refunds?: readonly { date: string; amountMinor: Minor; mode: string }[] }[]
  /** سيارات معرض بيعت آجلاً لمشترٍ مربوط بهذا العميل (ربط المشتري — طلب المالك) */
  cars?: readonly { make: string; model: string; year: number; plateOrVin: string; buyerCustomerId?: number | null; salePayment?: string; saleTotalMinor?: number | null; soldAt: string | null }[]
  /** سيارات أمانة بيعت آجلاً لمشترٍ مربوط بهذا العميل */
  consignmentCars?: readonly { make: string; model: string; plateOrVin: string; buyerCustomerId?: number | null; salePayment?: string; salePriceMinor: number | null; soldAt: string | null }[]
}): { docLabel: string; date: string; operationMinor?: Minor; debitMinor: Minor; creditMinor: Minor }[] {
  const rows: { docLabel: string; date: string; operationMinor?: Minor; debitMinor: Minor; creditMinor: Minor }[] = []
  for (const c of args.cars ?? []) {
    if (c.buyerCustomerId !== args.customerId || c.salePayment !== 'credit' || !c.soldAt) continue
    if ((c.saleTotalMinor ?? 0) > 0) rows.push({ docLabel: `بيع سيارة ${c.make} ${c.model} ${c.year} (${c.plateOrVin}) آجل`, date: c.soldAt, operationMinor: c.saleTotalMinor ?? 0, debitMinor: c.saleTotalMinor ?? 0, creditMinor: 0 })
  }
  for (const c of args.consignmentCars ?? []) {
    if (c.buyerCustomerId !== args.customerId || c.salePayment !== 'credit' || !c.soldAt) continue
    if ((c.salePriceMinor ?? 0) > 0) rows.push({ docLabel: `بيع أمانة ${c.make} ${c.model} (${c.plateOrVin}) آجل`, date: c.soldAt, operationMinor: c.salePriceMinor ?? 0, debitMinor: c.salePriceMinor ?? 0, creditMinor: 0 })
  }
  for (const o of args.laundryOrders ?? []) {
    if (o.customerId !== args.customerId) continue
    const laundryTotal = o.grandMinor ?? 0
    if (laundryTotal > 0 && (!o.status || o.status === 'delivered' || o.status === 'ready')) {
      const prepaid = Math.min(laundryTotal, Math.max(0, o.prepaidMinor ?? 0))
      rows.push({ docLabel: `خدمة مغسلة ${o.orderNumber}`, date: o.receivedAt, operationMinor: laundryTotal, debitMinor: laundryTotal, creditMinor: prepaid })
    }
    for (const r of o.refunds ?? []) {
      if (r.mode === 'customer_credit') rows.push({ docLabel: `مرتجع خدمة ${o.orderNumber} (إيداع في الحساب)`, date: r.date, operationMinor: r.amountMinor, debitMinor: 0, creditMinor: r.amountMinor })
    }
  }
  const patientSet = new Set(args.linkedPatientIds ?? [])
  for (const v of args.clinicVisits ?? []) {
    if (!patientSet.has(v.patientId) || v.totals.totalMinor <= 0) continue
    const paid = Math.min(v.totals.totalMinor, Math.max(0, v.totals.paidMinor))
    const status = paid >= v.totals.totalMinor ? 'نقدي/مسدد' : paid > 0 ? 'جزئي' : 'آجل'
    rows.push({ docLabel: `زيارة عيادة ${v.visitNumber} (${status})`, date: v.date, operationMinor: v.totals.totalMinor, debitMinor: v.totals.totalMinor, creditMinor: paid })
  }
  for (const c of args.clinicCollections ?? []) {
    if (!patientSet.has(c.patientId)) continue
    // التحصيل عبر سند قبض يظهر في الكشف بالسند نفسه — لا يُكرَّر هنا (منع الازدواج)
    if (c.viaVoucherId) continue
    rows.push({ docLabel: 'تحصيل من المريض', date: c.date, operationMinor: c.amountMinor, debitMinor: 0, creditMinor: c.amountMinor })
  }
  const labSet = new Set(args.linkedLabPatientIds ?? [])
  for (const o of args.labOrders ?? []) {
    if (!labSet.has(o.patientId) || o.totals.totalMinor <= 0) continue
    const paid = o.payment === 'cash' ? o.totals.totalMinor : 0
    const status = paid >= o.totals.totalMinor ? 'نقدي/مسدد' : 'آجل'
    rows.push({ docLabel: `طلب معمل ${o.orderNumber} (${status})`, date: o.date, operationMinor: o.totals.totalMinor, debitMinor: o.totals.totalMinor, creditMinor: paid })
    for (const r of o.refunds ?? []) {
      if (r.mode === 'customer_credit') rows.push({ docLabel: `مرتجع تحاليل ${o.orderNumber} (على الحساب)`, date: r.date, operationMinor: r.amountMinor, debitMinor: 0, creditMinor: r.amountMinor })
    }
  }
  for (const w of args.walletOps ?? []) {
    if (w.customerId !== args.customerId || w.status === 'returned' || w.chargeMinor <= 0) continue
    const paid = Math.min(w.chargeMinor, Math.max(0, w.paidMinor))
    const status = paid >= w.chargeMinor ? 'نقدي/مسدد' : paid > 0 ? 'جزئي' : 'آجل'
    rows.push({ docLabel: `خدمة محفظة ${w.opNumber} (${status})`, date: w.date, operationMinor: w.chargeMinor, debitMinor: w.chargeMinor, creditMinor: paid })
  }
  const projSet = new Set(args.linkedProjectIds ?? [])
  for (const ex of args.projectExtracts ?? []) {
    if (!projSet.has(ex.projectId) || ex.totals.dueMinor <= 0) continue
    // ذمة المستخلص = المستحق − ما استُرد من الدفعة المقدمة.
    const recovery = Math.min(ex.totals.dueMinor, Math.max(0, ex.advanceRecoveryMinor ?? 0))
    const exNet = ex.totals.dueMinor - recovery
    const cashPaid = ex.payment === 'cash' ? exNet : 0
    const status = cashPaid >= exNet ? 'نقدي/مسدد' : recovery > 0 ? 'مقدم/آجل' : 'آجل'
    rows.push({ docLabel: `مستخلص ${ex.extractNumber} (${status})`, date: ex.date, operationMinor: ex.totals.dueMinor, debitMinor: exNet, creditMinor: recovery + cashPaid })
    for (const r of ex.refunds ?? []) {
      if (r.mode === 'customer_credit') rows.push({ docLabel: `إشعار دائن مستخلص ${ex.extractNumber}`, date: r.date, operationMinor: r.amountMinor, debitMinor: 0, creditMinor: r.amountMinor })
    }
  }
  for (const pl of args.installmentPlans ?? []) {
    if (pl.customerId !== args.customerId) continue
    const created = pl.createdAt.slice(0, 10)
    if ((pl.interestMinor ?? 0) > 0) rows.push({ docLabel: `هامش تقسيط ${pl.planNumber}`, date: created, operationMinor: pl.interestMinor ?? 0, debitMinor: pl.interestMinor ?? 0, creditMinor: 0 })
    if (pl.downPaymentMinor > 0) rows.push({ docLabel: `مقدم خطة ${pl.planNumber}`, date: created, operationMinor: pl.downPaymentMinor, debitMinor: 0, creditMinor: pl.downPaymentMinor })
    for (const it of pl.items) {
      if (it.paidMinor > 0) rows.push({ docLabel: `سداد قسط ${pl.planNumber}/${it.seq}`, date: (it.paidAt ?? it.dueDate).slice(0, 10), operationMinor: it.paidMinor, debitMinor: 0, creditMinor: it.paidMinor })
    }
  }
  for (const t of args.trips ?? []) {
    if (t.customerId !== args.customerId || t.totals.grandMinor <= 0) continue
    const paid = Math.min(t.totals.grandMinor, Math.max(0, t.paidMinor ?? (t.payment === 'cash' ? t.totals.grandMinor : 0)))
    const status = paid >= t.totals.grandMinor ? 'نقدي/مسدد' : paid > 0 ? 'جزئي' : 'آجل'
    rows.push({ docLabel: `نقلة ${t.tripNumber} (${status})`, date: t.date, operationMinor: t.totals.grandMinor, debitMinor: t.totals.grandMinor, creditMinor: paid })
    for (const r of t.refunds ?? []) {
      if (r.mode === 'customer_credit') rows.push({ docLabel: `مرتجع نقلة ${t.tripNumber} (على الحساب)`, date: r.date, operationMinor: r.amountMinor, debitMinor: 0, creditMinor: r.amountMinor })
    }
  }
  for (const tk of args.tickets ?? []) {
    if (tk.customerId !== args.customerId || !tk.deliveredAt || !tk.totals || tk.totals.grandMinor <= 0) continue
    const paid = Math.min(tk.totals.grandMinor, Math.max(0, tk.totals.paidMinor))
    const status = paid >= tk.totals.grandMinor ? 'نقدي/مسدد' : paid > 0 ? 'جزئي' : 'آجل'
    rows.push({ docLabel: `صيانة ${tk.ticketNumber} (${status})`, date: tk.deliveredAt, operationMinor: tk.totals.grandMinor, debitMinor: tk.totals.grandMinor, creditMinor: paid })
    for (const r of tk.refunds ?? []) {
      if (r.mode === 'customer_credit') rows.push({ docLabel: `مرتجع صيانة ${tk.ticketNumber} (على الحساب)`, date: r.date, operationMinor: r.amountMinor, debitMinor: 0, creditMinor: r.amountMinor })
    }
  }
  for (const rc of args.rentals ?? []) {
    if (rc.customerId !== args.customerId || rc.totals.grandMinor <= 0) continue
    const paid = Math.max(0, rc.totals.grandMinor - rc.totals.collectCreditMinor)
    const status = paid >= rc.totals.grandMinor ? 'نقدي/مسدد' : paid > 0 ? 'جزئي' : 'آجل'
    rows.push({ docLabel: `إيجار ${rc.contractNumber} (${status})`, date: rc.date, operationMinor: rc.totals.grandMinor, debitMinor: rc.totals.grandMinor, creditMinor: paid })
    for (const r of rc.refunds ?? []) {
      if (r.mode === 'customer_credit') rows.push({ docLabel: `مرتجع إيجار ${rc.contractNumber} (على الحساب)`, date: r.date, operationMinor: r.amountMinor, debitMinor: 0, creditMinor: r.amountMinor })
    }
  }
  return rows
}

/* ─── أعمار الديون (A/R & A/P Aging) — المقارنة العالمية ───
 * QuickBooks/Xero/Odoo كلها تقدم Aging بشرائح 30/60/90 — كان غائباً تماماً.
 * النهج المحاسبي المعتمد: تخصيص المدفوعات على أقدم المديونيات أولاً (FIFO)
 * ثم توزيع المتبقي غير المسدد على شرائح عمرية بحسب تاريخ مستند المديونية.
 */

export interface AgingBuckets {
  currentMinor: Minor // 0–30 يوماً
  d31_60Minor: Minor
  d61_90Minor: Minor
  over90Minor: Minor
  totalMinor: Minor
}

/**
 * توزيع رصيد كشف حساب على شرائح عمرية.
 * يعمل على صفوف الكشف نفسها (مصدر الحقيقة الوحيد) فلا يتناقض مع الرصيد أبداً:
 * المدينات (debit) ديون بتاريخها، الدائنات (credit) سداد يُخصص FIFO على الأقدم.
 * asOf بصيغة YYYY-MM-DD. يصلح للعملاء، وللموردين تُقلب الأعمدة قبل النداء.
 */
export function agingFromStatement(rows: readonly StatementRow[], asOf: string): AgingBuckets {
  // ديون قائمة: نضيف مدين الصف أولاً ثم نستهلك دائن الصف نفسه عليه،
  // حتى لا تُنسب دفعة فاتورة نقدية إلى فاتورة أقدم عند حساب الأعمار.
  const debts: { date: string; remaining: number }[] = []
  let creditPool = 0
  const consumeCredits = () => {
    for (const d of debts) {
      if (creditPool <= 0) break
      if (d.remaining <= 0) continue
      const eat = Math.min(d.remaining, creditPool)
      d.remaining -= eat
      creditPool -= eat
    }
  }
  for (const r of rows) {
    if (r.debitMinor > 0) debts.push({ date: r.date, remaining: r.debitMinor })
    if (r.creditMinor > 0) creditPool += r.creditMinor
    consumeCredits()
  }
  const buckets: AgingBuckets = { currentMinor: 0, d31_60Minor: 0, d61_90Minor: 0, over90Minor: 0, totalMinor: 0 }
  const asOfMs = Date.parse(asOf)
  for (const d of debts) {
    if (d.remaining <= 0) continue
    // الرصيد الافتتاحي (0000-00-00) أقدم من كل شيء ⇒ +90 تلقائياً
    const ageDays = d.date === '0000-00-00' ? 999 : Math.max(0, Math.floor((asOfMs - Date.parse(d.date.slice(0, 10))) / 86400000))
    if (ageDays <= 30) buckets.currentMinor += d.remaining
    else if (ageDays <= 60) buckets.d31_60Minor += d.remaining
    else if (ageDays <= 90) buckets.d61_90Minor += d.remaining
    else buckets.over90Minor += d.remaining
    buckets.totalMinor += d.remaining
  }
  return buckets
}

/** كشف المورد معكوس الاتجاه (الدائن دين علينا) — نقلبه لنمرره لنفس محرك الأعمار */
export function supplierRowsForAging(rows: readonly StatementRow[]): StatementRow[] {
  return rows.map((r) => ({ ...r, debitMinor: r.creditMinor, creditMinor: r.debitMinor }))
}
