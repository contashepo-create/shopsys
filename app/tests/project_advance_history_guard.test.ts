import { describe, expect, it } from 'vitest'
import { assertProjectFinancialHistoryPreserved as guard } from '../src/core/projectFinancialHistoryGuard.ts'
import { mergeConcurrentSnapshots } from '../src/data/persistentStorage.ts'

const advance = { id: 2, projectId: 5, date: '2026-01-01', amountMinor: 1000, recoveredMinor: 250, journalEntryId: 7 }
const current = { clientAdvances: [advance], projectExtracts: [{ id: 1, projectId: 5, advanceRecoveryMinor: 250 }], retentionReleases: [] }
const wrap = (state: object) => JSON.stringify({ state })

describe('حماية أصل دفعة مقدمة العميل عبر اللقطات', () => {
  it('ترفض إسقاط الدفعة أو تكرارها أو حذف مجموعة الدفعات', () => {
    for (const next of [{ clientAdvances: [] }, { clientAdvances: [advance, advance] }, {}]) expect(() => guard(current, next)).toThrow('المقدمة')
  })
  it.each(['id', 'projectId', 'date', 'amountMinor', 'journalEntryId'] as const)('ترفض تغيير %s الذي يثبت أصل الدفعة', field => {
    const changed = { ...advance, [field]: field === 'date' ? '2026-02-01' : 99 }
    expect(() => guard(current, { clientAdvances: [changed] })).toThrow('المقدمة')
  })
  it('تسمح بتغيير رصيد استرداد صحيح وإضافة دفعة جديدة دون تعديل الأصل', () => {
    expect(() => guard(current, { clientAdvances: [{ ...advance, recoveredMinor: 500 }, { ...advance, id: 3, recoveredMinor: 0 }], projectExtracts: [{ id: 1, projectId: 5, advanceRecoveryMinor: 500 }] })).not.toThrow()
    expect(() => guard(current, { clientAdvances: [{ ...advance, recoveredMinor: 0 }], projectExtracts: [{ id: 1, projectId: 5, advanceRecoveryMinor: 0 }] })).not.toThrow()
  })
  it('ترفض رصيد استرداد متغير تالفاً أو خارج مبلغ أصل الدفعة', () => {
    for (const value of [-1, 1001, 1.5, '500', null, Number.MAX_SAFE_INTEGER + 1]) expect(() => guard(current, { clientAdvances: [{ ...advance, recoveredMinor: value }] })).toThrow('غير صالحة')
    expect(() => guard({ clientAdvances: [{ ...advance, recoveredMinor: null }] }, { clientAdvances: [{ ...advance, recoveredMinor: 0 }] })).toThrow('غير صالحة')
  })
  it('لا تختلق رصيداً لسجل قديم وتتيح إبقاءه دون تغيير', () => {
    const old = { id: 3, projectId: 1, date: 'قديم', amountMinor: 100, journalEntryId: 9 }
    expect(() => guard({ clientAdvances: [old] }, { clientAdvances: [old] })).not.toThrow()
    expect(() => guard({ clientAdvances: [old] }, { clientAdvances: [{ ...old, recoveredMinor: 0 }] })).toThrow('غير صالحة')
  })
  it('تحمي أصل الدفعة عند دمج اللقطات، وتقبل عملاً مستقلاً مع تغيير رصيد سليم', () => {
    const bad = { ...current, clientAdvances: [{ ...advance, amountMinor: 900 }] }
    expect(() => mergeConcurrentSnapshots(wrap(current), wrap(bad), wrap({ ...current, prefs: { theme: 'dark' } }))).toThrow('أصل دفعة المقدمة')
    const changed = { ...current, clientAdvances: [{ ...advance, recoveredMinor: 400 }], projectExtracts: [{ id: 1, projectId: 5, advanceRecoveryMinor: 400 }] }
    const merged = JSON.parse(mergeConcurrentSnapshots(wrap(current), wrap(changed), wrap({ ...current, prefs: { theme: 'dark' } }))).state
    expect(merged.clientAdvances[0].recoveredMinor).toBe(400); expect(merged.prefs.theme).toBe('dark')
  })
})

