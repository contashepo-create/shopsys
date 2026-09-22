export type TaxRegistrationStatus = 'not_registered' | 'registered'
export interface TaxRegistrationPolicy {
  status: TaxRegistrationStatus
  countryCode: string
  registrationNumber?: string
  effectiveFrom?: string
}
export function validateTaxRegistration(policy: TaxRegistrationPolicy): string[] {
  const errors: string[] = []
  if (!/^[A-Z]{2}$/.test(policy.countryCode)) errors.push('رمز دولة التسجيل الضريبي غير صالح')
  if (policy.status === 'registered' && !policy.registrationNumber?.trim()) errors.push('رقم التسجيل الضريبي مطلوب للمنشأة المسجلة')
  if (policy.status === 'not_registered' && policy.registrationNumber?.trim()) errors.push('لا يحفظ رقم ضريبي لمنشأة غير مسجلة')
  if (policy.effectiveFrom && !/^\d{4}-\d{2}-\d{2}$/.test(policy.effectiveFrom)) errors.push('تاريخ سريان التسجيل الضريبي غير صالح')
  return errors
}
export function taxEnabled(policy: TaxRegistrationPolicy): boolean {
  const errors = validateTaxRegistration(policy)
  if (errors.length) throw new Error(errors.join('، '))
  return policy.status === 'registered'
}
