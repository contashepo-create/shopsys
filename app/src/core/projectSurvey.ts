/** حصر الأعمال التراكمي مستقل عن الذمة المحاسبية. */
import type { BoqItem } from './contracting.ts'
import { normalizeMovementQty } from './pos.ts'
import { isValidExpiryDate } from './batches.ts'
import { quantityExtractBasis, type QuantityHistoryExtract } from './projectExtractQuantity.ts'

export interface SurveyLine { boqItemId: number; cumulativeQty: number; contractQty?: number; unitPriceMinor?: number; unit?: string }
export interface SurveyRevision {
  revision: number
  at: string
  by: string
  source: 'manual' | 'extract'
  /** يوم القياس المصرح به لهذه المراجعة، وليس وقت تسجيلها أو تاريخاً لكل الكميات القديمة. */
  measurementDate?: string
  extractId?: number
  reason: string
  isFinal: boolean
  lines: SurveyLine[]
}
export interface ProjectSurvey {
  id: number
  projectId: number
  branchId?: number | null
  createdAt: string
  /** الحصر المعتمد فقط؛ لا ينشئ قيداً محاسبياً. */
  lines: SurveyLine[]
  isFinal: boolean
  revisions: SurveyRevision[]
}

/** لا تحويل للحصر النسبي أو الإجمالي القديم إلى كميات هندسية موثقة. */
export function exactBilledQuantities(items: readonly BoqItem[], history: readonly QuantityHistoryExtract[]): SurveyLine[] {
  return items.map(item => {
    const basis = quantityExtractBasis(item, history)
    if (basis.estimated) throw new Error('توجد كميات سابقة تقديرية من نسب؛ يلزم مراجعة وتسوية التاريخ قبل ربط الحصر')
    return { boqItemId: item.id, cumulativeQty: basis.previousQty }
  })
}

function quantitiesByItem(items: readonly BoqItem[], lines: readonly SurveyLine[]): Map<number, number> {
  const result = new Map<number, number>()
  for (const line of lines) {
    if (result.has(line.boqItemId)) throw new Error('بند مكرر في الحصر')
    const item = items.find(row => row.id === line.boqItemId)
    if (!item) throw new Error('بند الحصر لا ينتمي للمشروع')
    if ((line.contractQty != null && line.contractQty !== item.qty) || (line.unitPriceMinor != null && line.unitPriceMinor !== item.unitPriceMinor) || (line.unit != null && line.unit !== item.unit)) throw new Error('تغيرت بيانات عقد بند الحصر — راجع التاريخ')
    const qty = normalizeMovementQty(line.cumulativeQty, true)
    normalizeMovementQty(item.qty)
    if (qty > item.qty) throw new Error(`كمية البند ${item.code} تتجاوز كمية العقد`)
    result.set(item.id, qty)
  }
  return result
}

