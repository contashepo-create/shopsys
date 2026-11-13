import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ProjectExtractCreditBox } from '../src/ui/contracting/ProjectExtractCreditBox.tsx'
import { EMPTY_EXTENDED, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'

const initial = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 5, 12))
  const setup = { ...app.setup, completed: true, countryCode: 'EG', activityId: 'contracting' as const, modules: ['contracting'] as never[] }
  useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
  useRawDataStore.setState({ ...initial, currentUserId: null, activeBranchId: null, branches: [], customers: [], projects: [], boqItems: [], projectExtracts: [], clientAdvances: [], journal: [], vouchers: [], clientSettlements: [], changeOrders: [], paymentTerminals: [], paymentTerminalTransactions: [], treasuries: [{ code: '1101', nameAr: 'الخزينة', kind: 'cash', isDefault: true }] })
  S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل', phone: '', creditLimitMinor: 0, notes: '' })
})
afterEach(() => { cleanup(); useRawDataStore.setState(initial); useAppStore.setState(app); vi.useRealTimers() })
it('لا ينفذ قبل اختيار صفر للمقدمة ويمنع تجاوز المتبقي القابل للتسوية', () => {
  const p = S().addProject({ nameAr: 'مشروع', clientId: S().customers[0].id, clientName: 'عميل', contractValueMinor: 10000, retentionPercent: 10, startDate: '2025-01-01', notes: '' })
  const item = S().addBoqItem({ projectId: p.id, code: '1', descriptionAr: 'عمل', unit: 'م', qty: 100, unitPriceMinor: 100 })
  S().receiveClientAdvance({ projectId: p.id, amountMinor: 3000, treasury: '1101' })
  const extract = S().addProjectExtract({ projectId: p.id, description: 'أعمال', payment: 'credit', vatPercent: 15, advanceRecoveryMinor: 2000, extractQtyLines: [{ boqItemId: item.id, cumulativeQty: 100 }] })
  const onSubmit = vi.fn()
  render(<ProjectExtractCreditBox extract={extract} currencySymbol="ج" fmt={String} hasRetentionRelease={false} hasDocumentationInvoice={false} onSubmit={onSubmit} />)
  fireEvent.change(screen.getByLabelText('كمية الرد 1'), { target: { value: '40' } })
  fireEvent.change(screen.getByLabelText('سبب الإشعار'), { target: { value: 'رفض أعمال' } })
  fireEvent.click(screen.getByText('على حساب العميل'))
  const button = screen.getByRole('button', { name: /تنفيذ إشعار الكميات/ }) as HTMLButtonElement
  expect(button.disabled).toBe(true)
  fireEvent.click(screen.getByRole('checkbox', { name: /أختار صفرًا للمقدمة المعادة/ }))
  expect(button.disabled).toBe(false)
  fireEvent.click(button)
  expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 4200, restoredAdvanceMinor: 0, mode: 'customer_credit', quantities: [{ boqItemId: item.id, qty: 40 }] }))
  fireEvent.change(screen.getByLabelText('كمية الرد 1'), { target: { value: '90' } })
  expect(screen.getByRole('alert').textContent).toContain('لا يغطي المقدمة')
  expect(button.disabled).toBe(true)
})
