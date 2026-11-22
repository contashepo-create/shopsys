import { describe, expect, it } from 'vitest'
import { assertProjectFinancialHistoryPreserved as guard } from '../src/core/projectFinancialHistoryGuard.ts'
import { mergeConcurrentSnapshots } from '../src/data/persistentStorage.ts'

const a = { id: 1, projectId: 5, amountMinor: 1000, recoveredMinor: 250, journalEntryId: 7 }
const b = { id: 2, projectId: 5, amountMinor: 1000, recoveredMinor: 0, journalEntryId: 8 }
const allocation = { advanceId: 1, journalEntryId: 7, amountMinor: 250 }
const extract = { id: 3, projectId: 5, journalEntryId: 9, advanceRecoveryMinor: 250, advanceAllocations: [allocation] }
const base = { clientAdvances: [a, b], projectExtracts: [extract], retentionReleases: [] }
const wrap = (value: object) => JSON.stringify({ state: value })

describe('حماية تخصيص استرداد المقدمات في مقارنة اللقطات', () => {
  it('يرفض حذف توزيع قديم موثق حتى لو بقي مجموع الاسترداد كما هو', () => {
    const next = { ...base, projectExtracts: [{ ...extract, advanceAllocations: undefined }] }
    expect(() => guard(base, next)).toThrow('تسقط توزيع')
  })
  it('يرفض تعديل توزيع مستخلص دون قيد بديل حتى لو تساوى الإجمالي', () => {
    const next = { ...base, projectExtracts: [{ ...extract, advanceAllocations: [{ advanceId: 2, journalEntryId: 8, amountMinor: 250 }] }] }
    expect(() => guard(base, next)).toThrow('دون قيد مستخلص بديل')
  })
  it('يرفض تغيير التوزيع مع قيد جديد إن بقي رصيد كل دفعة دون تغير', () => {
    const next = { ...base, projectExtracts: [{ ...extract, journalEntryId: 10, advanceAllocations: [{ advanceId: 2, journalEntryId: 8, amountMinor: 250 }] }] }
    expect(() => guard(base, next)).toThrow('رصيد الدفعة لا يطابق')
  })
  it('يسمح بتغيّر التخصيص مع تغيّر الرصيد المقابل وقيد بديل', () => {
    const next = { ...base, clientAdvances: [{ ...a, recoveredMinor: 0 }, { ...b, recoveredMinor: 250 }], projectExtracts: [{ ...extract, journalEntryId: 10, advanceAllocations: [{ advanceId: 2, journalEntryId: 8, amountMinor: 250 }] }] }
    expect(() => guard(base, next)).not.toThrow()
  })
  it('يرفض مراجع دفعة أو قيد غير موجودة أو مكررة أو تخص مشروعاً آخر', () => {
    for (const rows of [
      [{ ...allocation, advanceId: 99 }], [{ ...allocation, journalEntryId: 99 }],
      [{ ...allocation, amountMinor: 100 }, { ...allocation, amountMinor: 150 }],
      [{ ...allocation, advanceId: 3, journalEntryId: 11 }],
    ]) {
      const next = { ...base, clientAdvances: [a, b, { ...b, id: 3, projectId: 6, journalEntryId: 11 }], projectExtracts: [{ ...extract, journalEntryId: 10, advanceAllocations: rows }] }
      expect(() => guard(base, next)).toThrow('توزيع استرداد المقدمة')
    }
  })
  it('يرفض مبالغ مكسورة أو صفرية أو سالبة أو غير آمنة ومجموع توزيع مخالف', () => {
    for (const amount of [0, -1, 1.5, null, '250', Number.MAX_SAFE_INTEGER + 1, 249]) {
      const next = { ...base, projectExtracts: [{ ...extract, journalEntryId: 10, advanceAllocations: [{ ...allocation, amountMinor: amount }] }] }
      expect(() => guard(base, next)).toThrow('توزيع استرداد المقدمة')
    }
  })
  it('يرفض مجموع تخصيص يتجاوز الحد الآمن', () => {
    const max = Number.MAX_SAFE_INTEGER
    const old = { clientAdvances: [{ ...a, amountMinor: max, recoveredMinor: 0 }, { ...b, amountMinor: max, recoveredMinor: 0 }], projectExtracts: [] }
    const next = { clientAdvances: [{ ...a, amountMinor: max, recoveredMinor: 1 }, { ...b, amountMinor: max, recoveredMinor: 0 }], projectExtracts: [{ ...extract, advanceRecoveryMinor: 1, advanceAllocations: [{ ...allocation, amountMinor: max }, { advanceId: 2, journalEntryId: 8, amountMinor: 1 }] }] }
    expect(() => guard(old, next)).toThrow('غير آمن')
  })
  it('يرفض إنشاء دليل تخصيص قديم دون قيد بديل ولا يختلقه تلقائياً', () => {
    const legacy = { ...base, projectExtracts: [{ ...extract, advanceAllocations: undefined }] }
    expect(() => guard(legacy, base)).toThrow('لا يُختلق توزيع')
    expect(() => guard(legacy, legacy)).not.toThrow()
    const edited = { ...base, clientAdvances: [{ ...a, recoveredMinor: 200 }, b], projectExtracts: [{ ...extract, journalEntryId: 10, advanceRecoveryMinor: 200, advanceAllocations: [{ ...allocation, amountMinor: 200 }] }] }
    expect(() => guard(legacy, edited)).not.toThrow()
  })
  it('يفحص التخصيصات المعروفة حتى مع وجود استرداد تاريخي غير موزع', () => {
    const legacy = { ...base, projectExtracts: [extract, { id: 4, projectId: 5, journalEntryId: 11, advanceRecoveryMinor: 100 }] }
    const next = { ...legacy, projectExtracts: [{ ...extract, advanceAllocations: undefined }, legacy.projectExtracts[1]] }
    expect(() => guard(legacy, next)).toThrow('تسقط توزيع')
  })
  it('لا يدعي إثبات التوزيع الفردي إذا بقيت استردادات قديمة بلا تخصيص', () => {
    const legacy = { ...base, projectExtracts: [{ id: 4, projectId: 5, journalEntryId: 11, advanceRecoveryMinor: 250 }] }
    const next = { ...legacy, clientAdvances: [{ ...a, recoveredMinor: 0 }, { ...b, recoveredMinor: 250 }] }
    expect(() => guard(legacy, next)).not.toThrow()
  })
  it('يرفض دمج دليل تخصيص متغير من دون قيد بديل ولو كان التعديل الآخر مستقلاً', () => {
    const bad = { ...base, projectExtracts: [{ ...extract, advanceAllocations: [{ advanceId: 2, journalEntryId: 8, amountMinor: 250 }] }] }
    expect(() => mergeConcurrentSnapshots(wrap(base), wrap(bad), wrap({ ...base, prefs: { theme: 'dark' } }))).toThrow('دون قيد مستخلص بديل')
  })
})
