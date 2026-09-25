/**
 * عمليات المشاريع المتقدمة — نواة خالصة (أوامر التعديل)
 * ────────────────────────────────────────────────────
 * 1) أذون صرف مواد للمشاريع: خصم مخزون بالمتوسط المرجح → تكلفة مباشرة (5110/1103)
 *    مع أمين مخزن (صارف) ومهندس موقع (مستلم) إلزاميين من قاعدة الموظفين،
 *    وتحويل وحدات متعددة (شراء بالطن، صرف بالكجم/الشيكارة) وتدقيق كامل للحركة.
 * 2) تحصيلات العملاء: الذمة تنشأ فقط من مستخلص/فاتورة رسمية؛ التحصيل على مستوى
 *    الحساب الإجمالي ويُطفئ الفواتير المفتوحة FIFO، مع مطابقة محددة اختيارية.
 * 3) تحليل القيمة المكتسبة EVM: موازنة البند (مركز تكلفة) مقابل التكلفة الفعلية
 *    مقابل قيمة الإنجاز، بمؤشرات CPI/SPI وتنبيهات تجاوز الموازنة.
 * 4) محرك موافقات تسلسلية متعددة المستويات قابل للتخصيص لكل إجراء حرج.
 */
import type { Minor } from './money.ts'
import { type JournalLine, assertBalanced } from './ledger.ts'

/* ═══════════════ 1) أذون صرف المواد ═══════════════ */

export interface MaterialIssueLine {
  itemId: number
  nameAr: string
  /** الكمية المصروفة بالوحدة المختارة */
  qty: number
  /** الوحدة المختارة (الأساسية أو وحدة إضافية) */
  unitAr: string
  /** معامل التحويل للوحدة الأساسية (الوحدة الأساسية = 1) */
  unitFactor: number
  /** الكمية بالوحدة الأساسية بعد التحويل = qty × unitFactor */
  baseQty: number
  /** تكلفة الوحدة الأساسية وقت الصرف (متوسط مرجح) */
  unitCostMinor: Minor
  /** تكلفة السطر = baseQty × unitCostMinor (مقرَّبة) */
  costMinor: Minor
}

export type RequisitionStatus = 'issued' | 'cancelled'

/** إذن صرف مواد لمشروع — مستند رسمي بصارف ومستلم إلزاميين */
export interface MaterialRequisition {
  id: number
  reqNumber: string // MRQ-0001
  projectId: number
  date: string
  /** أمين المخزن (الصارف) — إلزامي من سجل الموظفين */
  issuedByEmployeeId: number
  issuedByName: string
  /** مهندس الموقع / المشرف (المستلم) — إلزامي من سجل الموظفين */
  receivedByEmployeeId: number
  receivedByName: string
  lines: MaterialIssueLine[]
  totalCostMinor: Minor
  notes: string
  status: RequisitionStatus
  journalEntryId: number
}

/** سجل تدقيق حركة مخزون (أمر الإصلاح: Audit Trail كامل للحركات) */
export interface StockMove {
  id: number
  date: string // ISO كامل
  itemId: number
  /** موجب = وارد، سالب = منصرف (بالوحدة الأساسية) */
  qtyDelta: number
  balanceAfter: number
  reason: string // «إذن صرف MRQ-0001»، «فاتورة شراء PI-0002»…
  docType: string // material_issue | purchase | sale | stocktake…
  docId: number
  byUser: string
}

export interface IssueLineInput {
  itemId: number
  qty: number
  /** '' أو الوحدة الأساسية؛ أو اسم وحدة إضافية معرفة على الصنف */
  unitAr: string
}

/** يبني سطر صرف محوَّلاً للوحدة الأساسية ويتحقق من توافر المخزون (لا سالب إطلاقاً) */
export function buildIssueLine(
  input: IssueLineInput,
  item: { id: number; nameAr: string; baseUnit: string; stockQty: number; costMinor: Minor; extraUnits: { nameAr: string; factor: number }[] },
  alreadyPlannedBaseQty: number,
): MaterialIssueLine {
  if (!(input.qty > 0)) throw new Error(`كمية «${item.nameAr}» يجب أن تكون موجبة`)
  let factor = 1
  let unitAr = item.baseUnit
  if (input.unitAr && input.unitAr !== item.baseUnit) {
    const extra = item.extraUnits.find((u) => u.nameAr === input.unitAr)
    if (!extra) throw new Error(`الوحدة «${input.unitAr}» غير معرفة على الصنف «${item.nameAr}»`)
    factor = extra.factor
    unitAr = extra.nameAr
  }
  const baseQty = Math.round(input.qty * factor * 1000) / 1000
  const available = Math.round((item.stockQty - alreadyPlannedBaseQty) * 1000) / 1000
  if (baseQty > available) {
    throw new Error(`رصيد «${item.nameAr}» لا يكفي — المتاح ${available} ${item.baseUnit} والمطلوب ${baseQty}`)
  }
  const unitCost = Number.isInteger(item.costMinor) && item.costMinor >= 0 ? item.costMinor : 0
  const costMinor = Math.round(baseQty * unitCost)
  return { itemId: item.id, nameAr: item.nameAr, qty: input.qty, unitAr, unitFactor: factor, baseQty, unitCostMinor: unitCost, costMinor }
}

