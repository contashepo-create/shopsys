import type { TaxRegistrationPolicy } from './taxRegistration.ts'
export type TaxTreatment = 'standard' | 'zero_rated' | 'exempt' | 'out_of_scope' | 'not_registered'
export interface TaxTreatmentInput { treatment: TaxTreatment; rateBasisPoints: number; reasonCode?: string }
export function validateTaxTreatment(registration: TaxRegistrationPolicy, input: TaxTreatmentInput): string[] {
  const errors: string[] = []
  if (!Number.isInteger(input.rateBasisPoints) || input.rateBasisPoints < 0 || input.rateBasisPoints > 10000) errors.push('نسبة المعالجة الضريبية غير صالحة')
  if (registration.status === 'not_registered' && (input.treatment !== 'not_registered' || input.rateBasisPoints !== 0)) errors.push('المنشأة غير المسجلة لا تحتسب ضريبة')
  if (registration.status === 'registered' && input.treatment === 'not_registered') errors.push('معالجة غير مسجل لا تخص منشأة مسجلة')
  if (input.treatment === 'standard' && input.rateBasisPoints === 0) errors.push('المعدل القياسي يجب أن يكون أكبر من صفر')
  if (input.treatment !== 'standard' && input.rateBasisPoints !== 0) errors.push('المعالجة غير القياسية يجب أن تكون بنسبة صفر')
  if ((input.treatment === 'zero_rated' || input.treatment === 'exempt' || input.treatment === 'out_of_scope') && !input.reasonCode?.trim()) errors.push('سبب المعالجة الضريبية مطلوب')
  return errors
}
