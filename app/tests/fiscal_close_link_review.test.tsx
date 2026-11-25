import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { closingMechanismIds, type FiscalYear } from '../src/core/fiscal.ts'
import { fiscalCloseLinkIssues, hasAmbiguousUnassignedFiscalReversals, hasHiddenFiscalReversalClaims } from '../src/core/fiscalCloseLinkReview.ts'
import { incomeStatement } from '../src/core/financialReports.ts'
import type { JournalEntry } from '../src/core/ledger.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { useRawDataStore } from '../src/data/repo.ts'
import { GeneralSettingsPage } from '../src/ui/pages/GeneralSettingsPage.tsx'

const app = useAppStore.getState(), data = useRawDataStore.getState()
const year: FiscalYear = { id: 1, nameAr: '2024', startDate: '2024-01-01', endDate: '2024-12-31', status: 'open' }
const base: JournalEntry = { id: 1, entryNumber: 1, date: '2024-06-01', description: 'قيد', sourceType: 'manual', sourceId: null, lines: [{ accountCode: '1101', debit: 10000, credit: 0 }, { accountCode: '4101', debit: 0, credit: 10000 }], createdAt: '2024-06-01', createdBy: 'م', reversedByEntryId: null, reversesEntryId: null }
const reverse = (id: number, original: JournalEntry): JournalEntry => ({ ...original, id, entryNumber: id, sourceType: 'reversal', sourceId: original.id, reversesEntryId: original.id, reversedByEntryId: null, lines: original.lines.map(line => ({ ...line, debit: line.credit, credit: line.debit })) })
beforeEach(() => { useAppStore.setState({ ...app, activeBranchContext: null, fiscalYears: [year] }); useRawDataStore.setState({ ...data, loggedOut: false, currentUserId: null, branches: [], activeBranchId: null, journal: [base] }) })
afterEach(() => { cleanup(); useRawDataStore.setState(data); useAppStore.getState().setActiveBranchContext(null); useAppStore.setState(app) })