/** قيد إذن الصرف: من ح/ 5110 تكاليف مشروعات ← إلى ح/ 1103 المخزون (بالمتوسط المرجح) */
export function buildMaterialIssueEntry(totalCostMinor: Minor, label: string): JournalLine[] {
  if (!Number.isInteger(totalCostMinor) || totalCostMinor <= 0) throw new Error('تكلفة إذن الصرف يجب أن تكون موجبة')
  const lines: JournalLine[] = [
    { accountCode: '5110', debit: totalCostMinor, credit: 0, note: `مواد منصرفة ${label}` },
    { accountCode: '1103', debit: 0, credit: totalCostMinor, note: 'إخراج مخزون بالمتوسط المرجح' },
  ]
  assertBalanced(lines)
  return lines
}

/* ═══════════════ 2) تحصيلات العملاء FIFO ═══════════════ */

/** فاتورة مفتوحة قابلة للإطفاء (مستخلص آجل أو فاتورة بيع آجلة) */
export interface OpenInvoice {
  /** مفتاح المستند: sale:12 أو extract:3 — فريد عبر الأنواع */
  docKey: string
  docLabel: string
  date: string
  /** المستحق الآجل الأصلي */
  dueMinor: Minor
  /** المُحصَّل منه حتى الآن */
  settledMinor: Minor
}

export interface FifoAllocation {
  docKey: string
  docLabel: string
  appliedMinor: Minor
}

/**
 * توزيع تحصيل على الفواتير المفتوحة:
 * - الافتراضي FIFO بالأقدم أولاً (على مستوى الحساب الإجمالي للعميل).
 * - مطابقة محددة اختيارية: تُطفأ الفاتورة المحددة أولاً ثم الباقي FIFO.
 * - يُسمح بتحصيل يفوق المفتوح (دفعة تحت الحساب) — الفائض يبقى غير مخصص.
 */
export function allocateClientPayment(
  amountMinor: Minor,
  openInvoices: readonly OpenInvoice[],
  specificDocKey: string | null = null,
): { allocations: FifoAllocation[]; unallocatedMinor: Minor } {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) throw new Error('مبلغ التحصيل يجب أن يكون موجباً')
  const open = openInvoices
    .map((inv) => ({ ...inv, remaining: inv.dueMinor - inv.settledMinor }))
    .filter((inv) => inv.remaining > 0)
    // كاسر تعادل حتمي: مستندات بنفس اللحظة تُرتب بالمفتاح — يمنع تذبذب FIFO
    .sort((a, b) => a.date.localeCompare(b.date) || a.docKey.localeCompare(b.docKey))
  if (specificDocKey != null) {
    const idx = open.findIndex((inv) => inv.docKey === specificDocKey)
    if (idx < 0) throw new Error('الفاتورة المحددة غير مفتوحة أو مسددة بالكامل')
    const [chosen] = open.splice(idx, 1)
    open.unshift(chosen)
  }
  const allocations: FifoAllocation[] = []
  let rest = amountMinor
  for (const inv of open) {
    if (rest <= 0) break
    const take = Math.min(rest, inv.remaining)
    allocations.push({ docKey: inv.docKey, docLabel: inv.docLabel, appliedMinor: take })
    rest -= take
  }
  return { allocations, unallocatedMinor: rest }
}

