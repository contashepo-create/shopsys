/**
 * وحدة محاسبة المقاولات (القرار 27) — نواة خالصة
 * ──────────────────────────────────────────────
 * المشروع هو وحدة العمل: عقد بقيمة إجمالية + نسبة محتجز ضمان أعمال،
 * الإيراد يُعترف به بالمستخلصات (فوترة مرحلية)، والتكاليف تُسجل على
 * المشروع ببنود (مواد/عمالة/معدات/مقاول باطن/أخرى)، وربحية كل مشروع
 * = مستخلصاته − تكاليفه. المحتجز يُفرج عنه بعد التسليم بقيد مستقل.
 *
 * القيود على المحرك الموحد:
 * - مستخلص: 1101|1104 (الصافي) + 1105 (المحتجز) ← 4107 + 2102
 * - تكلفة: 5110 ← 1101 (نقدي) | 2101 (آجل على مورد/مقاول باطن)
 * - إفراج محتجز: 1101 ← 1105
 */
import type { Minor } from './money.ts'
import { assertBalanced, type JournalLine } from './ledger.ts'

export type ProjectStatus = 'active' | 'completed'

export interface Project {
  id: number
  code: string // PRJ-0001
  nameAr: string
  clientName: string
  /**
   * ربط إداري بحت بسجل العميل (طلب المالك — أمر التعديل):
   * لا يؤثر إطلاقاً على رصيد العميل المحاسبي؛ الذمة تنشأ فقط
   * من مستخلص/فاتورة رسمية. null = بلا ربط.
   */
  clientId: number | null
  contractValueMinor: Minor // قيمة العقد (استرشادية للتقدم)
  retentionPercent: number // نسبة محتجز ضمان الأعمال من كل مستخلص
  startDate: string // YYYY-MM-DD
  status: ProjectStatus
  notes: string
  /* بيانات تشغيلية موسعة (أمر التعديل: نماذج احترافية) — كلها اختيارية */
  contractNumber?: string // رقم العقد الرسمي مع الجهة
  location?: string // موقع التنفيذ
  expectedEndDate?: string // تاريخ التسليم المتوقع
  managerEmployeeId?: number | null // مدير المشروع من سجل الموظفين
  tags?: string[] // وسوم حرة للتصنيف والفلترة
}

export function validateProject(p: Pick<Project, 'nameAr' | 'contractValueMinor' | 'retentionPercent'>): string[] {
  const errors: string[] = []
  if (!p.nameAr.trim()) errors.push('اسم المشروع مطلوب')
  if (!Number.isInteger(p.contractValueMinor) || p.contractValueMinor <= 0) errors.push('قيمة العقد يجب أن تكون موجبة')
  if (p.retentionPercent < 0 || p.retentionPercent > 20) errors.push('نسبة المحتجز بين 0 و20٪')
  return errors
}

/* ─── المستخلصات ─── */

export interface ExtractTotals {
  grossMinor: Minor // قيمة الأعمال بالمستخلص
  vatMinor: Minor
  retentionMinor: Minor // المحتجز (من قيمة الأعمال قبل الضريبة)
  dueMinor: Minor // المستحق تحصيله = قيمة + ضريبة − محتجز
}

export function computeExtractTotals(grossMinor: Minor, retentionPercent: number, vatPercent: number): ExtractTotals {
  if (!Number.isInteger(grossMinor) || grossMinor <= 0) throw new Error('قيمة المستخلص يجب أن تكون موجبة')
  if (vatPercent < 0 || vatPercent > 100) throw new Error('نسبة الضريبة بين 0 و100')
  if (retentionPercent < 0 || retentionPercent > 20) throw new Error('نسبة المحتجز بين 0 و20٪')
  const vat = Math.round((grossMinor * vatPercent) / 100)
  const retention = Math.round((grossMinor * retentionPercent) / 100)
  return { grossMinor, vatMinor: vat, retentionMinor: retention, dueMinor: grossMinor + vat - retention }
}

/**
 * قيد المستخلص المتوازن:
 *   من ح/ 1101|1104 المستحق + 1105 المحتجز ← إلى ح/ 4107 إيراد + 2102 ضريبة
 */
export function buildExtractEntry(t: ExtractTotals, payment: 'cash' | 'credit', label: string, treasury = '1101'): JournalLine[] {
  const lines: JournalLine[] = [
    { accountCode: payment === 'cash' ? treasury : '1104', debit: t.dueMinor, credit: 0, note: `مستحق ${label}` },
  ]
  if (t.retentionMinor > 0) lines.push({ accountCode: '1105', debit: t.retentionMinor, credit: 0, note: 'محتجز ضمان أعمال' })
  lines.push({ accountCode: '4107', debit: 0, credit: t.grossMinor, note: 'إيراد مقاولات' })
  if (t.vatMinor > 0) lines.push({ accountCode: '2102', debit: 0, credit: t.vatMinor, note: 'ض.ق.م' })
  assertBalanced(lines)
  return lines
}

/* ─── تكاليف المشروع ─── */

export type CostKind = 'materials' | 'labor' | 'equipment' | 'subcontract' | 'other'

export const COST_KIND_LABELS: Record<CostKind, { nameAr: string; icon: string }> = {
  materials: { nameAr: 'مواد وخامات', icon: '🧱' },
  labor: { nameAr: 'عمالة', icon: '👷' },
  equipment: { nameAr: 'معدات', icon: '🚜' },
  subcontract: { nameAr: 'مقاول باطن', icon: '🤝' },
  other: { nameAr: 'أخرى', icon: '📎' },
}

