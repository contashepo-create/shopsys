import type { BoqItem } from './contracting.ts'
import { quantityExtractBasis, type QuantityHistoryExtract } from './projectExtractQuantity.ts'
import { assertSurveyFinalBilled, assertSurveyIntegrity, type ProjectSurvey } from './projectSurvey.ts'

/** محضر إثبات كميات تاريخي فقط، لا يغلق المشروع أو يسوي ذمة أو محتجزاً. */
export interface ProjectCloseout {
  id: number
  number: string
  projectId: number
  branchId?: number | null
  projectCode: string
  projectName: string
  clientName: string
  surveyId: number
  surveyRevision: number
  at: string
  by: string
  notes: string
  basis: string
  extractNumbers: string[]
  lines: { boqItemId: number; code: string; descriptionAr: string; unit: string; contractQty: number; executedQty: number; billedQty: number; remainingQty: number; unitPriceMinor: number; billedMinor: number }[]
}

/** يتطلب كميات مثبتة وفواتير سابقة ومطابقة مبلغ كل بند، لا المساواة الكمية وحدها. */
export function closeoutLines(survey: ProjectSurvey, items: readonly BoqItem[], history: readonly QuantityHistoryExtract[]): ProjectCloseout['lines'] {
  if (!survey.isFinal) throw new Error('اعتمد حصرًا ختامياً قبل إصدار محضر إقفال الكميات')
  if (!items.length || !history.length) throw new Error('يلزم وجود بنود ومُستخلصات سابقة لإصدار محضر الإقفال')
  assertSurveyIntegrity(survey, items, history)
  assertSurveyFinalBilled(survey, items, history)
  const lines = items.map(item => {
    const measured = survey.lines.find(row => row.boqItemId === item.id)?.cumulativeQty ?? 0
    const billed = quantityExtractBasis(item, history)
    if (billed.estimated || !Number.isSafeInteger(item.unitPriceMinor) || item.unitPriceMinor < 0) throw new Error('أساس قيمة أو كمية بند الإقفال غير صالح')
    const expectedBig = (BigInt(Math.round(measured * 1000)) * BigInt(item.unitPriceMinor) + 500n) / 1000n
    if (expectedBig > BigInt(Number.MAX_SAFE_INTEGER) || billed.previouslyBilledMinor !== Number(expectedBig)) throw new Error(`قيمة البند ${item.code} لا تطابق الكمية المستخلصة — راجع المستخلصات`)
    return { boqItemId: item.id, code: item.code, descriptionAr: item.descriptionAr, unit: item.unit, contractQty: item.qty, executedQty: measured, billedQty: billed.previousQty, remainingQty: Number((item.qty - measured).toFixed(3)), unitPriceMinor: item.unitPriceMinor, billedMinor: billed.previouslyBilledMinor }
  })
  if (!lines.some(line => line.executedQty > 0)) throw new Error('لا توجد أعمال مستخلصة مثبتة لإصدار محضر إقفال')
  return lines
}
