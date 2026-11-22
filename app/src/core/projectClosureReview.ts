import { isValidExpiryDate } from './batches.ts'
import { addCalendarMonths } from './time.ts'
import type { Project } from './contracting.ts'

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
): string[] {
  const issues: string[] = []
  const handover = project.actualHandoverDate
  const months = project.defectsLiabilityMonths
  if (typeof handover !== 'string' || !isValidExpiryDate(handover) || !Number.isInteger(months) || (months as number) < 0 || (months as number) > 1200) {
    issues.push('تاريخ التسليم الفعلي أو مدة الضمان غير مسجلين بصورة صالحة؛ لا يمكن استنتاج استحقاق المحتجز.')
  } else if (!isValidExpiryDate(date)) {
    issues.push('تاريخ المراجعة غير صالح؛ لا يمكن مقارنة استحقاق المحتجز.')
  } else {
    const due = addCalendarMonths(handover, months as number)
    if (!isValidExpiryDate(due)) issues.push('تعذر حساب نهاية الضمان من البيانات المدخلة؛ راجع التاريخ والمدة.')
    else if (date < due) issues.push(`تاريخ المراجعة يسبق نهاية الضمان المحسوبة من البيانات المدخلة (${due})؛ راجع العقد وأدلة الاستحقاق.`)
    else issues.push(`نهاية الضمان المحسوبة من البيانات المدخلة: ${due}؛ لا يثبت هذا وحده استحقاق التحصيل.`)
  }
  const finals = extracts.filter(row => row.projectId === project.id && row.isFinal === true).length
  if (finals === 0) issues.push('لا يظهر مستخلص ختامي مسجل للمشروع؛ راجع العقد والحصر والتسوية.')
  if (finals > 1) issues.push('يوجد أكثر من مستخلص معلّم كختامي؛ راجع السجل.')
  if (drafts.some(row => row.projectId === project.id)) issues.push('توجد مسودة مستخلص للمشروع؛ راجعها قبل تحصيل المحتجز.')
  if (orders.some(row => row.projectId === project.id && row.status === 'draft')) issues.push('توجد أوامر تغيير في حالة مسودة؛ راجع أثرها قبل تحصيل المحتجز.')
  return issues
}
