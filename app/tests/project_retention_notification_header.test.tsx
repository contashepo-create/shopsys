import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Header } from '../src/ui/layout/Header.tsx'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'

vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
const original = useRawDataStore.getState(), app = useAppStore.getState()
const S = () => useRawDataStore.getState()
beforeEach(() => {
  const setup = { ...app.setup, completed: true, countryCode: 'EG', activityId: 'contracting' as const, modules: ['contracting'] as never[] }
  useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
  useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: null, branches: [], projects: [], projectExtracts: [], projectCosts: [], retentionReleases: [], projectBudgets: [], projectSurveys: [], projectExtractDrafts: [], projectCloseouts: [], clientAdvances: [], changeOrders: [], projectTasks: [], subContracts: [], customers: [], employees: [], journal: [], boqItems: [], readNotificationIds: [], treasuries: [{ code: '1101', nameAr: 'الخزينة', kind: 'cash', isDefault: true }] })
})
afterEach(() => { cleanup(); useRawDataStore.setState(original); useAppStore.setState(app) })

it('الجرس يميز الموعد الاسترشادي والموعد المفقود والأدلة التالفة دون تعطيل المشروع السليم', () => {
  const makeProject = (nameAr: string) => {
    const project = S().addProject({ nameAr, clientName: '', contractValueMinor: 10000, retentionPercent: 10, startDate: '2025-01-01', notes: '' })
    const extract = S().addProjectExtract({ projectId: project.id, date: '2025-02-01', grossMinor: 1000, payment: 'cash', description: 'أعمال', vatPercent: 0 })
    return { project, extract }
  }
  const valid = makeProject('ألف'), missing = makeProject('باء'), corrupt = makeProject('جيم')
  useRawDataStore.setState({ projects: S().projects.map(row => row.id === valid.project.id ? { ...row, actualHandoverDate: '2025-01-31', defectsLiabilityMonths: 1 } : row), journal: S().journal.filter(row => row.id !== corrupt.extract.journalEntryId) })
  render(<MemoryRouter><Header title="الرئيسية" /></MemoryRouter>)
  const bell = document.querySelector('button[title*="تنبيه"]') as HTMLButtonElement
  fireEvent.click(bell)
  expect(screen.getByText('مراجعة تاريخ محتجز المشروع: ألف')).toBeTruthy()
  expect(screen.getByText('مراجعة تاريخ محتجز المشروع: باء')).toBeTruthy()
  expect(screen.getByText('مراجعة محتجز المشروع: جيم')).toBeTruthy()
  expect(screen.getByText(/نهاية الضمان المحسوبة من البيانات المدخلة/).textContent).toContain('راجع العقد والتسليم والاستحقاق')
  expect(screen.queryByText(/محتجز مستحق الإفراج/)).toBeNull()
  expect(S().projects.find(row => row.id === missing.project.id)?.status).toBe('active')
})
