import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { retentionDueWarnings, retentionReleaseDueDate, retentionWarningsWithReview } from '../src/core/contracting.ts'
import { projectClosureIndicators } from '../src/core/projectClosureReview.ts'
import { FinancialDataReviewError } from '../src/core/financialDataReview.ts'
import { collectNotifications } from '../src/core/notifications.ts'
import { ProjectsPage } from '../src/ui/pages/ContractingPages.tsx'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'

const project = { id: 1, nameAr: 'ألف', actualHandoverDate: '2024-01-31', defectsLiabilityMonths: 1 }
const noContext = { advances: [], tasks: [], subContracts: [], custodyFiles: [] }

describe('مراجعة نهاية الضمان والمحتجز دون ادعاء الاستحقاق', () => {
  it('يتحقق من تاريخ تقويمي حقيقي ومن مدة صحيحة ويقبل صفراً ونهاية الشهر', () => {
    expect(retentionReleaseDueDate(project)).toBe('2024-02-29')
    expect(retentionReleaseDueDate({ ...project, defectsLiabilityMonths: 0 })).toBe('2024-01-31')
    for (const p of [
      { ...project, actualHandoverDate: '2024-02-30' }, { ...project, actualHandoverDate: '2024-01-31T00:00:00Z' },
      { ...project, defectsLiabilityMonths: 1.5 }, { ...project, defectsLiabilityMonths: NaN },
      { ...project, defectsLiabilityMonths: -1 }, { ...project, defectsLiabilityMonths: 1201 },
      { ...project, actualHandoverDate: '9999-12-31', defectsLiabilityMonths: 1 },
      { ...project, actualHandoverDate: '0099-01-31', defectsLiabilityMonths: 1 },
    ]) expect(retentionReleaseDueDate(p)).toBeNull()
  })
  it('لا يخفي خطأ أدلة مشروع بلا تاريخ، ويعزل التالف عن بقية المشاريع', () => {
    const projects = [project, { ...project, id: 2, nameAr: 'باء', actualHandoverDate: null }, { ...project, id: 3, nameAr: 'جيم', actualHandoverDate: null }, { ...project, id: 4, nameAr: 'دال' }]
    const result = retentionWarningsWithReview(projects, id => {
      if (id === 2) throw new FinancialDataReviewError('محتجز')
      return id === 4 ? NaN : 100
    }, '2024-03-01')
    expect(result.due.map(row => row.projectId)).toEqual([1])
    expect(result.review.map(row => row.projectId)).toEqual([2, 4])
    expect(result.scheduleReview.map(row => row.projectId)).toEqual([3])
    expect(() => retentionDueWarnings(projects, id => id === 2 ? NaN : 100, '2024-03-01')).toThrow(FinancialDataReviewError)
    expect(() => retentionWarningsWithReview([project], () => { throw new Error('خطأ برمجي') }, '2024-03-01')).toThrow('خطأ برمجي')
  })
  it('تاريخ مراجعة تالف أو مجهول لا يعطي تنبيهاً بتاريخ محسوب كأنه صحيح', () => {
    const result = retentionWarningsWithReview([project], () => 100, '2024-02-30')
    expect(result.due).toEqual([])
    expect(result.scheduleReview.map(row => row.projectId)).toEqual([1])
    expect(retentionWarningsWithReview([project], () => 0, '2024-02-30').scheduleReview).toEqual([])
  })
  it('التنبيه يصف الحساب وينبه إلى مراجعة العقد ولا يقول إن المحتجز مستحق', () => {
    const input = { batches: [], itemName: () => '', installmentPlans: [], customerName: () => '', cheques: [], fmt: String, todayIso: '2024-03-01' }
    const rows = collectNotifications({ ...input, retentionDueProjects: [{ projectId: 1, projectNameAr: 'ألف', dueDate: '2024-02-29', daysLeft: -1, remainingMinor: 100 }], retentionScheduleReviewProjects: [{ projectId: 2, projectNameAr: 'باء' }] })
    const due = rows.find(row => row.id === 'retdue:1')!
    expect(due.body).toContain('المحسوبة من البيانات المدخلة')
    expect(due.body).toContain('راجع العقد والتسليم والاستحقاق')
    expect(due.title).not.toContain('مستحق')
    expect(rows.find(row => row.id === 'retschedule:2')?.body).toContain('غير معلوم')
  })
})

