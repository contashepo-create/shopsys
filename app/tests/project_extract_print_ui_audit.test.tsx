import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
vi.mock('../src/ui/print/printReceipt.ts', async importOriginal => ({ ...(await importOriginal<typeof import('../src/ui/print/printReceipt.ts')>()), printHtml: vi.fn() }))
import { printHtml } from '../src/ui/print/printReceipt.ts'
import { ProjectExtractsPage } from '../src/ui/pages/ContractingPages.tsx'
import { EMPTY_EXTENDED, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const initial = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
 const setup = { ...app.setup, completed: true, countryCode: 'EG', activityId: 'contracting' as const, modules: ['contracting'] as never[], vatPercent: 0 }
 useAppStore.setState({ setup, companySetup: setup })
 useRawDataStore.setState({ ...initial, currentUserId: null, activeBranchId: null, branches: [], customers: [], projects: [], boqItems: [], projectExtracts: [], clientAdvances: [], journal: [], vouchers: [], clientSettlements: [], changeOrders: [], paymentTerminals: [] })
 S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'المالك', phone: '', creditLimitMinor: 0, notes: '' })
 const client = S().customers.at(-1)!
 const project = S().addProject({ nameAr: 'فيلا', clientId: client.id, clientName: client.nameAr, contractValueMinor: 100000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
 const item = S().addBoqItem({ projectId: project.id, code: '1', descriptionAr: 'دهانات', unit: 'م2', qty: 1000, unitPriceMinor: 100 })
 S().receiveClientAdvance({ projectId: project.id, amountMinor: 10000, treasury: '1101' })
 S().addProjectExtract({ projectId: project.id, description: 'حصر', payment: 'credit', vatPercent: 0, advanceRecoveryMinor: 10000, extractQtyLines: [{ boqItemId: item.id, cumulativeQty: 200 }] })
 vi.mocked(printHtml).mockClear()
})
afterEach(() => { cleanup(); useRawDataStore.setState(initial); useAppStore.setState(app) })
it('طباعة الفاتورة والمستخلص تعرض صافي الإصدار بعد استرداد الدفعة لا الإجمالي قبلها', () => {
 render(<MemoryRouter><ProjectExtractsPage /></MemoryRouter>)
 for (const button of [screen.getByTitle('طباعة فاتورة احترافية للعميل كأنها فاتورة بيع ولكنها مستخلص'), screen.getByTitle('طباعة وثيقة المستخلص الهندسي')]) {
  fireEvent.click(button)
  const html = String(vi.mocked(printHtml).mock.lastCall?.[0])
  expect(html).toContain('حصر كميات الأعمال')
  expect(html).toMatch(/صافي قيمة (?:الفاتورة|المستخلص) عند الإصدار[\s\S]{0,250}>100(?:\.00)? ج\.م</)
 }
})
