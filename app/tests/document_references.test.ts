import { describe, expect, it } from 'vitest'
import { findOriginalReference, validateDocumentReferences } from '../src/core/documentReferences.ts'
const ref = { kind: 'return_of' as const, documentId: 'sale-1', documentNumber: 'SAL-1', createdAt: '2026-09-22T00:00:00Z' }
describe('روابط المستندات', () => {
 it('يقبل ربط المرتجع بأصله', () => expect(validateDocumentReferences('return-1', [ref])).toEqual([]))
 it('يعيد مرجع الأصل', () => expect(findOriginalReference([ref])?.documentId).toBe('sale-1'))
 it('يرفض المرجع الذاتي والمكرر', () => expect(validateDocumentReferences('sale-1', [ref, ref])).toHaveLength(3))
 it('يتطلب سبباً للعكس', () => expect(validateDocumentReferences('rev-1', [{ ...ref, kind: 'reversal_of' }])).toContain('سبب العكس أو الاستبدال مطلوب'))
})