/** قيد تكلفة: 5110 ← 1101 نقدي أو 2101 آجل (مورد/مقاول باطن) */
export function buildProjectCostEntry(amountMinor: Minor, payment: 'cash' | 'credit', label: string, treasury = '1101'): JournalLine[] {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) throw new Error('قيمة التكلفة يجب أن تكون موجبة')
  const lines: JournalLine[] = [
    { accountCode: '5110', debit: amountMinor, credit: 0, note: `تكلفة ${label}` },
    { accountCode: payment === 'cash' ? treasury : '2101', debit: 0, credit: amountMinor, note: payment === 'cash' ? 'سداد نقدي' : 'مستحق للمورد' },
  ]
  assertBalanced(lines)
  return lines
}

/**
 * قيد فاتورة شراء مربوطة بمشروع (طلب المالك):
 * البضاعة تذهب للموقع مباشرة فتُحمَّل تكلفةً على المشروع لا مخزوناً:
 *   من ح/ 5110 تكاليف مشروعات (الإجمالي بمصاريفه)
 *     إلى ح/ الخزينة|1108 عهدة (المدفوع) + 2101 الموردون (المتبقي)
 */
export function buildProjectPurchaseEntry(grandTotalMinor: Minor, paidMinor: Minor, payAccount: string, projectLabel: string): JournalLine[] {
  if (!Number.isInteger(grandTotalMinor) || grandTotalMinor <= 0) throw new Error('إجمالي الفاتورة يجب أن يكون موجباً')
  if (!Number.isInteger(paidMinor) || paidMinor < 0) throw new Error('المدفوع لا يكون سالباً')
  if (paidMinor > grandTotalMinor) throw new Error('المدفوع أكبر من إجمالي الفاتورة')
  const remaining = grandTotalMinor - paidMinor
  const lines: JournalLine[] = [
    { accountCode: '5110', debit: grandTotalMinor, credit: 0, note: `مشتريات لمشروع ${projectLabel}` },
  ]
  if (paidMinor > 0) lines.push({ accountCode: payAccount, debit: 0, credit: paidMinor, note: 'المدفوع' })
  if (remaining > 0) lines.push({ accountCode: '2101', debit: 0, credit: remaining, note: 'مستحق للمورد' })
  assertBalanced(lines)
  return lines
}

/** قيد الإفراج عن المحتجز بعد التسليم النهائي: 1101 ← 1105 */
export function buildRetentionReleaseEntry(amountMinor: Minor, label: string, treasury = '1101'): JournalLine[] {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) throw new Error('لا محتجزات للإفراج عنها')
  const lines: JournalLine[] = [
    { accountCode: treasury, debit: amountMinor, credit: 0, note: `تحصيل محتجز ${label}` },
    { accountCode: '1105', debit: 0, credit: amountMinor, note: 'إفراج عن محتجز ضمان' },
  ]
  assertBalanced(lines)
  return lines
}

/* ─── ربحية المشروع ─── */

export interface ProjectProfit {
  extractedMinor: Minor // إجمالي المستخلصات (قيمة الأعمال)
  costsMinor: Minor
  costsByKind: Record<CostKind, Minor>
  profitMinor: Minor
  marginPercent: number // هامش الربح ٪ من المستخلصات
  progressPercent: number // نسبة الإنجاز = المستخلصات ÷ قيمة العقد
  retentionHeldMinor: Minor // محتجزات لم يُفرج عنها بعد
}

export function projectProfit(
  project: Pick<Project, 'contractValueMinor'>,
  extracts: readonly { grossMinor: Minor; retentionMinor: Minor }[],
  costs: readonly { kind: CostKind; amountMinor: Minor }[],
  releasedRetentionMinor: Minor,
): ProjectProfit {
  const extracted = extracts.reduce((a, e) => a + e.grossMinor, 0)
  const retained = extracts.reduce((a, e) => a + e.retentionMinor, 0)
  const byKind: Record<CostKind, Minor> = { materials: 0, labor: 0, equipment: 0, subcontract: 0, other: 0 }
  let total = 0
  for (const c of costs) { byKind[c.kind] += c.amountMinor; total += c.amountMinor }
  const profit = extracted - total
  return {
    extractedMinor: extracted,
    costsMinor: total,
    costsByKind: byKind,
    profitMinor: profit,
    marginPercent: extracted > 0 ? Math.round((profit / extracted) * 1000) / 10 : 0,
    progressPercent: project.contractValueMinor > 0 ? Math.min(100, Math.round((extracted / project.contractValueMinor) * 1000) / 10) : 0,
    retentionHeldMinor: Math.max(0, retained - releasedRetentionMinor),
  }
}

/* ─── عروض الأسعار والمناقصات (طلب المالك — مرجعية pro-acc) ─── */

/**
 * عرض السعر/المناقصة: مستند غير محاسبي (لا قيد) يسبق العقد —
 * draft → submitted → won | lost، والفائز يتحول لمشروع بضغطة واحدة.
 */
export type QuotationStatus = 'draft' | 'submitted' | 'won' | 'lost'

