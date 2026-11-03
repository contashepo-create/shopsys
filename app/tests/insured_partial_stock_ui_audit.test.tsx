import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { InsuranceProvidersSection } from '../src/ui/components/InsuranceProvidersSection.tsx'
import { useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const initial = useRawDataStore.getState(), app = useAppStore.getState()
afterEach(() => { cleanup(); useRawDataStore.setState(initial); useAppStore.setState(app) })
it('يعرض حصة المريض والجهة للكمية المثبتة ويشترط إقرارها', () => {
 useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true } })
 useRawDataStore.setState({ ...initial, branches: [], activeBranchId: null, items: [], insuranceProviders: [], insuranceClaims: [], journal: [], batches: [], warehouses: [{ id: 1, nameAr: 'رئيسي', isMain: true }] })
 const s = useDataStore.getState()
 s.addItem({ nameAr: 'دواء', sku: '', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 1000, stockQty: 5, priceMinor: 10000, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
 const item = useDataStore.getState().items[0], provider = s.addInsuranceProvider({ nameAr: 'تأمين', coveragePercent: 70 })
 s.postInsuredSale({ lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 2, unitPriceMinor: 10000, unitCostMinor: 1000, discountPercent: 0, soldByWeight: false }], providerId: provider.id, taxPercent: 15, taxInclusive: false })
 s.settleInsuranceClaims(provider.id)
 render(<InsuranceProvidersSection />)
 fireEvent.click(screen.getByRole('button', { name: 'رد كمية من البيع' }))
 fireEvent.change(screen.getByLabelText('كمية مرتجع البيع المؤمن'), { target: { value: '1' } })
 expect(screen.getByText(/حصة المريض المصروفة/).textContent).toContain('34.50')
 fireEvent.change(screen.getByLabelText('سبب رد كمية البيع المؤمن'), { target: { value: 'إيصال 123' } })
 const submit = screen.getByRole('button', { name: /تأكيد رد الكمية/ }) as HTMLButtonElement
 expect(submit.disabled).toBe(true)
 fireEvent.click(screen.getByLabelText(/أؤكد استلام الكمية المحددة/))
 expect(submit.disabled).toBe(false)
 fireEvent.click(submit)
 expect(s.getInsuranceRefundBalance(useDataStore.getState().insuranceClaims[0].id)).toBe(8050)
 expect(useDataStore.getState().items[0].stockQty).toBe(4)
})