export function reviseProjectSurvey(args: {
  survey?: ProjectSurvey
  projectId: number
  items: readonly BoqItem[]
  history: readonly QuantityHistoryExtract[]
  lines: readonly SurveyLine[]
  source: 'manual' | 'extract'
  extractId?: number
  measurementDate?: string
  reason: string
  at: string
  by: string
  isFinal: boolean
  /** موافقة على زيادة حصر سابق بناءً على المستخلص، لا مجرد ربطه. */
  acceptIncrease?: boolean
  expectedRevision?: number
}): ProjectSurvey {
  const { survey, projectId, items, history } = args
  if (!items.length) throw new Error('لا يوجد جدول كميات للمشروع')
  if (survey && survey.projectId !== projectId) throw new Error('الحصر لا ينتمي للمشروع')
  if (args.expectedRevision != null && args.expectedRevision !== (survey?.revisions.length ?? 0)) throw new Error('تغير الحصر منذ فتحه — أعد تحميله وراجع البيانات')
  if (args.measurementDate != null && (args.source !== 'manual' || !isValidExpiryDate(args.measurementDate) || !isValidExpiryDate(args.at.slice(0, 10)) || args.measurementDate > args.at.slice(0, 10))) throw new Error('تاريخ قياس الحصر غير صالح للمراجعة')
  if (args.source === 'extract' && !args.extractId) throw new Error('المستخلص المرتبط غير محدد')
  if (survey && args.source === 'extract' && survey.revisions.some(rev => rev.source === 'extract' && rev.extractId === args.extractId)) throw new Error('المستخلص مربوط بالحصر بالفعل')
  const billed = quantitiesByItem(items, exactBilledQuantities(items, history))
  const previous = quantitiesByItem(items, survey?.lines ?? [...billed].map(([boqItemId, cumulativeQty]) => ({ boqItemId, cumulativeQty })))
  const entered = quantitiesByItem(items, args.lines)
  if (!entered.size) throw new Error('أدخل كمية بند واحد على الأقل')
  const next = new Map(previous)
  for (const [id, qty] of entered) {
    const old = previous.get(id) ?? 0
    if (args.source === 'extract') {
      if (survey && survey.isFinal && qty > old) throw new Error('الحصر ختامي — صحح الحصر المعتمد أولاً')
      if (survey && qty > old && !args.acceptIncrease) throw new Error('كمية المستخلص تتجاوز الحصر المعتمد — أكد إضافة الفرق إلى الحصر')
      next.set(id, Math.max(old, qty))
    } else {
      if (qty < (billed.get(id) ?? 0)) throw new Error('كمية الحصر أقل من الكمية المستخلصة — راجع المستخلصات أولاً')
      if (survey && qty < old && !args.reason.trim()) throw new Error('سبب تخفيض كمية الحصر مطلوب')
      next.set(id, qty)
    }
  }
  for (const [id, qty] of billed) if ((next.get(id) ?? 0) < qty) throw new Error('الحصر أقل من الكميات المستخلصة')
  const lines = items.map(item => ({ boqItemId: item.id, cumulativeQty: next.get(item.id) ?? 0, contractQty: item.qty, unitPriceMinor: item.unitPriceMinor, unit: item.unit }))
  const isFinal = args.source === 'extract' ? (survey?.isFinal || args.isFinal) : args.isFinal
  if (survey?.isFinal && !isFinal && !args.reason.trim()) throw new Error('سبب إعادة فتح الحصر الختامي مطلوب')
  const revision: SurveyRevision = { revision: (survey?.revisions.length ?? 0) + 1, at: args.at, by: args.by, source: args.source, ...(args.extractId ? { extractId: args.extractId } : {}), ...(args.measurementDate != null ? { measurementDate: args.measurementDate } : {}), reason: args.reason.trim(), isFinal, lines: lines.map(line => ({ ...line })) }
  return { id: survey?.id ?? projectId, projectId, ...(survey?.branchId != null ? { branchId: survey.branchId } : {}), createdAt: survey?.createdAt ?? args.at, lines, isFinal, revisions: [...(survey?.revisions ?? []), revision] }
}

/** فحص المحفوظ قبل عرض الكميات أو طباعتها؛ لا يُصلح التاريخ بصمت. */
export function assertSurveyIntegrity(survey: ProjectSurvey, items: readonly BoqItem[], history: readonly QuantityHistoryExtract[]): void {
  if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('بنود المشروع غير فريدة — راجع الحصر')
  if (survey.revisions.some(row => row.measurementDate != null && (row.source !== 'manual' || !isValidExpiryDate(row.measurementDate) || !isValidExpiryDate(row.at?.slice(0, 10)) || row.measurementDate > row.at.slice(0, 10)))) throw new Error('تاريخ قياس مراجعة الحصر غير صالح — راجع السجل')
  const measured = quantitiesByItem(items, survey.lines)
  const billed = quantitiesByItem(items, exactBilledQuantities(items, history))
  for (const item of items) if ((measured.get(item.id) ?? 0) < (billed.get(item.id) ?? 0)) throw new Error(`الحصر للبند ${item.code} أقل من المستخلص — راجع المستندات`)
}

/** لا يُغلق مستخلص نهائي تاركاً أعمالاً محصورة لم تُستخلص. */
export function assertSurveyFinalBilled(survey: ProjectSurvey, items: readonly BoqItem[], history: readonly QuantityHistoryExtract[]): void {
  const actual = quantitiesByItem(items, survey.lines)
  const billed = quantitiesByItem(items, exactBilledQuantities(items, history))
  for (const item of items) if ((actual.get(item.id) ?? 0) !== (billed.get(item.id) ?? 0)) throw new Error(`الحصر للبند ${item.code} لا يطابق كميات المستخلص الختامي — راجع الأعمال غير المستخلصة`)
}
