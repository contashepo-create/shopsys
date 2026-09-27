/** بنود مصروف قابلة لإعادة الاستخدام — قوالب إدخال لا تستبدل قيد المصروف نفسه. */
export type ExpenseTemplateSettlement = 'paid_now' | 'payable_later'
export type ExpenseTemplateTaxTreatment = 'exempt' | 'exclusive' | 'inclusive'
export type ExpenseTemplateAllocation = 'none' | 'value' | 'quantity' | 'weight' | 'volume' | 'equal'

export interface ExpenseTemplate {
  id: number
  code: string
  nameAr: string
  accountCode: string
  taxTreatment: ExpenseTemplateTaxTreatment
  taxPercent: number
  settlement: ExpenseTemplateSettlement
  affectsProfit: boolean
  landedCostAllocation: ExpenseTemplateAllocation
  isActive: boolean
  notes: string
}

export function validateExpenseTemplate(input: Pick<ExpenseTemplate, 'code' | 'nameAr' | 'accountCode' | 'taxPercent'>, existing: ExpenseTemplate[], excludeId?: number): string[] {
  const errors: string[] = []
  const code = input.code.trim().toUpperCase()
  const name = input.nameAr.trim()
  const account = input.accountCode.trim()
  if (!code) errors.push('كود بند المصروف مطلوب')
  if (!name) errors.push('اسم بند المصروف مطلوب')
  if (!account) errors.push('حساب المصروف مطلوب')
  if (!Number.isFinite(input.taxPercent) || input.taxPercent < 0 || input.taxPercent > 100) errors.push('نسبة الضريبة يجب أن تكون بين 0 و100')
  if (existing.some((row) => row.id !== excludeId && row.code.trim().toUpperCase() === code)) errors.push('كود بند المصروف مستخدم مسبقاً')
  if (existing.some((row) => row.id !== excludeId && row.nameAr.trim() === name)) errors.push('اسم بند المصروف مستخدم مسبقاً')
  return errors
}
