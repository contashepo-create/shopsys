import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
const lock = vi.hoisted(() => ({ failAfter: false, calls: 0 }))
vi.mock('../src/data/invoiceCommitLock.ts', () => ({ withInvoiceCommitLock: async (_refresh: unknown, commit: () => unknown) => { lock.calls++; const result = commit(); if (lock.failAfter) throw new Error('flush failed'); return result } }))
import { ProjectsPage } from '../src/ui/pages/ContractingPages.tsx'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { todayLocalIso } from '../src/core/time.ts'
import { ToastHost, useToast } from '../src/ui/components/ui.tsx'
const initial = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
 const setup = { ...app.setup, completed: true, activityId: 'contracting' as const, countryCode: 'EG', modules: ['contracting'] as never[] }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
 useRawDataStore.setState({ ...initial, currentUserId: null, activeBranchId: null, branches: [], projects: [], boqItems: [], projectExtracts: [], projectCosts: [], retentionReleases: [], projectSurveys: [], projectExtractDrafts: [], projectCloseouts: [], clientAdvances: [], changeOrders: [], projectTasks: [], subContracts: [], customers: [], employees: [], journal: [], treasuries: [{ code: '1101', nameAr: 'الخزينة', kind: 'cash', isDefault: true }] })
 const p = S().addProject({ nameAr: 'مشروع اختبار', clientName: '', contractValueMinor: 20000, retentionPercent: 10, startDate: '2025-01-01', notes: '' })
 S().addProjectExtract({ projectId: p.id, date: '2025-04-30', grossMinor: 1000, payment: 'cash', description: 'أعمال', vatPercent: 0 })
 lock.failAfter = false; lock.calls = 0; useToast.setState({ msg: null, kind: 'success' })
})
afterEach(() => { cleanup(); useRawDataStore.setState(initial); useAppStore.setState(app) })
function open() {
 render(<MemoryRouter><ProjectsPage /><ToastHost /></MemoryRouter>)
 fireEvent.click(screen.getByTitle(/الإفراج عن المحتجز/))
 const date = screen.getByLabelText('تاريخ تحصيل المحتجز') as HTMLInputElement
 expect(date.value).toBe(todayLocalIso()); expect(date.type).toBe('date'); expect(date.max).toBe(todayLocalIso())
 fireEvent.change(date, { target: { value: '2025-05-01' } })
}
it('يحفظ تاريخ التقويم في التحصيل والقيد مع وقت إقفال فعلي', async () => {
 open(); fireEvent.click(screen.getByRole('button', { name: /تحصيل وإقفال/ }))
 await waitFor(() => expect(S().retentionReleases).toHaveLength(1))
 expect(S().retentionReleases[0].date).toBe('2025-05-01'); expect(S().journal[1].date).toBe('2025-05-01')
 expect(S().projects[0].completedAt?.slice(0, 10)).toBe(todayLocalIso()); expect(lock.calls).toBe(1)
})
it('يرفض تغيير الأساس منذ فتح النافذة', async () => {
 open()
 S().addProjectExtract({ projectId: S().projects[0].id, grossMinor: 100, payment: 'cash', description: 'أعمال جديدة', vatPercent: 0 })
 fireEvent.click(screen.getByRole('button', { name: /تحصيل وإقفال/ }))
 await waitFor(() => expect(screen.getByText(/تغير المشروع أو مستخلصاته أو محتجزه/)).toBeTruthy())
 expect(S().retentionReleases).toHaveLength(0); expect(S().projects[0].status).toBe('active')
})
it('يحذر ويغلق النافذة بعد تعذر تأكيد الحفظ بدلاً من تشجيع التكرار', async () => {
 open(); lock.failAfter = true; fireEvent.click(screen.getByRole('button', { name: /تحصيل وإقفال/ }))
 await waitFor(() => expect(screen.queryByLabelText('تاريخ تحصيل المحتجز')).toBeNull())
 expect(S().retentionReleases).toHaveLength(1); expect(S().journal).toHaveLength(2)
 expect(screen.getByText(/تعذر تأكيد الحفظ/)).toBeTruthy()
})

