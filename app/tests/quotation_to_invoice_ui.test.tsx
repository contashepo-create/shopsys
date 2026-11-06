import { afterEach, beforeEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { AdvancedSalesInvoicePage } from '../src/ui/pages/AdvancedSalesInvoicePage.tsx'
import { ToastHost } from '../src/ui/components/ui.tsx'
import type { Quotation } from '../src/core/contracting.ts'

const initialData = useRawDataStore.getState()
const initialApp = useAppStore.getState()
const quote: Quotation = { id: 7, quoteNumber: 'QT-7', kind: 'quotation', clientName: 'عميل', clientId: null, titleAr: 'عرض مختلط', date: '2026-11-06', validUntil: '2026-12-01', status: 'draft', notes: '', projectId: null, winProbability: 50, bidBondMinor: 0, lines: [
  { nameAr: 'شامل', descriptionAr: 'شامل', qty: 1, unitAr: 'عدد', unitPriceMinor: 11500, estCostMinor: 0, vatPercent: 15, taxIncluded: true },
  { nameAr: 'معفى', descriptionAr: 'معفى', qty: 1, unitAr: 'عدد', unitPriceMinor: 2000, estCostMinor: 0, vatPercent: 0, taxIncluded: false },
] }
beforeEach(() => {
  useAppStore.getState().setActiveBranchContext(null)
  useAppStore.setState({ setup: { ...initialApp.setup, countryCode: 'EG', vatPercent: 15, taxRegistrationStatus: 'registered' } })
  useRawDataStore.setState({ ...initialData, branches: [], activeBranchId: null, quotations: [quote], advancedInvoiceDrafts: [] })
})
afterEach(() => { cleanup(); useRawDataStore.setState(initialData); useAppStore.setState({ setup: initialApp.setup }); useAppStore.getState().setActiveBranchContext(null) })
function openAndFill() {
  render(<MemoryRouter><AdvancedSalesInvoicePage /><ToastHost /></MemoryRouter>)
  fireEvent.click(document.querySelector('[data-fill-from-open]')!)
  fireEvent.click(document.querySelector('[data-fill-source="qt-7"]')!)
}
it('تعبئة الفاتورة من العرض تحفظ السعر الصافي ونسب البنود الفعلية في مسودتها', () => {
  openAndFill()
  fireEvent.click(screen.getByRole('button', { name: /حفظ مسودة/ }))
  const saved = useRawDataStore.getState().advancedInvoiceDrafts.find(d => d.kind === 'sale')!
  expect(JSON.parse(saved.payload).lines).toMatchObject([{ unitPriceMinor: 10000, vatPercentOverride: 15 }, { unitPriceMinor: 2000, vatPercentOverride: 0 }])
})
it('لا تُنشئ بنوداً أو أصنافاً عندما تكون ضريبة الفاتورة معطلة', () => {
  useAppStore.setState({ setup: { ...initialApp.setup, countryCode: 'EG', vatPercent: 0, taxRegistrationStatus: 'exempt' } })
  const items = useRawDataStore.getState().items.length
  openAndFill()
  expect(screen.getByText(/لا يمكن نقل عرض خاضع للضريبة/)).toBeTruthy()
  expect(useRawDataStore.getState().items).toHaveLength(items)
  fireEvent.click(screen.getByRole('button', { name: /حفظ مسودة/ }))
  const saved = useRawDataStore.getState().advancedInvoiceDrafts.find(d => d.kind === 'sale')!
  expect(JSON.parse(saved.payload).lines).toEqual([])
})