describe('قراءة وصفية لمتعلقات الإقفال', () => {
  it('ترصد المقدمة غير المستردة والناقصة والمهام والباطن والعهدة في المشروع فقط', () => {
    const context = { advances: [{ projectId: 1, amountMinor: 1000, recoveredMinor: 200 }, { projectId: 1, amountMinor: 1000, recoveredMinor: NaN }], tasks: [{ projectId: 1, status: 'pending' }], subContracts: [{ projectId: 1, status: 'active' }], custodyFiles: [{ projectId: 1, status: 'open' }] }
    const text = projectClosureIndicators(project, '2024-03-01', [], [], [], context).join('\n')
    for (const phrase of ['مقدمة غير صالحة', 'لم يُسترد كامل', 'مهام غير منجزة', 'عقود باطن', 'ملفات عهدة']) expect(text).toContain(phrase)
    const other = { advances: context.advances.map(row => ({ ...row, projectId: 2 })), tasks: [{ projectId: 2, status: 'pending' }], subContracts: [{ projectId: 2, status: 'active' }], custodyFiles: [{ projectId: 2, status: 'open' }] }
    expect(projectClosureIndicators(project, '2024-03-01', [], [], [], other)).toEqual(projectClosureIndicators(project, '2024-03-01', [], [], [], noContext))
  })
  it('الحالات غير المعروفة لا تعامل كمنجزة والرصيد المسترد لا ينتج تنبيهاً كاذباً', () => {
    const context = { advances: [{ projectId: 1, amountMinor: 1000, recoveredMinor: 1000 }], tasks: [{ projectId: 1, status: 'unknown' }], subContracts: [{ projectId: 1, status: 'unknown' }], custodyFiles: [{ projectId: 1, status: 'unknown' }] }
    const text = projectClosureIndicators(project, '2024-03-01', [], [], [], context).join('\n')
    expect(text).not.toContain('لم يُسترد كامل')
    expect(text).toContain('مهام غير منجزة'); expect(text).toContain('عقود باطن'); expect(text).toContain('ملفات عهدة')
  })
})

const initial = useRawDataStore.getState(), app = useAppStore.getState()
beforeEach(() => {
  const setup = { ...app.setup, completed: true, countryCode: 'EG', activityId: 'contracting' as const, modules: ['contracting'] as never[] }
  useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
  useRawDataStore.setState({ ...initial, currentUserId: null, activeBranchId: null, branches: [], projects: [], projectExtracts: [], projectCosts: [], retentionReleases: [], projectSurveys: [], projectExtractDrafts: [], projectCloseouts: [], clientAdvances: [], changeOrders: [], projectTasks: [], subContracts: [], custodyFiles: [], customers: [], employees: [], journal: [], boqItems: [] })
})
afterEach(() => { cleanup(); useRawDataStore.setState(initial); useAppStore.setState(app); vi.restoreAllMocks() })

it('تفاصيل المشروع تعرض المؤشرات الجديدة دون تغيير حالة أو تسجيل حركة', () => {
  const state = useRawDataStore.getState()
  const p = state.addProject({ nameAr: 'مشروع التحقق', clientName: '', contractValueMinor: 1000, retentionPercent: 0, startDate: '2025-01-01', notes: '' })
  useRawDataStore.setState({ clientAdvances: [{ id: 1, projectId: p.id, date: '2025-01-01', amountMinor: 100, recoveredMinor: 20, journalEntryId: 1 }], projectTasks: [{ id: 1, projectId: p.id, nameAr: 'مهمة', startDate: '2025-01-01', endDate: '2025-01-31', progressPercent: 0, status: 'pending', boqItemId: null }], subContracts: [{ id: 1, projectId: p.id, status: 'active' }] as never, custodyFiles: [{ id: 1, projectId: p.id, status: 'open' }] as never })
  render(<MemoryRouter><ProjectsPage /></MemoryRouter>)
  fireEvent.click(screen.getByTitle('التفاصيل والقيود'))
  const text = screen.getByRole('region', { name: 'مراجعة حالة إقفال المشروع' }).textContent!
  for (const phrase of ['لم يُسترد كامل', 'مهام غير منجزة', 'عقود باطن', 'ملفات عهدة', 'ليست موافقة']) expect(text).toContain(phrase)
  expect(useRawDataStore.getState().projects[0].status).toBe('active')
  expect(useRawDataStore.getState().journal).toHaveLength(0)
})