describe('ربط تغير استرداد المقدمة بإجمالي مستخلصات المشروع', () => {
  it('يرفض تغيير الرصيد وحده أو تغيير مستخلص آخر أو نقص اللقطة', () => {
    const changed = [{ ...advance, recoveredMinor: 400 }]
    expect(() => guard(current, { ...current, clientAdvances: changed })).toThrow('لا يطابق')
    expect(() => guard(current, { ...current, clientAdvances: changed, projectExtracts: [...current.projectExtracts, { id: 2, projectId: 9, advanceRecoveryMinor: 150 }] })).toThrow('لا يطابق')
    expect(() => guard(current, { clientAdvances: changed })).toThrow('تعذّر مقارنة')
  })
  it('يقبل إصدار مستخلص أو تعديل مستخلص سابق بما يوافق التغير', () => {
    const raised = { ...current, clientAdvances: [{ ...advance, recoveredMinor: 400 }], projectExtracts: [...current.projectExtracts, { id: 2, projectId: 5, advanceRecoveryMinor: 150 }] }
    expect(() => guard(current, raised)).not.toThrow()
    const edited = { ...current, clientAdvances: [{ ...advance, recoveredMinor: 100 }], projectExtracts: [{ id: 1, projectId: 5, advanceRecoveryMinor: 100 }] }
    expect(() => guard(current, edited)).not.toThrow()
  })
  it('يفحص مجموع الدفعات في المشروع بما فيها دفعة جديدة', () => {
    const next = { ...current, clientAdvances: [{ ...advance, recoveredMinor: 300 }, { ...advance, id: 3, recoveredMinor: 100 }], projectExtracts: [{ id: 1, projectId: 5, advanceRecoveryMinor: 400 }] }
    expect(() => guard(current, next)).not.toThrow()
    expect(() => guard(current, { ...next, projectExtracts: [{ id: 1, projectId: 5, advanceRecoveryMinor: 300 }] })).toThrow('لا يطابق')
  })
  it('يفحص رصيد دفعة مضافة لمشروع له مقدمة محلية ولو لم يتغير رصيدها', () => {
    const next = { ...current, clientAdvances: [advance, { ...advance, id: 3, recoveredMinor: 100 }] }
    expect(() => guard(current, next)).toThrow('لا يطابق')
    expect(() => guard(current, { ...next, projectExtracts: [{ id: 1, projectId: 5, advanceRecoveryMinor: 350 }] })).not.toThrow()
  })
  it('يرفض قيمة تالفة أو مجموعاً غير آمن أو إشعار مقدمة تجريبياً', () => {
    const changed = { ...current, clientAdvances: [{ ...advance, recoveredMinor: 400 }] }
    for (const value of [-1, 1.5, '150', null]) expect(() => guard(current, { ...changed, projectExtracts: [{ id: 1, projectId: 5, advanceRecoveryMinor: value }] })).toThrow('غير صالح')
    expect(() => guard(current, { ...changed, projectExtracts: [{ id: 1, projectId: 5, advanceRecoveryMinor: Number.MAX_SAFE_INTEGER }, { id: 2, projectId: 5, advanceRecoveryMinor: 1 }] })).toThrow('غير صالح')
    expect(() => guard(current, { ...changed, projectExtracts: [{ id: 1, projectId: 5, advanceRecoveryMinor: 400, quantityCreditVersion: 3 }] })).toThrow('تجريبي')
  })
  it('يختبر تغير المجاميع فقط ولا يصحح فارقاً قديماً أو يثبت التخصيص', () => {
    const legacy = { ...current, projectExtracts: [{ id: 1, projectId: 5, advanceRecoveryMinor: 100 }] }
    const next = { ...legacy, clientAdvances: [{ ...advance, recoveredMinor: 300 }], projectExtracts: [{ id: 1, projectId: 5, advanceRecoveryMinor: 150 }] }
    expect(() => guard(legacy, next)).not.toThrow()
  })
  it('يرفض الدمج الذي يغير الرصيد وحده حتى مع تعديل مستقل', () => {
    const changed = { ...current, clientAdvances: [{ ...advance, recoveredMinor: 400 }] }
    expect(() => mergeConcurrentSnapshots(wrap(current), wrap(changed), wrap({ ...current, prefs: { theme: 'dark' } }))).toThrow('لا يطابق')
  })
})

