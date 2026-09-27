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

export type BusinessTaxStatus = 'registered' | 'exempt' | 'zero_rated'
export interface BusinessTaxPolicy {
  status: BusinessTaxStatus
  configuredPercent: number
  effectivePercent: number
  canRecoverInputTax: boolean
  disclosureAr: string
}
/** يفصل صفة المنشأة عن النسبة؛ فالمسجل بنسبة صفر ليس منشأة معفاة. */
export function resolveBusinessTax(status: BusinessTaxStatus | undefined, configuredPercent: number): BusinessTaxPolicy {
  if (!Number.isFinite(configuredPercent) || configuredPercent < 0 || configuredPercent > 100) throw new Error('نسبة الضريبة يجب أن تكون بين 0 و100')
  const normalized = status ?? (configuredPercent > 0 ? 'registered' : 'zero_rated')
  if (normalized === 'exempt') return { status: normalized, configuredPercent, effectivePercent: 0, canRecoverInputTax: false, disclosureAr: 'المنشأة معفاة ضريبياً' }
  if (normalized === 'zero_rated') return { status: normalized, configuredPercent, effectivePercent: 0, canRecoverInputTax: true, disclosureAr: 'المنشأة مسجلة ضريبياً بنسبة صفر' }
  return { status: normalized, configuredPercent, effectivePercent: configuredPercent, canRecoverInputTax: true, disclosureAr: configuredPercent === 0 ? 'المنشأة مسجلة ضريبياً بنسبة صفر' : `المنشأة مسجلة ضريبياً — النسبة ${configuredPercent}٪` }
}
