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
  contractValueMinor: Minor // قيمة العقد (استرشادية للتقدم)
  retentionPercent: number // نسبة محتجز ضمان الأعمال من كل مستخلص
  startDate: string // YYYY-MM-DD
  status: ProjectStatus
  notes: string
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
  descriptionAr: string // بند الأعمال
  qty: number
  unitAr: string // م2، م.ط، مقطوعية…
  unitPriceMinor: Minor
}

export interface Quotation {
  id: number
  quoteNumber: string // QT-0001
  kind: 'quotation' | 'tender' // عرض سعر | مناقصة
  clientName: string
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
