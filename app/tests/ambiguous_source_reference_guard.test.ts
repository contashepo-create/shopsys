import { describe, expect, it } from 'vitest'
import { STANDARD_COA, type JournalEntry } from '../src/core/ledger.ts'
import { assertJournalIntegrity, validateEntry } from '../src/core/ledgerGuard.ts'

const entry = (patch: Partial<JournalEntry> = {}): JournalEntry => ({
  id: 10,
  entryNumber: 10,
  date: '2026-06-15',
  description: 'اختبار مرجع مختلط',
  sourceType: 'adjustment',
  sourceId: 7,
  lines: [
    { accountCode: '1101', debit: 100, credit: 0, note: 'مدين' },
    { accountCode: '3101', debit: 0, credit: 100, note: 'دائن' },
  ],
  createdBy: 'اختبار',
  createdAt: '2026-06-15T12:00:00.000Z',
  reversedByEntryId: null,
  reversesEntryId: null,
  ...patch,
})

const context = {
  coa: STANDARD_COA,
  sourceCollectionIndexes: {
    stocktakes: new Map([[7, 2]]),
    settlements: new Map([[8, 2]]),
    sales: new Map([[7, 2]]),
  },
  requireSourceCollection: true,
}

describe('مرجع المستند في أنواع المصدر متعددة المجموعات', () => {
  it('يقبل المجموعة المختارة إذا كان المستند موجوداً ومن الفرع نفسه', () => {
    expect(validateEntry(entry({ branchId: 2, sourceCollection: 'stocktakes' }), { ...context, fiscalYears: [] })).toEqual([])
  })

  it('يرفض المصدر المختلط الجديد إذا لم يحدد مجموعة المستند', () => {
    expect(validateEntry(entry(), context).join(' ')).toContain('يجب تحديد مجموعة المستند')
  })

  it('يرفض مرجعاً غير موجود في المجموعة المختارة حتى لو وجد الرقم في مجموعة أخرى', () => {
    const errors = validateEntry(entry({ sourceCollection: 'settlements' }), context)
    expect(errors.join(' ')).toContain('غير موجود في سجلات النظام ضمن مجموعة «settlements»')
  })

  it('يرفض اختيار مجموعة غير مسموحة لنوع المصدر', () => {
    const errors = validateEntry(entry({ sourceCollection: 'sales' }), context)
    expect(errors.join(' ')).toContain('مجموعة المصدر «sales» غير مسموحة')
  })

  it('يرفض مستنداً من فرع مختلف', () => {
    const errors = validateEntry(entry({ branchId: 3, sourceCollection: 'stocktakes' }), context)
    expect(errors.join(' ')).toContain('تابع لفرع آخر')
  })

  it('يرفض تغيير مجموعة مصدر قيد مرحّل بصمت', () => {
    const old = entry({ sourceCollection: 'stocktakes' })
    expect(() => assertJournalIntegrity([old], [{ ...old, sourceCollection: 'settlements' }], { coa: STANDARD_COA }))
      .toThrow('تغيير وصف أو مصدر القيد')
  })

  it('لا يفرض discriminator على أنواع المصدر ذات المستند المباشر أو الاستثناءات المقصودة', () => {
    const legacyManual = entry({ sourceType: 'manual', sourceId: null, sourceCollection: undefined })
    expect(validateEntry(legacyManual, context)).toEqual([])
  })
})