export const QUOTATION_STATUS_LABELS: Record<QuotationStatus, { nameAr: string; icon: string }> = {
  draft: { nameAr: 'مسودة', icon: '📝' },
  submitted: { nameAr: 'مقدَّم', icon: '📤' },
  won: { nameAr: 'فائز ✓', icon: '🏆' },
  lost: { nameAr: 'خاسر', icon: '❌' },
}

export interface QuotationLine {
  nameAr: string // اسم البند المختصر
  descriptionAr: string // وصف تفصيلي للأعمال
  qty: number
  unitAr: string // م2، م.ط، مقطوعية…
  unitPriceMinor: Minor
  /** التكلفة التقديرية للوحدة — أساس موازنة البند وتحليل EVM */
  estCostMinor: Minor
}

/** إجمالي بند = كمية × سعر وحدة (مقرَّب) */
export function quotationLineTotal(l: Pick<QuotationLine, 'qty' | 'unitPriceMinor'>): Minor {
  return Math.round(l.qty * l.unitPriceMinor)
}

/** إجمالي التكلفة التقديرية لبنود عرض */
export function quotationEstCost(lines: readonly QuotationLine[]): Minor {
  return lines.reduce((s, l) => s + Math.round(l.qty * l.estCostMinor), 0)
}

export interface Quotation {
  id: number
  quoteNumber: string // QT-0001
  kind: 'quotation' | 'tender' // عرض سعر | مناقصة
  clientName: string
  /** ربط إداري بسجل العميل — لا أثر محاسبياً (الذمة من الفاتورة فقط) */
  clientId: number | null
  titleAr: string
  date: string
  validUntil: string
  lines: QuotationLine[]
  status: QuotationStatus
  notes: string
  projectId: number | null // المشروع المتولد عند الفوز
}

export function quotationTotal(lines: readonly QuotationLine[]): Minor {
  return lines.reduce((a, l) => a + Math.round(l.qty * l.unitPriceMinor), 0)
}

export function validateQuotation(q: Pick<Quotation, 'titleAr' | 'clientName' | 'lines'>): string[] {
  const errors: string[] = []
  if (!q.titleAr.trim()) errors.push('عنوان العرض مطلوب')
  if (!q.clientName.trim()) errors.push('اسم العميل/الجهة مطلوب')
  const meaningful = q.lines.filter((l) => l.descriptionAr.trim() && l.qty > 0)
  if (meaningful.length === 0) errors.push('بند واحد على الأقل بكمية موجبة')
  for (const l of meaningful) {
    if (!Number.isInteger(l.unitPriceMinor) || l.unitPriceMinor < 0) errors.push(`سعر بند «${l.descriptionAr}» غير صحيح`)
  }
  return [...new Set(errors)]
}

/** انتقالات حالة العرض المسموحة */
export const QUOTATION_TRANSITIONS: Record<QuotationStatus, QuotationStatus[]> = {
  draft: ['submitted'],
  submitted: ['won', 'lost'],
  won: [],
  lost: [],
}

/* ─── العُهد ─── */
// نُقلت العهد البسيطة القديمة إلى نظام «ملفات العهد» المتكامل في core/custody.ts
// (ملف لكل موظف، تعزيزات، صرف فواتير من العهدة، تسوية بعجز/فائض) — طلب المالك.

/* ═══════════════════════════════════════════════════════════════
   عمق المقاولات (مقارنة pro-acc والبرامج العالمية — طلب المالك):
   BOQ، أوامر التغيير، دفعات مقدمة، مقاولو الباطن بشهادات ومحتجزات،
   خطابات الضمان بهوامشها، عمال اليومية، وتقرير WIP.
   ═══════════════════════════════════════════════════════════════ */

/* ─── بنود الأعمال BOQ (جدول الكميات) — مستند تخطيطي بلا قيود ─── */
export interface BoqItem {
  id: number
  projectId: number
  code: string // ترقيم البند: 1-1، 2-3…
  descriptionAr: string
  unit: string // م2، م3، طن، مقطوعية…
  qty: number
  unitPriceMinor: Minor
  /** التكلفة التقديرية للوحدة — موازنة البند (مركز تكلفة) لتحليل EVM والتنبيهات */
  estCostMinor: Minor
  /** نسبة الإنجاز 0–100 — تُحدَّث مع المستخلصات لمتابعة التقدم البندي */
  progressPercent: number
}

export function boqItemTotal(item: Pick<BoqItem, 'qty' | 'unitPriceMinor'>): Minor {
  return Math.round(item.qty * item.unitPriceMinor)
}

export function validateBoqItem(item: Pick<BoqItem, 'descriptionAr' | 'unit' | 'qty' | 'unitPriceMinor'>): string[] {
  const errors: string[] = []
  if (!item.descriptionAr.trim()) errors.push('وصف البند مطلوب')
  if (!item.unit.trim()) errors.push('وحدة القياس مطلوبة')
  if (!(item.qty > 0)) errors.push('الكمية يجب أن تكون موجبة')
  if (!Number.isInteger(item.unitPriceMinor) || item.unitPriceMinor < 0) errors.push('سعر الوحدة غير صحيح')
  return errors
}

