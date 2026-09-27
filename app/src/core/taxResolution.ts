import type { DocumentTaxSnapshot } from './documentTax.ts'
import type { TaxRegistrationPolicy } from './taxRegistration.ts'
import type { TaxTreatment } from './taxTreatment.ts'
export interface ResolvedDocumentTax { treatment: TaxTreatment; snapshot: DocumentTaxSnapshot | null; disclosureAr: string }
export function resolveDocumentTax(registration: TaxRegistrationPolicy, treatment: TaxTreatment, configuredTax: DocumentTaxSnapshot | null): ResolvedDocumentTax {
  if (registration.status === 'not_registered') return { treatment: 'not_registered', snapshot: null, disclosureAr: 'المنشأة غير مسجلة ضريبياً' }
  if (treatment === 'not_registered') throw new Error('لا يمكن اختيار غير مسجل لمنشأة مسجلة')
  if (treatment === 'standard') {
    if (!configuredTax || configuredTax.rateBasisPoints <= 0) throw new Error('يجب تحديد ضريبة قياسية صالحة')
    return { treatment, snapshot: { ...configuredTax, registrationNumber: registration.registrationNumber }, disclosureAr: '' }
  }
  return { treatment, snapshot: null, disclosureAr: treatment === 'zero_rated' ? 'خاضع للضريبة بنسبة صفر' : treatment === 'exempt' ? 'معفى من الضريبة' : 'خارج نطاق الضريبة' }
}
