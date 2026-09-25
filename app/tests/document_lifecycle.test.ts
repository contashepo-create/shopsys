import { describe, expect, it } from 'vitest'
import {
  InvalidDocumentTransitionError,
  isDocumentEditable,
  isDocumentTerminal,
  isValidIdempotencyKey,
  transitionDocument,
} from '../src/core/documentLifecycle.ts'

describe('دورة حياة المستندات التجارية', () => {
  it('يمر بالمسار الطبيعي: مسودة ثم اعتماد ثم ترحيل', () => {
    const approved = transitionDocument('draft', 'approve')
    expect(approved).toBe('approved')
    expect(transitionDocument(approved, 'post')).toBe('posted')
  })

  it('يسمح بإعادة المعتمد للمسودة قبل الترحيل فقط', () => {
    expect(transitionDocument('approved', 'reopen')).toBe('draft')
    expect(() => transitionDocument('posted', 'reopen')).toThrow(InvalidDocumentTransitionError)
  })

  it('يمنع إلغاء المستند المرحل ويلزمه بمستند عكسي', () => {
    expect(() => transitionDocument('posted', 'void')).toThrow('مستنداً عكسياً')
    expect(transitionDocument('posted', 'record_partial_reversal', { hasPartialReversal: true })).toBe('partially_reversed')
    expect(transitionDocument('partially_reversed', 'record_full_reversal', { hasFullReversal: true })).toBe('reversed')
  })

  it('لا يغير حالة الأصل إلى عكسي دون مستند مرتبط', () => {
    expect(() => transitionDocument('posted', 'record_partial_reversal')).toThrow('مرتبط')
    expect(() => transitionDocument('posted', 'record_full_reversal')).toThrow('يغطي الأصل')
  })

  it('يقصر التعديل على المسودة ويحدد الحالات النهائية', () => {
    expect(isDocumentEditable('draft')).toBe(true)
    expect(isDocumentEditable('approved')).toBe(false)
    expect(isDocumentTerminal('reversed')).toBe(true)
    expect(isDocumentTerminal('voided')).toBe(true)
    expect(isDocumentTerminal('posted')).toBe(false)
  })

  it('يتحقق من مفتاح منع الترحيل المزدوج', () => {
    expect(isValidIdempotencyKey('sale_01K5ABCD1234567890')).toBe(true)
    expect(isValidIdempotencyKey('قصير')).toBe(false)
    expect(isValidIdempotencyKey('contains spaces 123456')).toBe(false)
  })
})
