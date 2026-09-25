export type DocumentReferenceKind = 'reversal_of' | 'return_of' | 'credit_for' | 'debit_for' | 'replaces'
export interface DocumentReference { kind: DocumentReferenceKind; documentId: string; documentNumber: string; createdAt: string; reason?: string }
export function validateDocumentReferences(documentId: string, references: DocumentReference[]): string[] {
  const errors: string[] = []; const keys = new Set<string>()
  for (const reference of references) {
    const key = `${reference.kind}:${reference.documentId}`
    if (!reference.documentId.trim() || reference.documentId === documentId) errors.push('مرجع المستند فارغ أو يشير إلى نفسه')
    if (!reference.documentNumber.trim()) errors.push('رقم المستند المرجعي مطلوب')
    if (!Number.isFinite(Date.parse(reference.createdAt))) errors.push('تاريخ مرجع المستند غير صالح')
    if (keys.has(key)) errors.push('مرجع مستند مكرر')
    keys.add(key)
    if ((reference.kind === 'reversal_of' || reference.kind === 'replaces') && !reference.reason?.trim()) errors.push('سبب العكس أو الاستبدال مطلوب')
  }
  return errors
}
export function findOriginalReference(references: DocumentReference[]): DocumentReference | null {
  return references.find((reference) => reference.kind === 'return_of' || reference.kind === 'reversal_of') ?? null
}
