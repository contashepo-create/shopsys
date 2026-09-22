export interface DocumentPartyAddress {
  nameAr: string
  countryCode: string
  city: string
  district: string
  street: string
  buildingNumber: string
  postalCode: string
  additionalNumber: string
  phone: string
  taxNumber: string
}

export function validateDocumentAddress(address: DocumentPartyAddress, required = false): string[] {
  const errors: string[] = []
  const hasAny = Object.values(address).some((value) => value.trim())
  if (!required && !hasAny) return []
  if (!address.nameAr.trim()) errors.push('اسم المستلم مطلوب')
  if (!/^[A-Z]{2}$/.test(address.countryCode)) errors.push('كود الدولة غير صالح')
  if (!address.city.trim()) errors.push('المدينة مطلوبة')
  if (!address.street.trim()) errors.push('الشارع مطلوب')
  if (address.phone && !/^\+?[0-9]{7,15}$/.test(address.phone.replaceAll(' ', ''))) errors.push('رقم الهاتف غير صالح')
  if (address.postalCode && !/^[A-Za-z0-9 -]{3,12}$/.test(address.postalCode)) errors.push('الرمز البريدي غير صالح')
  if (address.taxNumber && !/^[A-Za-z0-9-]{5,30}$/.test(address.taxNumber)) errors.push('الرقم الضريبي غير صالح')
  return errors
}

export function sameDocumentAddress(a: DocumentPartyAddress, b: DocumentPartyAddress): boolean {
  return (Object.keys(a) as (keyof DocumentPartyAddress)[]).every((key) => a[key].trim() === b[key].trim())
}
