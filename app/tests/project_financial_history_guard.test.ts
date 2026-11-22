import { describe, expect, it } from 'vitest'
import { assertProjectFinancialHistoryPreserved as guard } from '../src/core/projectFinancialHistoryGuard.ts'
import { mergeConcurrentSnapshots } from '../src/data/persistentStorage.ts'

const release = { id: 8, projectId: 4, amountMinor: 300, journalEntryId: 12, date: '2025-01-05' }
const refund = { date: '2025-01-03', amountMinor: 100, taxShareMinor: 15, journalEntryId: 5, quantities: [{ boqItemId: 2, qty: 1 }], reason: 'رد' }
const extract = { id: 3, projectId: 4, extractNumber: 'PRX-3', journalEntryId: 1, lines: [{ boqItemId: 2, qty: 5 }], totals: { dueMinor: 400 }, refundedMinor: 100, refundedTaxMinor: 15, quantityCreditVersion: 1, refunds: [refund] }
const current = { projectExtracts: [extract], retentionReleases: [release] }
const wrap = (state: object) => JSON.stringify({ state })

describe('حماية الأدلة المحلية لإشعار المستخلص وتحصيل المحتجز', () => {
  it('يسمح بتاريخ غير موجود وبتعديل مستخلص ليس عليه دليل إشعار', () => {
    expect(() => guard({}, {})).not.toThrow()
    expect(() => guard({ projectExtracts: [{ id: 1, refundedMinor: 0 }] }, { projectExtracts: [{ id: 1, totals: { dueMinor: 10 } }] })).not.toThrow()
  })
  it('يرفض إسقاط تحصيل المحتجز أو تغييره أو تكراره', () => {
    for (const list of [[], [{ ...release, amountMinor: 301 }], [release, release]]) expect(() => guard(current, { ...current, retentionReleases: list })).toThrow(/المحتجز/)
  })
  it('يرفض إسقاط المستخلص أو دليله أو تعديله أو تبديل ترتيبه أو تكراره', () => {
    const candidates = [[], [{ ...extract, refunds: [] }], [{ ...extract, refunds: [{ ...refund, amountMinor: 99 }] }], [{ ...extract, totals: { dueMinor: 399 } }], [extract, extract]]
    for (const projectExtracts of candidates) expect(() => guard(current, { ...current, projectExtracts })).toThrow()
  })
  it('يقبل إضافة إشعار مع حفظ الأصل والقديم وتطابق الزيادة العددية فقط', () => {
    const next = { ...extract, refundedMinor: 120, refundedTaxMinor: 18, refunds: [refund, { amountMinor: 20, taxShareMinor: 3, journalEntryId: 6 }] }
    expect(() => guard(current, { ...current, projectExtracts: [next], retentionReleases: [release, { ...release, id: 9 }] })).not.toThrow()
    expect(() => guard(current, { ...current, projectExtracts: [{ ...next, refundedTaxMinor: 19 }] })).toThrow('مجاميع')
    expect(() => guard(current, { ...current, projectExtracts: [{ ...next, refundedMinor: 100 }] })).toThrow('مجاميع')
    expect(() => guard(current, { ...current, projectExtracts: [{ ...next, refunds: [refund, { amountMinor: -1 }] }] })).toThrow('غير صالحة')
  })
  it('لا يحول إشعاراً مالياً قديماً تلقائياً إلى دليل كميات أو يغير نسخته', () => {
    const legacy = { ...extract, quantityCreditVersion: undefined }
    expect(() => guard({ projectExtracts: [legacy] }, { projectExtracts: [{ ...legacy, quantityCreditVersion: 1 }] })).toThrow('إشعار قديم')
    expect(() => guard(current, { ...current, projectExtracts: [{ ...extract, quantityCreditVersion: 2 }] })).toThrow('نسخة دليل')
  })
  it('يرفض المجاميع التالفة أو المتجاوزة للأعداد الآمنة ولا يفسرها على أنها صفر', () => {
    for (const x of [-1, NaN, null, Number.MAX_SAFE_INTEGER + 1, '100']) expect(() => guard(current, { ...current, projectExtracts: [{ ...extract, refundedMinor: x }] })).toThrow('غير صالحة')
    expect(() => guard(current, { ...current, projectExtracts: [{ ...extract, refunds: null }] })).toThrow('دليل إشعار')
  })
  it('يحمي الدليل عند دمج اللقطات دون منع عمل مستقل', () => {
    const bad = { ...current, projectExtracts: [{ ...extract, refunds: [] }] }
    expect(() => mergeConcurrentSnapshots(wrap(current), wrap(bad), wrap({ ...current, preferences: { theme: 'dark' } }))).toThrow()
    const independent = JSON.parse(mergeConcurrentSnapshots(wrap(current), wrap(current), wrap({ ...current, preferences: { theme: 'dark' } }))).state
    expect(independent.projectExtracts).toEqual([extract]); expect(independent.preferences.theme).toBe('dark')
  })
})