it('نافذة التحصيل تبين حدود الإقفال ونقص الاستحقاق دون تغيير السلوك المالي', () => {
 open()
 expect(screen.getByRole('region', { name: 'مراجعة حالة إقفال المشروع' }).textContent).toContain('ليست موافقة أو إثباتاً للإقفال')
 expect(screen.getByText(/لا يمكن استنتاج استحقاق المحتجز/)).toBeTruthy()
 expect(screen.getByText(/لا يظهر مستخلص ختامي/)).toBeTruthy()
 expect(screen.queryByText(/ضمان انتهى أجله/)).toBeNull()
 expect(S().projects[0].status).toBe('active'); expect(S().retentionReleases).toHaveLength(0)
})

it('تظهر المراجعة في التفاصيل حتى عند عدم وجود محتجز، واسم الحالة لا يدّعي التسليم', () => {
 useRawDataStore.setState({ projects: [{ ...S().projects[0], status: 'completed', retentionPercent: 0 }] })
 render(<MemoryRouter><ProjectsPage /></MemoryRouter>)
 expect(screen.getByText('مكتمل بالنظام')).toBeTruthy(); expect(screen.queryByText('مُسلَّم')).toBeNull()
 fireEvent.click(screen.getByTitle('التفاصيل والقيود'))
 expect(screen.getByRole('region', { name: 'مراجعة حالة إقفال المشروع' }).textContent).toContain('لا تثبت وحدها التسليم')
})

it('تتحدث مقارنة الضمان بتغير تاريخ التحصيل المدخل', () => {
 useRawDataStore.setState({ projects: [{ ...S().projects[0], actualHandoverDate: '2025-04-30', defectsLiabilityMonths: 1 }] })
 open()
 expect(screen.getByText(/يسبق نهاية الضمان.*2025-05-30/)).toBeTruthy()
 fireEvent.change(screen.getByLabelText('تاريخ تحصيل المحتجز'), { target: { value: '2025-05-30' } })
 expect(screen.getByText(/نهاية الضمان المحسوبة.*2025-05-30/)).toBeTruthy()
 expect(screen.queryByText(/يسبق نهاية الضمان/)).toBeNull()
})
it.each(['treasury', 'terminal', 'fiscal', 'permissions', 'hidden-journal'] as const)('يرفض تحصيل النافذة عند تغيير أساس %s بعد فتحها', async key => {
 open()
 act(() => {
  if (key === 'treasury') useRawDataStore.setState({ treasuries: S().treasuries.map(row => ({ ...row, nameAr: 'خزينة معدلة' })) })
  if (key === 'terminal') useRawDataStore.setState({ paymentTerminals: [...S().paymentTerminals, { id: 't', code: 'TERM-0001', nameAr: 'ماكينة', providerName: 'مزود', branchId: '', settlementAccountCode: '1101', terminalId: 'P1', status: 'active' }] })
  if (key === 'fiscal') useAppStore.setState({ fiscalYears: [{ id: 2, nameAr: 'فترة', status: 'closed', startDate: '2026-01-01', endDate: '2026-12-31' }] })
  if (key === 'permissions') useRawDataStore.setState({ roleOverrides: { ...S().roleOverrides, accountant: [] } as never })
  if (key === 'hidden-journal') useRawDataStore.setState({ journal: [...S().journal, { ...S().journal[0], id: 99, entryNumber: 99 }] })
 })
 fireEvent.click(screen.getByRole('button', { name: /تحصيل وإقفال/ }))
 await waitFor(() => expect(screen.getByText(/تغير المشروع أو مستخلصاته أو محتجزه/)).toBeTruthy())
 expect(S().retentionReleases).toHaveLength(0); expect(S().projects[0].status).toBe('active')
})
