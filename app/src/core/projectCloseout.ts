import type { BoqItem } from './contracting.ts'
import { quantityExtractBasis, type QuantityHistoryExtract } from './projectExtractQuantity.ts'
import { assertSurveyFinalBilled, assertSurveyIntegrity, type ProjectSurvey } from './projectSurvey.ts'
import type { ProjectNetQuantityReport } from './projectNetQuantityHistory.ts'

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
  /** سجل صريح للمحضر المُعد بعد إشعارات مثبتة، وليس إعادة فتح للمستخلص الختامي. */
  quantityBasis?: 'net-after-credit'
  quantityEvents?: ProjectNetQuantityReport['events']
  lines: { boqItemId: number; code: string; descriptionAr: string; unit: string; contractQty: number; executedQty: number; billedQty: number; remainingQty: number; unitPriceMinor: number; billedMinor: number; issuedQty?: number; returnedQty?: number; issuedMinor?: number; returnedMinor?: number }[]
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

/** محضر وصفي للصافي بعد تدقيق تقرير الإشعارات والدفتر؛ لا يعدّل الحصر أو المستخلصات. */
export function closeoutNetLines(survey: ProjectSurvey, items: readonly BoqItem[], history: readonly QuantityHistoryExtract[], report: ProjectNetQuantityReport): ProjectCloseout['lines'] {
  if (!survey.isFinal) throw new Error('اعتمد حصرًا ختامياً قبل إصدار محضر إقفال الكميات')
  if (!items.length || !history.length || !report.events.some(event => event.kind === 'credit')) throw new Error('يلزم تاريخ مستخلصات وإشعارات مثبت لإصدار محضر الصافي')
  assertSurveyIntegrity(survey, items, history)
  const last = survey.revisions?.at(-1)
  if (!last || survey.revisions.some((row, index) => row.revision !== index + 1) || !last.isFinal || JSON.stringify(last.lines) !== JSON.stringify(survey.lines)) throw new Error('مراجعة الحصر الختامية لا تطابق الحصر المحفوظ — راجع التاريخ')
  if (report.rows.length !== items.length || new Set(report.rows.map(row => row.boqItemId)).size !== items.length) throw new Error('بنود تقرير الصافي غير مكتملة — راجع التاريخ')
  const lines = items.map(item => {
    const measured = survey.lines.find(row => row.boqItemId === item.id)?.cumulativeQty ?? 0
    const net = report.rows.find(row => row.boqItemId === item.id)
    if (!net || measured !== net.netQty) throw new Error(`الحصر للبند ${item.code} لا يطابق صافي المستخلصات بعد الإشعارات — راجع الحصر`)
    return { boqItemId: item.id, code: item.code, descriptionAr: item.descriptionAr, unit: item.unit, contractQty: item.qty, executedQty: measured, billedQty: net.netQty, remainingQty: Number((item.qty - measured).toFixed(3)), unitPriceMinor: item.unitPriceMinor, billedMinor: net.netMinor, issuedQty: net.issuedQty, returnedQty: net.returnedQty, issuedMinor: net.issuedMinor, returnedMinor: net.returnedMinor }
  })
  if (!lines.some(line => line.executedQty > 0)) throw new Error('لا توجد أعمال مستخلصة مثبتة لإصدار محضر إقفال')
  return lines
}