describe('روابط آلية الإقفال', () => {
 it('تتبع سلسلة العكس حتى الثبات بصرف النظر عن ترتيب المصفوفة وبلا دوران', () => {
  const rows = [{ id: 4, sourceType: 'reversal', reversesEntryId: 3 }, { id: 2, sourceType: 'year_closing', reversesEntryId: 4 }, { id: 3, sourceType: 'reversal', reversesEntryId: 2 }, { id: 5, sourceType: 'manual' }]
  expect([...closingMechanismIds(rows)].sort()).toEqual([2, 3, 4])
  expect([...closingMechanismIds([...rows].reverse())].sort()).toEqual([2, 3, 4])
  expect(closingMechanismIds([{ id: 1, reversesEntryId: 2 }, { id: 2, reversesEntryId: 1 }]).size).toBe(0)
 })
 it('يرفض أصل العكس المفقود أو المستقبلي أو العكس المكرر أو المختلف في الطرف أو الأبعاد', () => {
  const r = reverse(2, base)
  expect(fiscalCloseLinkIssues([base, r], year)).toEqual([])
  expect(fiscalCloseLinkIssues([r], year)).toEqual([2])
  expect(fiscalCloseLinkIssues([{ ...base, date: '2025-01-01' }, r], year)).toEqual([2])
  expect(fiscalCloseLinkIssues([base, r, reverse(3, base)], year)).toEqual([2, 3])
  expect(fiscalCloseLinkIssues([base, { ...r, lines: r.lines.map((line, i) => i ? { ...line, partyId: 7 } : line) }], year)).toEqual([2])
  expect(fiscalCloseLinkIssues([base, { ...r, lines: r.lines.map(line => ({ ...line, accountCode: '1102' })) }], year)).toEqual([2])
  expect(fiscalCloseLinkIssues([base, { ...r, reversesEntryId: null }], year)).toEqual([2])
 })
 it('لا يستبعد قيداً متنكراً بغير نوع العكس ضمن آلية الإقفال', () => {
  const close = { ...base, sourceType: 'year_closing' as const }
  const bad = { ...reverse(2, close), sourceType: 'manual' as const }
  expect(fiscalCloseLinkIssues([close, bad], year)).toEqual([2])
  expect(closingMechanismIds([close, bad]).has(bad.id)).toBe(false)
  expect(incomeStatement([close, bad], { from: year.startDate, to: year.endDate }).netProfitMinor).toBe(-10000)
 })
 it('يتجاهل عكساً يقع بعد السنة ولكنه لا يتجاهل أصلاً مستقبلياً لعكس فيها', () => {
  const r = reverse(2, base)
  expect(fiscalCloseLinkIssues([base, { ...r, date: '2025-01-01', reversesEntryId: 99 }], year)).toEqual([])
  expect(fiscalCloseLinkIssues([{ ...base, date: '2025-01-01' }, r], year)).toEqual([2])
 })
 it('يحجب الإقفال بنيوياً دون كتابة للدفتر أو حالة السنة إذا اختفى الأصل', () => {
  const orphan = { ...reverse(2, base), branchId: 1, reversesEntryId: 99 }
  useRawDataStore.setState({ journal: [base, orphan] })
  const before = useRawDataStore.getState().journal
  expect(() => useRawDataStore.getState().closeFiscalYear(year, [year])).toThrow(/روابط عكس غير مثبتة/)
  expect(useRawDataStore.getState().journal).toBe(before)
  expect(useAppStore.getState().fiscalYears[0].status).toBe('open')
 })
 it('تعرض الواجهة سبب الحجب وتعطل التأكيد بدلاً من إظهار مبلغ إقفال متوقع', () => {
  useRawDataStore.setState({ journal: [base, { ...reverse(2, base), branchId: 1, reversesEntryId: 99 }] })
  render(<MemoryRouter><GeneralSettingsPage /></MemoryRouter>)
  fireEvent.click(screen.getByText('🔒 إقفال السنة'))
  expect(screen.getByLabelText('مراجعة الدفتر قبل الإقفال').textContent).toContain('#2')
  expect(screen.getByText('🔒 تأكيد الإقفال').closest('button')?.disabled).toBe(true)
  expect(screen.queryByText(/صافي قيد الإقفال المتوقع/)).toBeNull()
 })
 it('يحجب عكساً غير مسند ومجهول الأصل في الدفتر الكامل دون إسناده أو تسريب تفاصيله', () => {
  const orphan = { ...reverse(2, base), reversesEntryId: 99 }
  expect(hasAmbiguousUnassignedFiscalReversals([base, orphan], year)).toBe(true)
  expect(hasAmbiguousUnassignedFiscalReversals([base, reverse(2, base)], year)).toBe(false)
  expect(hasAmbiguousUnassignedFiscalReversals([base, { ...orphan, date: '2025-01-01' }], year)).toBe(false)
  expect(hasAmbiguousUnassignedFiscalReversals([base, { ...orphan, date: 'غير معروف' }], year)).toBe(true)
  const branchYear = { ...year, branchId: 1 }
  const branch = { id: 1, nameAr: 'الرئيسي', isMain: true, active: true, warehouseId: 1, treasuryCode: '1101' }
  useAppStore.setState({ fiscalYears: [branchYear] })
  useRawDataStore.setState({ branches: [branch], activeBranchId: 1, journal: [{ ...base, branchId: 1 }, orphan] })
  const before = useRawDataStore.getState().journal
  expect(() => useRawDataStore.getState().closeFiscalYear(branchYear, [branchYear])).toThrow(/عكس غير مسند/)
  expect(useRawDataStore.getState().journal).toBe(before)
  expect(useAppStore.getState().fiscalYears[0].status).toBe('open')
  useAppStore.getState().setActiveBranchContext(branch)
  render(<MemoryRouter><GeneralSettingsPage /></MemoryRouter>)
  fireEvent.click(screen.getByText('🔒 إقفال السنة'))
  const review = screen.getByLabelText('مراجعة الدفتر قبل الإقفال')
  expect(review.textContent).toContain('عكس غير مسند وأصله غير واضح')
  expect(review.textContent).not.toContain('#2')
  expect(screen.getByText('🔒 تأكيد الإقفال').closest('button')?.disabled).toBe(true)
 })
 it('يسمح بعكس سليم مع نشاط متبقٍ ويصفّر صافي السنة الصحيح', () => {
  const r = reverse(2, base)
  const later = { ...base, id: 3, entryNumber: 3 }
  useRawDataStore.setState({ journal: [base, r, later] })
  expect(useRawDataStore.getState().closeFiscalYear(year, [year]).netProfitMinor).toBe(10000)
  expect(useAppStore.getState().fiscalYears[0].status).toBe('closed')
 })
})