/* ─── أوامر التغيير — تعديل معتمد على قيمة العقد (لا قيد؛ يغيّر WIP والربحية المتوقعة) ─── */
/* ─── المستخلص البندي من جدول الكميات (نمط AccFlex/دفترة — قلب محاسبة المقاولات):
   لكل بند نسبة إنجاز تراكمية جديدة؛ قيمة المستخلص الحالي =
   Σ (إجمالي البند × (النسبة الجديدة − النسبة السابقة)) — لا إعادة إدخال بنود ─── */

export interface ExtractLineInput {
  boqItemId: number
  /** النسبة التراكمية الجديدة 0–100 — يجب ألا تقل عن السابقة */
  newProgressPercent: number
}

export interface ExtractLineComputed {
  boqItemId: number
  code: string
  descriptionAr: string
  boqTotalMinor: Minor
  prevProgressPercent: number
  newProgressPercent: number
  /** قيمة الشريحة المنفذة في هذا المستخلص */
  lineValueMinor: Minor
}

/** حساب بنود المستخلص من BOQ — يرمي عند نسبة راجعة أو فوق 100 أو بند غير موجود */
export function computeExtractLines(
  lines: readonly ExtractLineInput[],
  boqItems: readonly Pick<BoqItem, 'id' | 'code' | 'descriptionAr' | 'qty' | 'unitPriceMinor' | 'progressPercent'>[],
): { computed: ExtractLineComputed[]; grossMinor: Minor } {
  if (lines.length === 0) throw new Error('اختر بنداً واحداً على الأقل من جدول الكميات')
  const computed: ExtractLineComputed[] = []
  for (const l of lines) {
    const item = boqItems.find((b) => b.id === l.boqItemId)
    if (!item) throw new Error(`بند الكميات #${l.boqItemId} غير موجود`)
    if (!Number.isFinite(l.newProgressPercent) || l.newProgressPercent < 0 || l.newProgressPercent > 100) {
      throw new Error(`نسبة غير صالحة للبند ${item.code} — بين 0 و100`)
    }
    if (l.newProgressPercent < item.progressPercent) {
      throw new Error(`البند ${item.code}: النسبة الجديدة (${l.newProgressPercent}٪) أقل من المنفذ سابقاً (${item.progressPercent}٪) — المستخلص تراكمي لا يتراجع`)
    }
    const total = boqItemTotal(item)
    const slice = Math.round(total * (l.newProgressPercent - item.progressPercent) / 100)
    computed.push({
      boqItemId: item.id, code: item.code, descriptionAr: item.descriptionAr,
      boqTotalMinor: total,
      prevProgressPercent: item.progressPercent,
      newProgressPercent: l.newProgressPercent,
      lineValueMinor: slice,
    })
  }
  const grossMinor = computed.reduce((a, c) => a + c.lineValueMinor, 0)
  if (grossMinor <= 0) throw new Error('قيمة المستخلص صفر — لا نسب تقدم جديدة في البنود المختارة')
  return { computed, grossMinor }
}

/* ─── موازنة تكاليف المشروع بالفئات + تقرير الانحرافات (نمط AccFlex/pro-acc):
   موازنة معيارية لكل فئة (مواد/عمالة/معدات/باطن/أخرى) تقارن بالفعلي أولاً بأول ─── */

export interface ProjectBudgetLine {
  kind: CostKind
  amountMinor: Minor
}

export interface BudgetVarianceRow {
  kind: CostKind
  budgetMinor: Minor
  actualMinor: Minor
  varianceMinor: Minor // موجب = وفر، سالب = تجاوز
  usagePercent: number // الفعلي ÷ الموازنة ×100 (0 عند غياب موازنة)
  status: 'ok' | 'warning' | 'over' // >85٪ تحذير، >100٪ تجاوز
}

export function budgetVarianceReport(
  budgets: readonly ProjectBudgetLine[],
  costs: readonly { kind: CostKind; amountMinor: Minor }[],
): { rows: BudgetVarianceRow[]; totalBudgetMinor: Minor; totalActualMinor: Minor } {
  const kinds: CostKind[] = ['materials', 'labor', 'equipment', 'subcontract', 'other']
  const rows: BudgetVarianceRow[] = []
  for (const kind of kinds) {
    const budget = budgets.filter((b) => b.kind === kind).reduce((a, b) => a + b.amountMinor, 0)
    const actual = costs.filter((c) => c.kind === kind).reduce((a, c) => a + c.amountMinor, 0)
    if (budget === 0 && actual === 0) continue
    const usage = budget > 0 ? Math.round((actual / budget) * 100) : actual > 0 ? 100 : 0
    rows.push({
      kind, budgetMinor: budget, actualMinor: actual,
      varianceMinor: budget - actual,
      usagePercent: usage,
      // فعلي بلا موازنة = تجاوز صريح (إنفاق خارج الخطة)
      status: actual > budget ? 'over' : budget > 0 && usage >= 85 ? 'warning' : 'ok',
    })
  }
  return {
    rows,
    totalBudgetMinor: rows.reduce((a, r) => a + r.budgetMinor, 0),
    totalActualMinor: rows.reduce((a, r) => a + r.actualMinor, 0),
  }
}

export type ChangeOrderStatus = 'draft' | 'approved' | 'invoiced' | 'rejected'

export interface ChangeOrder {
  id: number
  projectId: number
  number: string // CO-0001
  titleAr: string
  /** موجب = أعمال إضافية، سالب = تخفيض نطاق */
  amountMinor: Minor
  status: ChangeOrderStatus
  date: string
  approvedAt: string | null
}

