import { afterEach, beforeEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { draftFromCategory } from '../src/core/items.ts'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { PurchasesPage } from '../src/ui/pages/PurchasesPage.tsx'
import { PurchaseReturnsPage } from '../src/ui/pages/PurchaseReturnsPage.tsx'
const raw = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
 const setup = { ...app.setup, completed: true, countryCode: 'EG', activityId: 'grocery' as const, vatPercent: 0, taxRegistrationStatus: 'exempt' as const }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
 useRawDataStore.setState({ ...raw, currentUserId: null, activeBranchId: null, branches: [], suppliers: [{ id: 7, nameAr: 'مورد', phone: '', active: true }] as never, items: [{ ...draftFromCategory(undefined, 'RET'), id: 1, nameAr: 'سلعة', costMinor: 3000, priceMinor: 5000, stockQty: 30 }], purchases: [], purchaseReturns: [], journal: [], warehouses: [], batches: [], serials: [] })
})
afterEach(() => { cleanup(); useRawDataStore.setState(raw); useAppStore.setState(app) })
it('يفتح تصحيح الفاتورة الأصلية مباشرة من القائمة دون حذفها أو تعديل قيودها', async () => {
 const invoice = S().postPurchase({ supplierId: 7, date: '2026-01-01', lines: [{ itemId: 1, qty: 2, unitPriceMinor: 3000 }], expenses: [], paidMinor: 0, notes: '' })
 const entries = S().journal.length, stock = S().items[0].stockQty
 render(<MemoryRouter initialEntries={['/purchases/invoices']}><Routes><Route path="/purchases/invoices" element={<PurchasesPage />} /><Route path="/purchases/returns" element={<PurchaseReturnsPage />} /></Routes></MemoryRouter>)
 fireEvent.click(screen.getByRole('button', { name: `تصحيح فاتورة الشراء ${invoice.invoiceNumber} بمرتجع` }))
 await waitFor(() => expect(screen.getByRole('dialog').textContent).toContain(invoice.invoiceNumber))
 expect(S().purchases).toHaveLength(1); expect(S().purchaseReturns).toHaveLength(0)
 expect(S().journal).toHaveLength(entries); expect(S().items[0].stockQty).toBe(stock)
})

it('يوضح حدود المرتجع ويمنع الترحيل عندما تختلط ضريبة المدخلات بالمصاريف المحملة', async () => {
 const invoice = S().postPurchase({ supplierId: 7, date: '2026-01-01', lines: [{ itemId: 1, qty: 2, unitPriceMinor: 3000 }], expenses: [{ nameAr: 'شحن', amountMinor: 1000, method: 'value', paidBy: 'supplier', costTreatment: 'inventory', taxTreatment: 'exclusive', taxPercent: 14 }], paidMinor: 0, inputVatMinor: 0, purchaseExpenseTaxRecoverable: true, notes: '' })
 render(<MemoryRouter initialEntries={[`/purchases/returns?purchase=${invoice.id}`]}><Routes><Route path="/purchases/returns" element={<PurchaseReturnsPage />} /></Routes></MemoryRouter>)
 await waitFor(() => expect(screen.getByRole('dialog').textContent).toContain(invoice.invoiceNumber))
 expect(screen.getByRole('note').textContent).toContain('المصاريف لا تُسترد أو تُلغى تلقائياً')
 expect(screen.getByRole('alert').textContent).toContain('لا يمكن فصل ضريبة البضاعة')
 expect((screen.getByRole('button', { name: /تنفيذ المرتجع/ }) as HTMLButtonElement).disabled).toBe(true)
 expect(S().purchaseReturns).toHaveLength(0)
})