/** يتحقق من توزيع يدوي على عدة فواتير قبل إنشاء القيد — لا يثق بالقيم القادمة من الواجهة. */
export function validatePaymentAllocations(
  amountMinor: Minor,
  openInvoices: readonly OpenInvoice[],
  requested: readonly FifoAllocation[],
): { allocations: FifoAllocation[]; unallocatedMinor: Minor } {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) throw new Error('مبلغ السداد يجب أن يكون موجباً')
  const open = new Map(openInvoices.map((invoice) => [invoice.docKey, invoice]))
  const seen = new Set<string>()
  let allocated = 0
  const allocations: FifoAllocation[] = []
  for (const row of requested) {
    const docKey = String(row.docKey ?? '')
    const invoice = open.get(docKey)
    const appliedMinor = Number(row.appliedMinor)
    if (!invoice) throw new Error(`المستند ${docKey || 'غير محدد'} غير مفتوح أو لا يخص الطرف`)
    if (seen.has(docKey)) throw new Error(`لا يجوز تكرار توزيع المستند ${docKey}`)
    if (!Number.isInteger(appliedMinor) || appliedMinor <= 0) throw new Error(`قيمة توزيع ${docKey} يجب أن تكون موجبة بوحدة صحيحة`)
    const remaining = invoice.dueMinor - invoice.settledMinor
    if (appliedMinor > remaining) throw new Error(`توزيع ${docKey} أكبر من المتبقي (${remaining})`)
    if (allocated + appliedMinor > amountMinor) throw new Error('مجموع توزيعات السداد أكبر من مبلغ العملية')
    seen.add(docKey)
    allocated += appliedMinor
    allocations.push({ docKey, docLabel: invoice.docLabel, appliedMinor })
  }
  return { allocations, unallocatedMinor: amountMinor - allocated }
}

/** قيد التحصيل: خزينة/بنك مدين ← 1104 العملاء دائن (على مستوى الحساب العام) */
export function buildClientReceiptEntry(amountMinor: Minor, treasury: string, label: string): JournalLine[] {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) throw new Error('مبلغ التحصيل يجب أن يكون موجباً')
  const lines: JournalLine[] = [
    { accountCode: treasury, debit: amountMinor, credit: 0, note: `تحصيل ${label}` },
    { accountCode: '1104', debit: 0, credit: amountMinor, note: 'إطفاء ذمة العميل' },
  ]
  assertBalanced(lines)
  return lines
}

/* ═══════════════ 3) تحليل القيمة المكتسبة EVM ═══════════════ */

export interface EvmLineInput {
  boqItemId: number
  code: string
  descriptionAr: string
  qty: number
  unitPriceMinor: Minor // سعر البيع للبند
  estCostMinor: Minor // التكلفة التقديرية للوحدة (الموازنة)
  progressPercent: number // 0–100
}

export interface EvmLineResult {
  boqItemId: number
  code: string
  descriptionAr: string
  /** BAC البندي = كمية × تكلفة تقديرية */
  budgetCostMinor: Minor
  /** EV = قيمة الإنجاز بسعر البيع = إجمالي البند × نسبة الإنجاز */
  earnedValueMinor: Minor
  /** الموازنة المكتسبة = الموازنة × نسبة الإنجاز (لمقارنة عادلة بالفعلي) */
  earnedBudgetMinor: Minor
  overBudget: boolean
}

export interface EvmProjectResult {
  lines: EvmLineResult[]
  /** BAC = مجموع موازنات البنود */
  budgetAtCompletionMinor: Minor
  /** القيمة التعاقدية للبنود */
  contractLinesTotalMinor: Minor
  /** EV الكلي */
  earnedValueMinor: Minor
  /** الموازنة المكتسبة الكلية (BCWP بالتكلفة) */
  earnedBudgetMinor: Minor
  /** AC = التكلفة الفعلية المسجلة على المشروع */
  actualCostMinor: Minor
  /** CPI = الموازنة المكتسبة ÷ الفعلي (>1 جيد) — null لو لا فعلي */
  cpi: number | null
  /** SPI = EV ÷ القيمة التعاقدية المخططة حتى الآن (تقريب: الإنجاز الكلي) */
  progressPercent: number
  /** تنبيهات تجاوز: الفعلي الكلي > الموازنة المكتسبة */
  costOverrun: boolean
  overrunMinor: Minor
}

