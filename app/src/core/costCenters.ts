/** مراكز التكلفة العامة — مستقلة عن مركز تكلفة المركبة/الأصل وعن مشروعات المقاولات. */
export interface CostCenter {
  id: number
  code: string
  nameAr: string
  isActive: boolean
  notes: string
}

export function validateCostCenter(input: Pick<CostCenter, 'code' | 'nameAr'>, existing: CostCenter[], excludeId?: number): string[] {
  const errors: string[] = []
  const code = input.code.trim()
  const name = input.nameAr.trim()
  if (!code) errors.push('كود مركز التكلفة مطلوب')
  if (!name) errors.push('اسم مركز التكلفة مطلوب')
  if (existing.some((center) => center.id !== excludeId && center.code.trim().toLowerCase() === code.toLowerCase())) errors.push('كود مركز التكلفة مستخدم مسبقاً')
  if (existing.some((center) => center.id !== excludeId && center.nameAr.trim() === name)) errors.push('اسم مركز التكلفة مستخدم مسبقاً')
  return errors
}
