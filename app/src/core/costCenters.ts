/** مراكز التكلفة العامة — مستقلة عن مركز تكلفة المركبة/الأصل وعن مشروعات المقاولات. */
export interface CostCenter {
  id: number
  code: string
  nameAr: string
  /** مركز الأب في الشجرة؛ غيابه يعني مركزاً جذرياً */
  parentId?: number | null
  isActive: boolean
  notes: string
}

export interface CostCenterBudget {
  id: number
  costCenterId: number
  from: string
  to: string
  amountMinor: number
  notes: string
}

/** يولد أول كود متاح لمركز جديد؛ يبقى الحقل قابلاً للتعديل قبل الحفظ. */
export function nextCostCenterCode(existing: Pick<CostCenter, 'code'>[]): string {
  const used = new Set(existing.map((center) => center.code.trim().toUpperCase()))
  let sequence = 1
  while (used.has(`CC-${String(sequence).padStart(4, '0')}`)) sequence += 1
  return `CC-${String(sequence).padStart(4, '0')}`
}

export function validateCostCenter(input: Pick<CostCenter, 'code' | 'nameAr' | 'parentId'>, existing: CostCenter[], excludeId?: number): string[] {
  const errors: string[] = []
  const code = input.code.trim()
  const name = input.nameAr.trim()
  if (!code) errors.push('كود مركز التكلفة مطلوب')
  if (!name) errors.push('اسم مركز التكلفة مطلوب')
  if (existing.some((center) => center.id !== excludeId && center.code.trim().toLowerCase() === code.toLowerCase())) errors.push('كود مركز التكلفة مستخدم مسبقاً')
  if (existing.some((center) => center.id !== excludeId && center.nameAr.trim() === name)) errors.push('اسم مركز التكلفة مستخدم مسبقاً')
  const parentId = input.parentId ?? null
  if (parentId != null && !existing.some((center) => center.id === parentId)) errors.push('مركز الأب غير موجود')
  if (parentId != null && parentId === excludeId) errors.push('لا يمكن أن يكون المركز أباً لنفسه')
  if (excludeId != null && parentId != null) {
    const byId = new Map(existing.map((center) => [center.id, center]))
    const seen = new Set<number>([excludeId])
    let cursor: number | null | undefined = parentId
    while (cursor != null) {
      if (seen.has(cursor)) { errors.push('اختيار الأب ينشئ دورة في شجرة المراكز'); break }
      seen.add(cursor)
      cursor = byId.get(cursor)?.parentId
    }
  }
  return errors
}

export function validateCostCenterBudget(input: Pick<CostCenterBudget, 'from' | 'to' | 'amountMinor'>, centers: CostCenter[], costCenterId: number): string[] {
  const errors: string[] = []
  if (!centers.some((center) => center.id === costCenterId)) errors.push('مركز الميزانية غير موجود')
  if (!input.from || !input.to || input.from > input.to) errors.push('فترة الميزانية غير صحيحة')
  if (!Number.isInteger(input.amountMinor) || input.amountMinor < 0) errors.push('قيمة الميزانية يجب أن تكون مبلغاً صحيحاً غير سالب')
  return errors
}
