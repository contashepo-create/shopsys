import { afterEach, beforeEach, expect, it } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { AnalyticalProjectReportView } from '../src/ui/contracting/AnalyticalProjectReportView.tsx'
import { useDataStore, EMPTY_EXTENDED, type DataState } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { getCountry } from '../src/core/countries.ts'
import { formatMinor } from '../src/core/money.ts'

const original = useDataStore.getState()
const appOriginal = useAppStore.getState()
beforeEach(() => {
  useDataStore.setState({ ...original, customers: [], projects: [], projectExtracts: [], projectCosts: [], purchases: [], purchaseReturns: [], journal: [] })
  useAppStore.setState({ ...appOriginal, setup: { ...appOriginal.setup, countryCode: 'EG', vatPercent: 0, allowNegativeTreasury: true } })
})
afterEach(() => { cleanup(); useDataStore.setState(original); useAppStore.setState(appOriginal) })

it('التقرير يخصم مرتجع شراء المشروع ويتحدث عند إضافته بعد فتح الشاشة', () => {
  const store = useDataStore.getState()
  store.addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل', phone: '', creditLimitMinor: 0, notes: '' })
  const customer = useDataStore.getState().customers.at(-1)!
  const project = useDataStore.getState().addProject({ nameAr: 'مشروع', clientId: customer.id, clientName: customer.nameAr, contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
  useDataStore.getState().addProjectCost({ projectId: project.id, kind: 'materials', amountMinor: 1000, payment: 'cash', description: 'مواد', treasury: '1101' })
  const currency = getCountry('EG')!.currency
  const total = () => screen.getAllByText('إجمالي المصروفات')[0].parentElement?.textContent
  render(<AnalyticalProjectReportView projectId={String(project.id)} onProjectChange={() => {}} />)
  expect(total()).toContain(formatMinor(1000, currency, false))
  act(() => useDataStore.setState({
    purchases: [{ id: 999, projectId: project.id }] as DataState['purchases'],
    purchaseReturns: [{ purchaseId: 999, returnNumber: 'R-1', totalMinor: 300, date: '2026-01-03' }] as DataState['purchaseReturns'],
  }))
  expect(total()).toContain(formatMinor(700, currency, false))
  expect(screen.getByText('مرتجع مشتريات المشروع')).toBeTruthy()
})
