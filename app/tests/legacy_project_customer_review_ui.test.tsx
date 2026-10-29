import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ProjectsPage } from '../src/ui/pages/ContractingPages.tsx'
import { ContractingReportsPage } from '../src/ui/pages/ContractingReportsPage.tsx'
import { EMPTY_EXTENDED, useRawDataStore, useDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'

vi.mock('../src/ui/print/printReceipt.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/ui/print/printReceipt.ts')>()
  return { ...actual, printHtml: vi.fn() }
})
import { printHtml } from '../src/ui/print/printReceipt.ts'

const original = useRawDataStore.getState()
const app = useAppStore.getState()
afterEach(() => { cleanup(); useRawDataStore.setState(original); useAppStore.setState(app) })
it('واجهة الربط تعرض مقدار الدين وتشترط مراجعة وسبباً قبل توثيقه', () => {
  useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true } })
  useRawDataStore.setState({ ...original, branches: [], activeBranchId: null, appUsers: [], currentUserId: null, customers: [], projects: [], projectExtracts: [], clientAdvances: [], sales: [], journal: [], vouchers: [], clientSettlements: [], cheques: [], openingBalances: {}, branchOpeningBalances: {}, insuranceClaims: [], clinicPatients: [], labPatients: [], auditLog: [] })
  const s = useDataStore.getState()
  s.addCustomer({ ...EMPTY_EXTENDED, nameAr: 'جهة', phone: '', creditLimitMinor: 0, notes: '' })
  const customer = useDataStore.getState().customers.at(-1)!
  const project = s.addProject({ nameAr: 'مشروع قديم', clientId: customer.id, clientName: customer.nameAr, contractValueMinor: 10000, retentionPercent: 0, startDate: '2025-01-01', notes: '' })
  s.addProjectExtract({ projectId: project.id, grossMinor: 8000, vatPercent: 0, payment: 'credit', description: 'آجل' })
  useRawDataStore.setState({ projects: useDataStore.getState().projects.map(p => ({ ...p, clientId: null })) })
  render(<MemoryRouter><ProjectsPage /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: 'مراجعة الذمة' }))
  fireEvent.change(screen.getByLabelText('عميل المستخلص التاريخي'), { target: { value: String(customer.id) } })
  fireEvent.click(screen.getByRole('button', { name: 'فحص قبل الربط' }))
  expect(screen.getByRole('status').textContent).toContain('80.00')
  const save = screen.getByRole('button', { name: 'توثيق الربط' }) as HTMLButtonElement
  expect(save.disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('سبب مراجعة الربط'), { target: { value: 'مطابقة المستندات والتحصيلات' } })
  fireEvent.click(screen.getByRole('checkbox', { name: /أقرّ أنني طابقت/ }))
  expect(save.disabled).toBe(false)
  fireEvent.click(save)
  expect(useDataStore.getState().getCustomerBalance(customer.id)).toBe(8000)
})


it('لوحة تقارير المقاولات لا تعرض ذمة يتيمة كمبلغ مفتوح مؤكد أو تجمعها في الإجمالي', () => {
  useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true } })
  useRawDataStore.setState({ ...original, branches: [], activeBranchId: null, appUsers: [], currentUserId: null, customers: [], projects: [], projectExtracts: [], clientAdvances: [], sales: [], journal: [], vouchers: [], clientSettlements: [], cheques: [], openingBalances: {}, branchOpeningBalances: {}, insuranceClaims: [], clinicPatients: [], labPatients: [], auditLog: [] })
  const s = useDataStore.getState()
  s.addCustomer({ ...EMPTY_EXTENDED, nameAr: 'جهة', phone: '', creditLimitMinor: 0, notes: '' })
  const customer = useDataStore.getState().customers.at(-1)!
  const project = s.addProject({ nameAr: 'مشروع قديم', clientId: customer.id, clientName: customer.nameAr, contractValueMinor: 10000, retentionPercent: 0, startDate: '2025-01-01', notes: '' })
  s.addProjectExtract({ projectId: project.id, grossMinor: 8000, vatPercent: 0, payment: 'credit', description: 'آجل' })
  useRawDataStore.setState({ projects: useDataStore.getState().projects.map(p => ({ ...p, clientId: null })) })
  render(<MemoryRouter><ContractingReportsPage /></MemoryRouter>)
  expect(screen.getAllByText('تتطلب مراجعة ربط العميل والتحصيلات').length).toBeGreaterThanOrEqual(2)
  fireEvent.click(document.querySelector('[data-print="projects"]')!)
  expect(vi.mocked(printHtml).mock.calls.at(-1)?.[0]).toContain('تتطلب مراجعة ربط العميل والتحصيلات')
  fireEvent.click(screen.getByRole('button', { name: 'ذمم العملاء' }))
  fireEvent.click(document.querySelector('[data-print="dues"]')!)
  expect(vi.mocked(printHtml).mock.calls.at(-1)?.[0]).toContain('مستخلصات بلا سجل عميل صحيح مستبعدة')
  expect(vi.mocked(printHtml).mock.calls.at(-1)?.[0]).toContain('إجمالي العملاء المرتبطين فقط')
})
