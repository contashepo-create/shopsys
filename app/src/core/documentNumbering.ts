export interface DocumentNumberSequence {
  prefix: string
  nextValue: number
  padding: number
  fiscalYear?: number
}

export function validateDocumentNumberSequence(sequence: DocumentNumberSequence): string[] {
  const errors: string[] = []
  if (!/^[A-Z0-9-]{1,12}$/.test(sequence.prefix)) errors.push('بادئة ترقيم المستند غير صالحة')
  if (!Number.isSafeInteger(sequence.nextValue) || sequence.nextValue < 1) errors.push('رقم التسلسل التالي غير صالح')
  if (!Number.isInteger(sequence.padding) || sequence.padding < 1 || sequence.padding > 12) errors.push('طول الترقيم غير صالح')
  if (sequence.fiscalYear !== undefined && (!Number.isInteger(sequence.fiscalYear) || sequence.fiscalYear < 2000 || sequence.fiscalYear > 9999)) errors.push('السنة المالية غير صالحة')
  return errors
}

export function reserveDocumentNumber(sequence: DocumentNumberSequence): { documentNumber: string; nextSequence: DocumentNumberSequence } {
  const errors = validateDocumentNumberSequence(sequence)
  if (errors.length) throw new Error(errors.join('، '))
  const serial = String(sequence.nextValue).padStart(sequence.padding, '0')
  if (serial.length > sequence.padding) throw new Error('نفد نطاق تسلسل أرقام المستندات')
  const documentNumber = [sequence.prefix, sequence.fiscalYear, serial].filter((part) => part !== undefined).join('-')
  return { documentNumber, nextSequence: { ...sequence, nextValue: sequence.nextValue + 1 } }
}
