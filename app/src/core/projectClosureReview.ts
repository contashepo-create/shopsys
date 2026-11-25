import { isValidExpiryDate } from './batches.ts'
import { retentionReleaseDueDate, type Project } from './contracting.ts'

/** قوائم ظاهرة فقط؛ المؤشرات لا تتحقق من القيود أو اكتمال البيانات خارج النطاق. */
export interface ProjectClosureContext {
  advances: readonly { projectId: number; amountMinor: number; recoveredMinor: number }[]
  tasks: readonly { projectId: number; status: string }[]
  subContracts: readonly { projectId: number; status: string }[]
  custodyFiles: readonly { projectId: number | null; status: string }[]
}

/** حالة النظام لا تثبت التسليم الفعلي؛ لا تُخمَّن الحالات التالفة. */
export function projectSystemStatusLabel(status: unknown): string {
  return status === 'active' ? 'جارٍ' : status === 'completed' ? 'مكتمل بالنظام' : 'حالة غير معروفة — راجع السجل'
}

/** مؤشرات وصفية فقط؛ لا تفحص الأدلة المحاسبية أو تمنح موافقة على الإقفال. */
export function projectClosureIndicators(
  project: Pick<Project, 'id' | 'actualHandoverDate' | 'defectsLiabilityMonths'>,
  date: string,
  extracts: readonly { projectId: number; isFinal?: boolean }[],
  drafts: readonly { projectId: number }[],
  orders: readonly { projectId: number; status: string }[],
  context?: ProjectClosureContext,
): string[] {
  const issues: string[] = []
  const handover = project.actualHandoverDate
  const months = project.defectsLiabilityMonths
  if (typeof handover !== 'string' || !isValidExpiryDate(handover) || !Number.isInteger(months) || (months as number) < 0 || (months as number) > 1200) {
    issues.push('تاريخ التسليم الفعلي أو مدة الضمان غير مسجلين بصورة صالحة؛ لا يمكن استنتاج استحقاق المحتجز.')
  } else if (!isValidExpiryDate(date)) {
    issues.push('تاريخ المراجعة غير صالح؛ لا يمكن مقارنة استحقاق المحتجز.')
  } else {
    const due = retentionReleaseDueDate(project)
    if (!due) issues.push('تعذر حساب نهاية الضمان من البيانات المدخلة؛ راجع التاريخ والمدة.')
    else if (date < due) issues.push(`تاريخ المراجعة يسبق نهاية الضمان المحسوبة من البيانات المدخلة (${due})؛ راجع العقد وأدلة الاستحقاق.`)
    else issues.push(`نهاية الضمان المحسوبة من البيانات المدخلة: ${due}؛ لا يثبت هذا وحده استحقاق التحصيل.`)
  }
  const finals = extracts.filter(row => row.projectId === project.id && row.isFinal === true).length
  if (finals === 0) issues.push('لا يظهر مستخلص ختامي مسجل للمشروع؛ راجع العقد والحصر والتسوية.')
  if (finals > 1) issues.push('يوجد أكثر من مستخلص معلّم كختامي؛ راجع السجل.')
  if (drafts.some(row => row.projectId === project.id)) issues.push('توجد مسودة مستخلص للمشروع؛ راجعها قبل تحصيل المحتجز.')
  if (orders.some(row => row.projectId === project.id && row.status === 'draft')) issues.push('توجد أوامر تغيير في حالة مسودة؛ راجع أثرها قبل تحصيل المحتجز.')
  if (context) {
    const advances = context.advances.filter(row => row.projectId === project.id)
    if (advances.some(row => !Number.isSafeInteger(row.amountMinor) || row.amountMinor <= 0 || !Number.isSafeInteger(row.recoveredMinor) || row.recoveredMinor < 0 || row.recoveredMinor > row.amountMinor)) issues.push('توجد بيانات مقدمة غير صالحة أو ناقصة في السجلات الظاهرة؛ راجع الأدلة والدفتر.')
    if (advances.some(row => Number.isSafeInteger(row.amountMinor) && row.amountMinor > 0 && Number.isSafeInteger(row.recoveredMinor) && row.recoveredMinor >= 0 && row.recoveredMinor < row.amountMinor)) issues.push('تظهر دفعة عميل لم يُسترد كامل مبلغها وفق السجل؛ راجع التخصيص والقيود قبل الإقفال.')
    if (context.tasks.some(row => row.projectId === project.id && row.status !== 'done')) issues.push('توجد مهام غير منجزة أو بحالة غير معروفة في البيانات الظاهرة؛ راجع نطاق الأعمال.')
    if (context.subContracts.some(row => row.projectId === project.id && row.status !== 'completed' && row.status !== 'cancelled')) issues.push('توجد عقود باطن نشطة أو بحالة غير معروفة في البيانات الظاهرة؛ راجع الشهادات والالتزامات.')
    if (context.custodyFiles.some(row => row.projectId === project.id && row.status !== 'settled')) issues.push('توجد ملفات عهدة مفتوحة أو بحالة غير معروفة مرتبطة بالمشروع؛ راجع حركاتها وتسويتها.')
  }
  return issues
}