it('يحجب إقفال فرع أصل عاكس أُسند لفرع آخر دون كشف تفاصيل الفرع الآخر', () => {
  const branch = { id: 1, nameAr: 'الرئيسي', isMain: true, active: true, warehouseId: 1, treasuryCode: '1101' }
  const other = { id: 2, nameAr: 'فرع آخر سري', isMain: false, active: true, warehouseId: 2, treasuryCode: '1102' }
  const branchYear = { ...year, branchId: 1 }
  const first = { ...base, branchId: 1 }
  const cross = { ...reverse(2, first), branchId: 2, description: 'تفاصيل خاصة' }
  const later = { ...first, id: 3, entryNumber: 3 }
  const journal = [first, cross, later]
  useAppStore.setState({ fiscalYears: [branchYear] })
  useRawDataStore.setState({ branches: [branch, other], activeBranchId: 1, journal })
  expect(() => useRawDataStore.getState().closeFiscalYear(branchYear, [branchYear])).toThrow(/عكس خارج نطاق الفرع/)
  expect(useRawDataStore.getState().journal).toBe(journal)
  expect(useAppStore.getState().fiscalYears[0].status).toBe('open')
  useAppStore.getState().setActiveBranchContext(branch)
  render(<MemoryRouter><GeneralSettingsPage /></MemoryRouter>)
  fireEvent.click(screen.getByText('🔒 إقفال السنة'))
  const review = screen.getByLabelText('مراجعة الدفتر قبل الإقفال')
  expect(review.textContent).toContain('عكس خارج نطاق الفرع')
  expect(review.textContent).not.toMatch(/#2|فرع آخر سري|تفاصيل خاصة/)
  expect(screen.queryByText(/صافي قيد الإقفال المتوقع/)).toBeNull()
  expect(screen.getByText('🔒 تأكيد الإقفال').closest('button')?.disabled).toBe(true)
})

it('يراجع المطالبة المخفية للسنة فقط ولا يحجب حركة ظاهرة أو فرعاً غير متعلق', () => {
  const first = { ...base, branchId: 1 }
  const localReverse = { ...reverse(2, first), branchId: 1 }
  const cross = { ...reverse(3, first), branchId: 2 }
  const unrelated = { ...base, id: 4, entryNumber: 4, branchId: 2 }
  const otherReverse = { ...reverse(5, unrelated), branchId: 3 }
  expect(hasHiddenFiscalReversalClaims([first, localReverse], [first, localReverse], year)).toBe(false)
  expect(hasHiddenFiscalReversalClaims([first, unrelated, otherReverse], [first], year)).toBe(false)
  expect(hasHiddenFiscalReversalClaims([first, cross], [first], year)).toBe(true)
  expect(hasHiddenFiscalReversalClaims([first, { ...cross, date: '2025-01-01' }], [first], year)).toBe(false)
  expect(hasHiddenFiscalReversalClaims([first, { ...cross, date: '2023-12-31' }], [first], year)).toBe(false)
  expect(hasHiddenFiscalReversalClaims([first, { ...cross, date: 'غير معروف' }], [first], year)).toBe(true)
  expect(hasHiddenFiscalReversalClaims([first, cross], [first, cross], year)).toBe(false)
  expect(hasHiddenFiscalReversalClaims([first, cross], [null as unknown as JournalEntry, first], year)).toBe(true)
})

it('لا يستعيد حالة إقفال مفتوحة عند وجود مطالبة عكس مخفية بالقيد الأصلي', () => {
  const branch = { id: 1, nameAr: 'الرئيسي', isMain: true, active: true, warehouseId: 1, treasuryCode: '1101' }
  const other = { id: 2, nameAr: 'الثاني', isMain: false, active: true, warehouseId: 2, treasuryCode: '1102' }
  const branchYear = { ...year, branchId: 1 }, first = { ...base, branchId: 1 }
  useAppStore.setState({ fiscalYears: [branchYear] })
  useRawDataStore.setState({ branches: [branch, other], activeBranchId: 1, journal: [first] })
  useRawDataStore.getState().closeFiscalYear(branchYear, [branchYear])
  const closing = useRawDataStore.getState().journal[1]
  const hidden = { ...reverse(3, first), branchId: 2 }
  const journal = [first, closing, hidden]
  useRawDataStore.setState({ journal })
  useAppStore.setState({ fiscalYears: [branchYear] })
  expect(() => useRawDataStore.getState().closeFiscalYear(branchYear, [branchYear])).toThrow(/عكس خارج نطاق الفرع/)
  expect(useRawDataStore.getState().journal).toBe(journal)
  expect(useAppStore.getState().fiscalYears[0].status).toBe('open')
})