export const CHANGE_ORDER_STATUS_LABELS: Record<ChangeOrderStatus, { nameAr: string; icon: string }> = {
  draft: { nameAr: 'مسودة', icon: '📝' },
  approved: { nameAr: 'معتمد', icon: '✅' },
  invoiced: { nameAr: 'مُستخلَص (فُوتر)', icon: '🧾' },
  rejected: { nameAr: 'مرفوض', icon: '❌' },
}

/** قيمة العقد الفعلية = الأصلية + أوامر التغيير المعتمدة فقط */
export function effectiveContractValue(baseMinor: Minor, orders: readonly ChangeOrder[]): Minor {
  // «مُستخلَص» = معتمد سبق فوترته — يبقى ضمن قيمة العقد الفعلية
  return baseMinor + orders.filter((o) => o.status === 'approved' || o.status === 'invoiced').reduce((a, o) => a + o.amountMinor, 0)
}

/* ─── الدفعات المقدمة من العملاء — التزام 2109 يُسترد تدريجياً من المستخلصات ─── */

/**
 * قيد استلام دفعة مقدمة: نقدية مدين ← 2109 دائن.
 * لماذا التزام لا إيراد؟ لأن الأعمال لم تُنفَّذ بعد — الاعتراف بالإيراد
 * يكون بالمستخلصات فقط، والدفعة تُستهلك منها (المعيار الدولي IFRS 15).
 */
export function buildClientAdvanceEntry(amountMinor: Minor, treasury: string, projectLabel: string): JournalLine[] {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) throw new Error('قيمة الدفعة المقدمة يجب أن تكون موجبة')
  const lines: JournalLine[] = [
    { accountCode: treasury, debit: amountMinor, credit: 0, note: `دفعة مقدمة — ${projectLabel}` },
    { accountCode: '2109', debit: 0, credit: amountMinor, note: 'التزام حتى تنفيذ الأعمال' },
  ]
  assertBalanced(lines)
  return lines
}

/**
 * قيد مستخلص باسترداد دفعة مقدمة (يوسّع buildExtractEntry):
 *   مدين: نقدية|عملاء (المستحق بعد الاسترداد) + 1105 محتجز + 2109 استرداد الدفعة
 *   دائن: 4107 إجمالي الأعمال + 2102 الضريبة
 */
export function buildExtractEntryWithAdvance(
  totals: ExtractTotals, payment: 'cash' | 'credit', extractNumber: string,
  treasury: string, advanceRecoveryMinor: Minor,
): JournalLine[] {
  if (!Number.isInteger(advanceRecoveryMinor) || advanceRecoveryMinor < 0) throw new Error('استرداد الدفعة لا يكون سالباً')
  if (advanceRecoveryMinor === 0) return buildExtractEntry(totals, payment, extractNumber, treasury)
  if (advanceRecoveryMinor > totals.dueMinor) throw new Error('استرداد الدفعة أكبر من مستحق المستخلص')
  const netDue = totals.dueMinor - advanceRecoveryMinor
  const lines: JournalLine[] = []
  if (netDue > 0) lines.push({ accountCode: payment === 'cash' ? treasury : '1104', debit: netDue, credit: 0, note: `مستخلص ${extractNumber} بعد استرداد الدفعة` })
  if (totals.retentionMinor > 0) lines.push({ accountCode: '1105', debit: totals.retentionMinor, credit: 0, note: 'محتجز ضمان' })
  lines.push({ accountCode: '2109', debit: advanceRecoveryMinor, credit: 0, note: 'استرداد من الدفعة المقدمة' })
  lines.push({ accountCode: '4107', debit: 0, credit: totals.grossMinor, note: 'إيراد أعمال المستخلص' })
  if (totals.vatMinor > 0) lines.push({ accountCode: '2102', debit: 0, credit: totals.vatMinor, note: 'ض.ق.م' })
  assertBalanced(lines)
  return lines
}

/* ─── مقاولو الباطن: عقد ← شهادات (مستخلصات باطن) بمحتجز ← دفعات ← إفراج ─── */
export type SubContractStatus = 'active' | 'completed' | 'cancelled'

export interface SubContract {
  id: number
  projectId: number
  contractNumber: string // SC-0001
  contractorName: string
  /** ربط اختياري بسجل مورد — يوحّد كشوف الحساب (أمر التعديل: تكامل الموردين) */
  supplierId: number | null
  scopeAr: string // نطاق الأعمال: حفر، حدادة، تشطيبات…
  contractValueMinor: Minor
  retentionPercent: number // محتجز يُخصم من كل شهادة
  /** نسبة ضريبة الاستقطاع من كل شهادة (0 = بلا) → 2112 */
  taxWithholdPercent: number
  /** نسبة خصم الدفعة المقدمة تلقائياً من كل شهادة (نمط AccFlex — 0 = خصم يدوي) */
  advanceRecoveryPercent: number
  /** نسبة الإنجاز التراكمية المعتمدة بالشهادات 0–100 (تُحدَّث تلقائياً) */
  progressPercent: number
  /** بنود BOQ المسندة لهذا المقاول (إسناد إداري لمتابعة النطاق) */
  boqItemIds: number[]
  status: SubContractStatus
  startDate: string
}

/** دفعة مقدمة لمقاول باطن — أصل (1111) يُسترد من الشهادات */
export interface SubAdvance {
  id: number
  contractId: number
  date: string
  amountMinor: Minor
  recoveredMinor: Minor
  journalEntryId: number
}