export function computeProjectEvm(lines: readonly EvmLineInput[], actualCostMinor: Minor): EvmProjectResult {
  const out: EvmLineResult[] = []
  let bac = 0, contractTotal = 0, ev = 0, eb = 0, weightedProgress = 0
  for (const l of lines) {
    const lineTotal = Math.round(l.qty * l.unitPriceMinor)
    const lineBudget = Math.round(l.qty * l.estCostMinor)
    const p = Math.min(100, Math.max(0, l.progressPercent))
    const lineEv = Math.round((lineTotal * p) / 100)
    const lineEb = Math.round((lineBudget * p) / 100)
    bac += lineBudget
    contractTotal += lineTotal
    ev += lineEv
    eb += lineEb
    weightedProgress += lineTotal * p
    out.push({
      boqItemId: l.boqItemId, code: l.code, descriptionAr: l.descriptionAr,
      budgetCostMinor: lineBudget, earnedValueMinor: lineEv, earnedBudgetMinor: lineEb,
      overBudget: false, // يُحدد على المستوى الكلي — التكاليف الفعلية لا تُسند بندياً بعد
    })
  }
  const progress = contractTotal > 0 ? Math.round((weightedProgress / contractTotal) * 10) / 10 : 0
  const costOverrun = actualCostMinor > eb && eb > 0
  return {
    lines: out,
    budgetAtCompletionMinor: bac,
    contractLinesTotalMinor: contractTotal,
    earnedValueMinor: ev,
    earnedBudgetMinor: eb,
    actualCostMinor,
    cpi: actualCostMinor > 0 ? Math.round((eb / actualCostMinor) * 100) / 100 : null,
    progressPercent: progress,
    costOverrun,
    overrunMinor: costOverrun ? actualCostMinor - eb : 0,
  }
}

/* ═══════════════ 4) محرك الموافقات التسلسلية ═══════════════ */

/** الإجراءات الحرجة الخاضعة للموافقات (أمر التعديل) */
export type ApprovalAction =
  | 'quotation_to_project' // تحويل عرض سعر لمشروع
  | 'material_requisition' // إذن صرف مواد
  | 'sub_certificate' // اعتماد مستخلص مقاول باطن
  | 'project_extract' // إصدار مستخلص عميل نهائي

export const APPROVAL_ACTION_LABELS: Record<ApprovalAction, string> = {
  quotation_to_project: 'تحويل عرض سعر إلى مشروع',
  material_requisition: 'إذن صرف مواد لمشروع',
  sub_certificate: 'اعتماد مستخلص مقاول باطن',
  project_extract: 'إصدار مستخلص عميل',
}

/** مسار موافقة مُعرَّف: تسلسل أدوار (مهندس موقع ← مدير مشروع ← محاسب أول…) */
export interface ApprovalFlow {
  id: number
  action: ApprovalAction
  /** أسماء المستويات بالترتيب — من سجل الموظفين أو مسميات وظيفية */
  steps: { order: number; roleAr: string; employeeId: number | null }[]
  active: boolean
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected'

export interface ApprovalRequest {
  id: number
  action: ApprovalAction
  /** وصف موجز للمستند: «تحويل QT-0003»، «إذن صرف لمشروع PRJ-0001 بقيمة…» */
  subject: string
  /** معرف المستند المرشح (عرض السعر/المشروع/العقد…) */
  refId: number
  createdAt: string
  status: ApprovalStatus
  /** المستوى الحالي المنتظر (index داخل steps) */
  currentStep: number
  /** متى استُهلك الاعتماد بتنفيذ الإجراء (null = لم يُستهلك بعد) */
  consumedAt: string | null
  decisions: { step: number; roleAr: string; decidedBy: string; decision: 'approved' | 'rejected'; note: string; at: string }[]
}

export function validateApprovalFlow(steps: { roleAr: string }[]): string[] {
  const errors: string[] = []
  if (steps.length === 0) errors.push('مسار الموافقة يحتاج مستوى واحداً على الأقل')
  if (steps.length > 6) errors.push('بحد أقصى 6 مستويات')
  for (const s of steps) if (!s.roleAr.trim()) errors.push('اسم الدور مطلوب في كل مستوى')
  return errors
}

/**
 * تنفيذ قرار على طلب موافقة — يعيد الطلب بعد القرار:
 * موافقة على آخر مستوى = approved؛ رفض في أي مستوى = rejected نهائياً.
 */
export function applyApprovalDecision(
  request: ApprovalRequest,
  flow: ApprovalFlow,
  decision: 'approved' | 'rejected',
  decidedBy: string,
  note: string,
): ApprovalRequest {
  if (request.status !== 'pending') throw new Error('الطلب محسوم بالفعل')
  const step = flow.steps[request.currentStep]
  if (!step) throw new Error('مستوى الموافقة غير موجود في المسار')
  const decisions = [...request.decisions, {
    step: request.currentStep, roleAr: step.roleAr, decidedBy, decision, note, at: new Date().toISOString(),
  }]
  if (decision === 'rejected') return { ...request, status: 'rejected', decisions }
  const isLast = request.currentStep >= flow.steps.length - 1
  return isLast
    ? { ...request, status: 'approved', decisions }
    : { ...request, currentStep: request.currentStep + 1, decisions }
}
