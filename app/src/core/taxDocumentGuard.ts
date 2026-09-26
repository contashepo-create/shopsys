import type { TaxRegistrationPolicy } from './taxRegistration.ts'
export interface TaxDocumentLine { taxMinor: number; treatment: 'standard' | 'zero_rated' | 'exempt' | 'out_of_scope' | 'not_registered' }
export interface TaxDocumentPresentation { showTaxColumns: boolean; showRegistrationNumber: boolean; footerAr: string }
export function guardTaxDocument(registration: TaxRegistrationPolicy, lines: TaxDocumentLine[]): TaxDocumentPresentation {
  for (const line of lines) if (!Number.isSafeInteger(line.taxMinor) || line.taxMinor < 0) throw new Error('ضريبة سطر المستند غير صالحة')
  if (registration.status === 'not_registered') {
    if (lines.some((line) => line.taxMinor !== 0 || line.treatment !== 'not_registered')) throw new Error('لا يجوز احتساب أو عرض ضريبة لمنشأة غير مسجلة')
    return { showTaxColumns: false, showRegistrationNumber: false, footerAr: 'المنشأة غير مسجلة ضريبياً' }
  }
  if (!registration.registrationNumber?.trim()) throw new Error('رقم التسجيل الضريبي مطلوب')
  if (lines.some((line) => line.treatment === 'not_registered')) throw new Error('معالجة غير مسجل غير مسموحة لمنشأة مسجلة')
  return { showTaxColumns: true, showRegistrationNumber: true, footerAr: '' }
}