/** قيد صرف دفعة مقدمة لمقاول باطن: 1111 مدين ← خزينة دائن */
export function buildSubAdvanceEntry(amountMinor: Minor, treasury: string, label: string): JournalLine[] {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) throw new Error('قيمة الدفعة المقدمة يجب أن تكون موجبة')
  const lines: JournalLine[] = [
    { accountCode: '1111', debit: amountMinor, credit: 0, note: `دفعة مقدمة ${label}` },
    { accountCode: treasury, debit: 0, credit: amountMinor, note: 'المنصرف' },
  ]
  assertBalanced(lines)
  return lines
}

/** شهادة أعمال مقاول باطن (مستخلص باطن) */
export interface SubCertificate {
  id: number
  contractId: number
  number: number // متسلسل داخل العقد
  date: string
  descriptionAr: string
  amountMinor: Minor // قيمة الأعمال المعتمدة
  retentionMinor: Minor // المحتجز منها
  /** ضريبة الاستقطاع المخصومة → التزام 2112 حتى توريدها */
  taxWithholdMinor: Minor
  /** المسترد من الدفعات المقدمة (يطفئ 1111) */
  advanceRecoveryMinor: Minor
  netMinor: Minor // الصافي المستحق للمقاول بعد كل الاستقطاعات
  journalEntryId: number
}

/** دفعة لمقاول باطن (سداد من مستحقاته 2101) */
export interface SubPayment {
  id: number
  contractId: number
  date: string
  amountMinor: Minor
  kind: 'payment' | 'retention_release'
  journalEntryId: number
}

export function validateSubContract(c: Pick<SubContract, 'contractorName' | 'scopeAr' | 'contractValueMinor' | 'retentionPercent'>): string[] {
  const errors: string[] = []
  if (!c.contractorName.trim()) errors.push('اسم مقاول الباطن مطلوب')
  if (!c.scopeAr.trim()) errors.push('نطاق الأعمال مطلوب')
  if (!Number.isInteger(c.contractValueMinor) || c.contractValueMinor <= 0) errors.push('قيمة العقد يجب أن تكون موجبة')
  if (c.retentionPercent < 0 || c.retentionPercent > 20) errors.push('نسبة المحتجز بين 0 و20٪')
  return errors
}

/**
 * قيد شهادة مقاول باطن:
 *   من ح/ 5110 تكاليف مشروعات (كامل قيمة الأعمال)
 *     إلى ح/ 2101 الموردون (الصافي) + 2108 محتجزات الباطن (المحتجز)
 * التكلفة تُعترف كاملة فور اعتماد الأعمال — والمحتجز التزام مؤجل لا خصم من التكلفة.
 */
export function buildSubCertificateEntry(
  amountMinor: Minor, retentionMinor: Minor, taxWithholdMinor: Minor, advanceRecoveryMinor: Minor, label: string,
): JournalLine[] {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) throw new Error('قيمة الشهادة يجب أن تكون موجبة')
  if (!Number.isInteger(retentionMinor) || retentionMinor < 0) throw new Error('المحتجز غير صحيح')
  if (!Number.isInteger(taxWithholdMinor) || taxWithholdMinor < 0) throw new Error('ضريبة الاستقطاع غير صحيحة')
  if (!Number.isInteger(advanceRecoveryMinor) || advanceRecoveryMinor < 0) throw new Error('استرداد الدفعة المقدمة غير صحيح')
  const net = amountMinor - retentionMinor - taxWithholdMinor - advanceRecoveryMinor
  if (net < 0) throw new Error('الاستقطاعات تتجاوز قيمة الشهادة')
  const lines: JournalLine[] = [
    { accountCode: '5110', debit: amountMinor, credit: 0, note: `شهادة أعمال ${label}` },
  ]
  if (net > 0) lines.push({ accountCode: '2101', debit: 0, credit: net, note: 'صافي مستحق مقاول الباطن' })
  if (retentionMinor > 0) lines.push({ accountCode: '2108', debit: 0, credit: retentionMinor, note: 'محتجز ضمان أعمال الباطن' })
  if (taxWithholdMinor > 0) lines.push({ accountCode: '2112', debit: 0, credit: taxWithholdMinor, note: 'ضريبة استقطاع مستحقة' })
  if (advanceRecoveryMinor > 0) lines.push({ accountCode: '1111', debit: 0, credit: advanceRecoveryMinor, note: 'استرداد دفعة مقدمة' })
  assertBalanced(lines)
  return lines
}

/** قيد دفعة لمقاول باطن: 2101 مدين ← نقدية دائن */
export function buildSubPaymentEntry(amountMinor: Minor, treasury: string, label: string): JournalLine[] {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) throw new Error('قيمة الدفعة يجب أن تكون موجبة')
  const lines: JournalLine[] = [
    { accountCode: '2101', debit: amountMinor, credit: 0, note: `دفعة ${label}` },
    { accountCode: treasury, debit: 0, credit: amountMinor, note: 'المنصرف' },
  ]
  assertBalanced(lines)
  return lines
}