describe('كشف تغير استرداد المستخلص أو أول دفعة مستقلة', () => {
  it('يرفض تغيير أو إسقاط استرداد مستخلص دون رصيد مطابق', () => {
    for (const extracts of [[], [{ id: 1, projectId: 5, advanceRecoveryMinor: 100 }], [{ id: 1, projectId: 5 }]]) {
      expect(() => guard(current, { ...current, projectExtracts: extracts })).toThrow('لا يطابق')
    }
  })
  it('يرفض نقل مستخلص مسترد لمشروع آخر حتى لو بقي الإجمالي الشامل ثابتاً', () => {
    expect(() => guard(current, { ...current, projectExtracts: [{ id: 1, projectId: 6, advanceRecoveryMinor: 250 }] })).toThrow('لا يطابق')
  })
  it('يفحص أول دفعة مستردة لمشروع بلا دفعات محلية', () => {
    const empty = { clientAdvances: [], projectExtracts: [] }
    const issued = { clientAdvances: [advance], projectExtracts: [{ id: 1, projectId: 5, advanceRecoveryMinor: 250 }] }
    expect(() => guard(empty, issued)).not.toThrow()
    expect(() => guard(empty, { ...issued, projectExtracts: [] })).toThrow('لا يطابق')
    expect(() => guard(empty, { ...issued, clientAdvances: [{ ...advance, recoveredMinor: 1001 }] })).toThrow('رصيد دفعة المقدمة غير صالح')
    expect(() => guard({}, issued)).toThrow('تعذّر مقارنة')
  })
  it('يرفض استرداد مستخلص بلا دفعة في لقطة واردة وإن لم توجد دفعة محلية', () => {
    expect(() => guard({ clientAdvances: [], projectExtracts: [] }, { clientAdvances: [], projectExtracts: [{ id: 1, projectId: 5, advanceRecoveryMinor: 50 }] })).toThrow('لا يطابق')
  })
  it('يرفض مشروعاً غير معرف أو قيمة جديدة تالفة ويترك القيمة القديمة دون اختلاق', () => {
    const empty = { clientAdvances: [], projectExtracts: [] }
    expect(() => guard(empty, { ...empty, projectExtracts: [{ id: 1, advanceRecoveryMinor: 10 }] })).toThrow('مشروع استرداد المقدمة')
    expect(() => guard(empty, { ...empty, projectExtracts: [{ id: 1, projectId: 5, advanceRecoveryMinor: null }] })).toThrow('غير صالح')
    const legacy = { ...current, projectExtracts: [{ id: 1, projectId: 5, advanceRecoveryMinor: null }] }
    expect(() => guard(legacy, legacy)).not.toThrow()
  })
  it('يسمح بتعديل وصف مستخلص دون استرداد وبتمثيل الصفر القديم كحقل غائب', () => {
    const before = { ...current, projectExtracts: [{ id: 1, projectId: 5, advanceRecoveryMinor: 250 }, { id: 2, projectId: 5, description: 'قديم' }] }
    const after = { ...before, projectExtracts: [before.projectExtracts[0], { id: 2, projectId: 5, advanceRecoveryMinor: 0, description: 'جديد' }] }
    expect(() => guard(before, after)).not.toThrow()
  })
  it('يرفض تغيير الاسترداد وحده أثناء دمج اللقطات', () => {
    const changed = { ...current, projectExtracts: [{ id: 1, projectId: 5, advanceRecoveryMinor: 100 }] }
    expect(() => mergeConcurrentSnapshots(wrap(current), wrap(changed), wrap({ ...current, prefs: { theme: 'dark' } }))).toThrow('لا يطابق')
  })
})
