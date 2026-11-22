import { afterEach, beforeEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ReportsPage } from '../src/ui/pages/ReportsPage.tsx'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const initial = useRawDataStore.getState(), app = useAppStore.getState()
const order = { id: 1, orderNumber: 'CPO-1', itemId: 1, itemNameAr: 'قطعة', customerId: null, customerName: 'عميل', customerPhone: '٠٥٠١٢٣٤٥٦٧', qty: 1, orderedAt: '2026-11-01', status: 'arrived' as const, linkedPurchaseOrderId: null, arrivedAt: '2026-11-02', deliveredAt: null, notes: '' }
beforeEach(() => {
 const setup = { ...app.setup, completed: true, countryCode: 'SA', activityId: 'spare_parts' as const }
 useAppStore.setState({ setup, companySetup: setup })
 useRawDataStore.setState({ ...initial, currentUserId: null, activeBranchId: null, branches: [], sales: [], saleReturns: [], purchases: [], purchaseReturns: [], vouchers: [], items: [], customers: [], suppliers: [], batches: [], journal: [], projects: [], pendingPartOrders: [order], purchaseOrders: [], productionOrders: [], variantStocks: [], deliveryJobs: [], tickets: [], serials: [], wastages: [] } as never)
})
afterEach(() => { cleanup(); useRawDataStore.setState(initial); useAppStore.setState(app) })
it('إخطار قطعة الغيار يستخدم بلد المنشأة والأرقام العربية دون تحويل مصري صامت', () => {
 render(<MemoryRouter><ReportsPage /></MemoryRouter>)
 const link = screen.getByRole('link', { name: /إخطار واتساب/ })
 expect(link.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/966501234567\?text=/)
})
it('يوقف رابط الرقم المحلي المجهول أو المشوه ويعرض سبب المراجعة', () => {
 useRawDataStore.setState({ pendingPartOrders: [{ ...order, customerPhone: 'invalid' }] })
 render(<MemoryRouter><ReportsPage /></MemoryRouter>)
 expect(screen.queryByRole('link', { name: /إخطار واتساب/ })).toBeNull()
 expect(screen.getByText(/رقم واتساب يحتاج مراجعة/)).toBeTruthy()
})
