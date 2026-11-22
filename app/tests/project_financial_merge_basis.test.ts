import { describe, expect, it } from 'vitest'
import { mergeConcurrentSnapshots } from '../src/data/persistentStorage.ts'

const wrap = (state: object) => JSON.stringify({ state })
const base = {
  projects: [{ id: 1 }],
  clientAdvances: [{ id: 1, projectId: 1, amountMinor: 1000, recoveredMinor: 0, journalEntryId: 2 }],
  projectExtracts: [{ id: 1, projectId: 1, refunds: [] }],
  journal: [{ id: 1 }],
}
const advance = { ...base, clientAdvances: [{ ...base.clientAdvances[0], recoveredMinor: 100 }], projectExtracts: [{ ...base.projectExtracts[0], advanceRecoveryMinor: 100 }] }
const recovery = { ...advance, projectExtracts: [{ ...base.projectExtracts[0], advanceRecoveryMinor: 100, advanceAllocations: [{ advanceId: 1, journalEntryId: 2, amountMinor: 100 }] }] }
const credit = { ...base, projectExtracts: [{ ...base.projectExtracts[0], quantityCreditVersion: 2, refunds: [{ id: 1 }] }] }

function rejectsBothSides(issuing: object, other: object) {
  expect(() => mergeConcurrentSnapshots(wrap(base), wrap(issuing), wrap(other))).toThrow(/تعارض/)
  expect(() => mergeConcurrentSnapshots(wrap(base), wrap(other), wrap(issuing))).toThrow(/تعارض/)
}

describe('حراسة أسس دمج لقطات مقدمة المشروع وإشعاره', () => {
  it.each(['vouchers', 'clientSettlements', 'sales', 'saleReturns', 'cheques', 'openingBalances', 'branchOpeningBalances', 'partyOffsets', 'retentionReleases', 'paymentTerminalTransactions', 'treasuries', 'paymentTerminals', 'customers', 'branches', 'appUsers', 'customRoles'])('يرفض تغيير %s المتزامن مع المقدمة أو الاسترداد', key => {
    const other = { ...base, [key]: [{ id: 2 }] }
    rejectsBothSides(advance, other)
    rejectsBothSides(recovery, other)
  })
  it.each([
    ['activeBranchId', 2], ['currentUserId', 2], ['loggedOut', true],
    ['roleOverrides', { accountant: [] }], ['branchRoleOverrides', { 1: { accountant: [] } }],
  ])('يرفض تغيير %s المتزامن مع المقدمة أو الاسترداد', (key, value) => {
    const other = { ...base, [key]: value }
    rejectsBothSides(advance, other)
    rejectsBothSides(recovery, other)
  })
  it.each([
    ['loggedOut', true], ['roleOverrides', { accountant: [] }],
    ['branchRoleOverrides', { 1: { accountant: [] } }], ['customRoles', [{ id: 'role' }]],
  ])('يرفض تغيير صلاحية أو جلسة %s متزامناً مع إشعار الكميات', (key, value) => {
    rejectsBothSides(credit, { ...base, [key]: value })
  })
  it('يسمح بدمج تغيير مستقل لا يدخل في أساس الترحيل وبالطرف غير المتغير', () => {
    const other = { ...base, userPrefs: { owner: { theme: 'dark' } } }
    expect(JSON.parse(mergeConcurrentSnapshots(wrap(base), wrap(advance), wrap(other))).state).toMatchObject({
      clientAdvances: advance.clientAdvances, userPrefs: other.userPrefs,
    })
    expect(JSON.parse(mergeConcurrentSnapshots(wrap(base), wrap(recovery), wrap(base))).state.projectExtracts).toEqual(recovery.projectExtracts)
  })
})

describe('حراسة أساس تحصيل المحتجز عند دمج لقطة البيانات', () => {
  const issued = { ...base, retentionReleases: [{ id: 1, projectId: 1, amountMinor: 100 }], projects: [{ id: 1, status: 'completed' }], journal: [...base.journal, { id: 2 }] }
  it.each(['projectExtracts', 'clientAdvances', 'boqItems', 'changeOrders', 'projectSurveys', 'projectExtractDrafts', 'projectCloseouts', 'retentionReleases'])('يرفض التعديل المتزامن في %s للمشروع بالاتجاهين', key => {
    const previous = (base as Record<string, unknown>)[key]
    const added = key === 'clientAdvances' ? { id: 7, projectId: 1, amountMinor: 100, recoveredMinor: 0, journalEntryId: 7 } : { id: 7, projectId: 1 }
    const other = { ...base, [key]: [...(Array.isArray(previous) ? previous : []), added] }
    rejectsBothSides(issued, other)
  })
  it.each(['journal', 'paymentTerminalTransactions', 'paymentTerminals', 'treasuries', 'customers', 'branches', 'appUsers', 'vouchers', 'clientSettlements'])('يرفض تغيير %s أثناء التحصيل بالاتجاهين', key => {
    const previous = (base as Record<string, unknown>)[key]
    const other = { ...base, [key]: [...(Array.isArray(previous) ? previous : []), { id: 7 }] }
    rejectsBothSides(issued, other)
  })
  it('يسمح بتغيير مستقل عن الأساس، ولا يعدّل القيد أو مبلغ التحصيل', () => {
    const other = { ...base, userPrefs: { owner: { theme: 'dark' } } }
    const result = JSON.parse(mergeConcurrentSnapshots(wrap(base), wrap(issued), wrap(other))).state
    expect(result.retentionReleases).toEqual(issued.retentionReleases)
    expect(result.journal).toEqual(issued.journal)
    expect(result.userPrefs).toEqual(other.userPrefs)
  })
})
it('يرفض دمج لقطات يحفظ التحصيل لكنه يسقط أو يغيّر مستخلصاً مخصصاً بالاتجاهين', () => {
  const extract = { id: 5, projectId: 9, journalEntryId: 2, totals: { retentionMinor: 100 } }
  const release = { id: 3, projectId: 9, amountMinor: 100, journalEntryId: 4, allocationEvidence: { version: 1, allocations: [{ extractId: 5, journalEntryId: 2, amountMinor: 100 }] } }
  const initial = { projectExtracts: [extract], retentionReleases: [release], preferences: { mode: 'light' } }
  const independent = { ...initial, preferences: { mode: 'dark' } }
  for (const extracts of [[], [{ ...extract, journalEntryId: 3 }]]) {
    const edited = { ...initial, projectExtracts: extracts }
    expect(() => mergeConcurrentSnapshots(wrap(initial), wrap(edited), wrap(independent))).toThrow(/أساس توزيع تحصيل المحتجز/)
    expect(() => mergeConcurrentSnapshots(wrap(initial), wrap(independent), wrap(edited))).toThrow(/أساس توزيع تحصيل المحتجز/)
  }
  expect(JSON.parse(mergeConcurrentSnapshots(wrap(initial), wrap(initial), wrap(independent))).state).toEqual(independent)
})