/** قيد إفراج محتجزات الباطن بعد استلام أعماله نهائياً: 2108 مدين ← نقدية دائن */
export function buildSubRetentionReleaseEntry(amountMinor: Minor, treasury: string, label: string): JournalLine[] {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) throw new Error('لا محتجزات للإفراج عنها')
  const lines: JournalLine[] = [
    { accountCode: '2108', debit: amountMinor, credit: 0, note: `إفراج محتجزات ${label}` },
    { accountCode: treasury, debit: 0, credit: amountMinor, note: 'المنصرف' },
  ]
  assertBalanced(lines)
  return lines
}

/* ─── مهام المشروع (جدول زمني/جانت مبسط — نمط pro-acc project_tasks) ─── */
export type ProjectTaskStatus = 'pending' | 'in_progress' | 'done'

export interface ProjectTask {
  id: number
  projectId: number
  nameAr: string
  startDate: string // ISO
  endDate: string // ISO
  progressPercent: number // 0–100
  status: ProjectTaskStatus
  /** ربط اختياري ببند BOQ لمزامنة النسبة */
  boqItemId: number | null
}

export const PROJECT_TASK_STATUS_LABELS: Record<ProjectTaskStatus, { nameAr: string; icon: string }> = {
  pending: { nameAr: 'لم تبدأ', icon: '⏳' },
  in_progress: { nameAr: 'جارية', icon: '🔨' },
  done: { nameAr: 'منجزة', icon: '✅' },
}

export function validateProjectTask(t: Pick<ProjectTask, 'nameAr' | 'startDate' | 'endDate' | 'progressPercent'>): string[] {
  const errors: string[] = []
  if (!t.nameAr.trim()) errors.push('اسم المهمة مطلوب')
  if (!t.startDate) errors.push('تاريخ البداية مطلوب')
  if (!t.endDate) errors.push('تاريخ النهاية مطلوب')
  if (t.startDate && t.endDate && t.endDate < t.startDate) errors.push('النهاية لا تسبق البداية')
  if (!Number.isFinite(t.progressPercent) || t.progressPercent < 0 || t.progressPercent > 100) errors.push('نسبة الإنجاز بين 0 و100')
  return errors
}

/* ─── خطابات الضمان البنكية — أصل مجمّد (الهامش) + مصاريف إصدار ─── */
export type BondType = 'bid' | 'performance' | 'advance_payment' | 'retention_release' | 'warranty' | 'insurance' | 'other'
export type BondStatus = 'active' | 'released' | 'forfeited'

export const BOND_TYPE_LABELS: Record<BondType, string> = {
  bid: 'ابتدائي (دخول عطاء)',
  performance: 'نهائي (حسن تنفيذ)',
  advance_payment: 'دفعة مقدمة',
  retention_release: 'بديل محتجزات',
  warranty: 'ضمان صيانة (فترة الضمان)',
  insurance: 'تأمين',
  other: 'أخرى',
}

export interface Bond {
  id: number
  projectId: number | null
  bondNumber: string
  type: BondType
  beneficiary: string // الجهة المستفيدة
  amountMinor: Minor // قيمة الخطاب
  marginMinor: Minor // الهامش المحجوز بالبنك (غطاء نقدي)
  feesMinor: Minor // مصاريف ورسوم الإصدار
  bank: string // حساب البنك المحجوز منه
  issueDate: string
  expiryDate: string
  status: BondStatus
  issueEntryId: number
  settleEntryId: number | null
}

export function validateBond(b: Pick<Bond, 'bondNumber' | 'beneficiary' | 'amountMinor' | 'marginMinor' | 'feesMinor' | 'expiryDate'>): string[] {
  const errors: string[] = []
  if (!b.bondNumber.trim()) errors.push('رقم الخطاب مطلوب')
  if (!b.beneficiary.trim()) errors.push('الجهة المستفيدة مطلوبة')
  if (!Number.isInteger(b.amountMinor) || b.amountMinor <= 0) errors.push('قيمة الخطاب يجب أن تكون موجبة')
  if (!Number.isInteger(b.marginMinor) || b.marginMinor < 0) errors.push('الهامش لا يكون سالباً')
  if (b.marginMinor > b.amountMinor) errors.push('الهامش لا يتجاوز قيمة الخطاب')
  if (!Number.isInteger(b.feesMinor) || b.feesMinor < 0) errors.push('المصاريف لا تكون سالبة')
  if (!b.expiryDate) errors.push('تاريخ الانتهاء مطلوب')
  return errors
}

/**
 * قيد إصدار خطاب ضمان: الهامش نقدية مجمدة (أصل 1109) والمصاريف مصروف فوري:
 *   من ح/ 1109 هوامش الخطابات + 5108 مصروفات ← إلى ح/ البنك
 * قيمة الخطاب نفسها التزام محتمل (contingent) — لا تُقيَّد إلا عند المصادرة.
 */
export function buildBondIssueEntry(marginMinor: Minor, feesMinor: Minor, bank: string, label: string): JournalLine[] {
  if (marginMinor + feesMinor <= 0) throw new Error('لا هامش ولا مصاريف — لا حاجة لقيد')
  const lines: JournalLine[] = []
  if (marginMinor > 0) lines.push({ accountCode: '1109', debit: marginMinor, credit: 0, note: `هامش خطاب ${label}` })
  if (feesMinor > 0) lines.push({ accountCode: '5108', debit: feesMinor, credit: 0, note: 'مصاريف إصدار الخطاب' })
  lines.push({ accountCode: bank, debit: 0, credit: marginMinor + feesMinor, note: 'المحجوز من البنك' })
  assertBalanced(lines)
  return lines
}

