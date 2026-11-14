import { afterEach, beforeEach, expect, it } from 'vitest'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import type { FiscalYear } from '../src/core/fiscal.ts'
import type { JournalEntry } from '../src/core/ledger.ts'

const oldData = useRawDataStore.getState(), oldApp = useAppStore.getState()
const year: FiscalYear = { id: 1, nameAr: '2024', startDate: '2024-01-01', endDate: '2024-12-31', status: 'open' }
const later: FiscalYear = { id: 2, nameAr: '2025', startDate: '2025-01-01', endDate: '2025-12-31', status: 'open' }
const revenue: JournalEntry = { id: 1, entryNumber: 1, date: '2024-06-01', description: 'إيراد', sourceType: 'manual', sourceId: null, lines: [{ accountCode: '1101', debit: 10000, credit: 0 }, { accountCode: '4101', debit: 0, credit: 10000 }], createdAt: '2024-06-01', createdBy: 'محاسب', reversedByEntryId: null, reversesEntryId: null }
const S = () => useRawDataStore.getState()
const A = () => useAppStore.getState()
beforeEach(() => { useAppStore.setState({ ...oldApp, fiscalYears: [year, later] }); useRawDataStore.setState({ ...oldData, loggedOut: false, currentUserId: null, appUsers: [], branches: [], activeBranchId: null, journal: [revenue] }) })
afterEach(() => { useRawDataStore.setState(oldData); useAppStore.setState(oldApp) })

it('يرفض سنة غير مسجلة أو تاريخاً معدلاً دون المساس بالدفتر أو حالة السنوات', () => {
 const before = S().journal
 expect(() => S().closeFiscalYear({ ...year, id: 99 }, [year])).toThrow(/غير موجودة/)
 expect(() => S().closeFiscalYear({ ...year, endDate: '2024-11-30' }, [year])).toThrow(/تغيرت بيانات/)
 expect(S().journal).toBe(before); expect(A().fiscalYears).toEqual([year, later])
})
it('لا يستخدم قائمة سنوات ناقصة من النافذة لتجاوز ترتيب الإقفال', () => {
 expect(() => S().closeFiscalYear(later, [later])).toThrow(/السنة الأقدم/)
 expect(S().journal).toEqual([revenue]); expect(A().fiscalYears).toEqual([year, later])
})
it('يرفض التداخل أو تكرار معرّف السنة حتى لو مررت بيانات تبدو صحيحة', () => {
 A(); useAppStore.setState({ fiscalYears: [year, { ...later, startDate: '2024-12-01' }] })
 expect(() => S().closeFiscalYear(year, [year])).toThrow(/تتداخل/)
 useAppStore.setState({ fiscalYears: [year, { ...year }] })
 expect(() => S().closeFiscalYear(year, [year])).toThrow(/مكررة/)
 expect(S().journal).toEqual([revenue])
})
it('لا تعاد سنة مقفلة بلا قيد إقفال أو عكس مثبت', () => {
 const closed = { ...year, status: 'closed' as const }
 useAppStore.setState({ fiscalYears: [closed] })
 expect(() => S().reopenFiscalYear(closed, [closed])).toThrow(/لا يوجد قيد إقفال/)
 expect(A().fiscalYears[0].status).toBe('closed'); expect(S().journal).toEqual([revenue])
})
it('يستعيد حالة الفتح بعد انقطاع فقط عندما يطابق العكس قيد الإقفال كاملاً', () => {
 useAppStore.setState({ fiscalYears: [year] })
 const result = S().closeFiscalYear(year, [year])
 const closed = A().fiscalYears[0]
 const reversed = S().reopenFiscalYear(closed, [closed])
 const openedJournal = S().journal
 useAppStore.setState({ fiscalYears: [closed] }) // انقطع الحفظ قبل حالة الفتح
 expect(S().reopenFiscalYear(closed, [closed])).toEqual({ reversedEntryId: null })
 expect(A().fiscalYears[0].status).toBe('open'); expect(S().journal).toBe(openedJournal)
 expect(reversed.reversedEntryId).not.toBeNull()
 useAppStore.setState({ fiscalYears: [closed] })
 useRawDataStore.setState({ journal: openedJournal.map(row => row.id === reversed.reversedEntryId ? { ...row, lines: [{ accountCode: '1101', debit: 1, credit: 0 }] } : row) })
 expect(() => S().reopenFiscalYear(closed, [closed])).toThrow(/عكس قيد الإقفال غير مثبت/)
 expect(A().fiscalYears[0].status).toBe('closed')
 expect(result.entryId).toBeTypeOf('number')
})
it('يرفض قيد إقفال سابقاً مسنداً لتاريخ مختلف بدلاً من إصلاح حالة خاطئة', () => {
 const invalid: JournalEntry = { ...revenue, id: 2, entryNumber: 2, sourceType: 'year_closing', sourceId: year.id, date: '2024-11-30' }
 useRawDataStore.setState({ journal: [revenue, invalid] })
 expect(() => S().closeFiscalYear(year, [year])).toThrow(/لا يطابق تاريخها/)
 expect(A().fiscalYears[0].status).toBe('open')
})

it('يمنع قيداً جديداً إذا بقيت السنة مفتوحة بعد حفظ قيد الإقفال إلى أن تُراجع الحالة', () => {
 useAppStore.setState({ fiscalYears: [year] })
 S().closeFiscalYear(year, [year])
 useAppStore.setState({ fiscalYears: [year] })
 const before = S().journal
 expect(() => S().postManualEntry({ date: '2024-07-01', description: 'إضافة متزامنة', lines: [{ accountCode: '1101', debit: 100, credit: 0 }, { accountCode: '4101', debit: 0, credit: 100 }] })).toThrow(/حالتها مفتوحة/)
 expect(S().journal).toBe(before); expect(A().fiscalYears[0].status).toBe('open')
})
