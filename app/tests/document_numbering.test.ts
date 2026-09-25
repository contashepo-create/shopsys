import { describe, expect, it } from 'vitest'
import { reserveDocumentNumber, validateDocumentNumberSequence } from '../src/core/documentNumbering.ts'
describe('ترقيم المستندات', () => {
  it('ينشئ رقماً ثابت الشكل ويعيد التسلسل التالي بلا تعديل الأصل', () => { const source = { prefix: 'SAL', fiscalYear: 2026, nextValue: 42, padding: 6 }; const result = reserveDocumentNumber(source); expect(result.documentNumber).toBe('SAL-2026-000042'); expect(result.nextSequence.nextValue).toBe(43); expect(source.nextValue).toBe(42) })
  it('يدعم تسلسلاً بلا سنة', () => expect(reserveDocumentNumber({ prefix: 'POS', nextValue: 1, padding: 3 }).documentNumber).toBe('POS-001'))
  it('يرفض البادئة والعداد غير الصالحين', () => expect(validateDocumentNumberSequence({ prefix: 'بيع', nextValue: 0, padding: 0 })).toHaveLength(3))
  it('يرفض تجاوز سعة التسلسل', () => expect(() => reserveDocumentNumber({ prefix: 'INV', nextValue: 1000, padding: 3 })).toThrow('نفد نطاق'))
})