/** قيد رد الخطاب (انتهى الغرض): البنك مدين ← 1109 دائن — الهامش يعود حراً */
export function buildBondReleaseEntry(marginMinor: Minor, bank: string, label: string): JournalLine[] {
  if (!Number.isInteger(marginMinor) || marginMinor <= 0) throw new Error('لا هامش لهذا الخطاب')
  const lines: JournalLine[] = [
    { accountCode: bank, debit: marginMinor, credit: 0, note: `رد هامش خطاب ${label}` },
    { accountCode: '1109', debit: 0, credit: marginMinor, note: 'تحرير الهامش' },
  ]
  assertBalanced(lines)
  return lines
}

/** قيد مصادرة الخطاب (سال الضمان): الهامش يتحول خسارة 5108 */
export function buildBondForfeitEntry(marginMinor: Minor, label: string): JournalLine[] {
  if (!Number.isInteger(marginMinor) || marginMinor <= 0) throw new Error('لا هامش لهذا الخطاب')
  const lines: JournalLine[] = [
    { accountCode: '5108', debit: marginMinor, credit: 0, note: `مصادرة خطاب ${label}` },
    { accountCode: '1109', debit: 0, credit: marginMinor, note: 'الهامش المصادر' },
  ]
  assertBalanced(lines)
  return lines
}

/* ─── عمال اليومية — سجل يومي على المشروع وتسوية دورية من الخزينة ─── */
export interface DailyWorker {
  id: number
  nameAr: string
  phone: string
  dailyWageMinor: Minor
  active: boolean
}

export interface DailyWorkRecord {
  id: number
  workerId: number
  projectId: number | null // null = عمالة تشغيل عام (لا مشروع) — تُرحَّل مصروفاً عمومياً 5108
  date: string
  days: number // يوم أو نصف يوم (0.5)
  wageMinor: Minor // أجر هذا السجل = days × اليومية (قابل للتعديل)
  settled: boolean
  settlementId: number | null
}

/** قيد تسوية أجور يومية على مشروع: 5110 مدين ← نقدية دائن */
export function buildDailyWorkSettlementEntry(projectTotalMinor: Minor, overheadTotalMinor: Minor, treasury: string, label: string): JournalLine[] {
  if (!Number.isInteger(projectTotalMinor) || projectTotalMinor < 0) throw new Error('أجور المشاريع غير صحيحة')
  if (!Number.isInteger(overheadTotalMinor) || overheadTotalMinor < 0) throw new Error('أجور التشغيل العام غير صحيحة')
  const total = projectTotalMinor + overheadTotalMinor
  if (total <= 0) throw new Error('لا أجور غير مسددة')
  const lines: JournalLine[] = []
  // سجلات مربوطة بمشروع → تكاليف مشروعات؛ بدون مشروع → مصروف تشغيل عام (أمر التعديل)
  if (projectTotalMinor > 0) lines.push({ accountCode: '5110', debit: projectTotalMinor, credit: 0, note: `أجور يومية مشاريع ${label}` })
  if (overheadTotalMinor > 0) lines.push({ accountCode: '5108', debit: overheadTotalMinor, credit: 0, note: `أجور يومية تشغيل عام ${label}` })
  lines.push({ accountCode: treasury, debit: 0, credit: total, note: 'المنصرف' })
  assertBalanced(lines)
  return lines
}

/* ─── WIP: الأعمال تحت التنفيذ — نسبة الإنجاز والفوترة الزائدة/الناقصة ─── */
export interface WipInput {
  /** قيمة العقد الفعلية (بعد أوامر التغيير المعتمدة) */
  contractMinor: Minor
  /** الموازنة التقديرية للتكاليف (0 = استخدم قيمة العقد كأساس للنسبة) */
  budgetCostMinor: Minor
  /** التكاليف الفعلية حتى الآن */
  costsIncurredMinor: Minor
  /** إجمالي المستخلصات (المفوتر) حتى الآن */
  billedMinor: Minor
}

export interface WipResult {
  /** نسبة الإنجاز 0–1 بطريقة التكلفة إلى التكلفة (cost-to-cost) */
  percentComplete: number
  /** الإيراد المكتسب = العقد × نسبة الإنجاز */
  earnedRevenueMinor: Minor
  /** موجب = فوترة ناقصة (لك أعمال لم تفوترها)، سالب = فوترة زائدة */
  underBillingMinor: Minor
  /** التكلفة المتبقية المتوقعة للإكمال */
  costToCompleteMinor: Minor
  status: 'on_track' | 'over_billed' | 'under_billed'
}

export function computeWip(input: WipInput): WipResult {
  const base = input.budgetCostMinor > 0 ? input.budgetCostMinor : input.contractMinor
  const percent = base > 0 ? Math.min(1, Math.max(0, input.costsIncurredMinor / base)) : 0
  const earned = Math.round(input.contractMinor * percent)
  const underBilling = earned - input.billedMinor
  return {
    percentComplete: percent,
    earnedRevenueMinor: earned,
    underBillingMinor: underBilling,
    costToCompleteMinor: Math.max(0, base - input.costsIncurredMinor),
    status: underBilling > 0 ? 'under_billed' : underBilling < 0 ? 'over_billed' : 'on_track',
  }
}
