import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { InsuranceProvidersSection } from '../src/ui/components/InsuranceProvidersSection.tsx'
import { useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const initial = useRawDataStore.getState(), app = useAppStore.getState()
afterEach(() => { cleanup(); useRawDataStore.setState(initial); useAppStore.setState(app) })
it('يطلب اختيار السيريال المستلم وتجديد الإقرار بعد تغييره', () => {
 useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true } })
 useRawDataStore.setState({ ...initial, branches: [], activeBranchId: null, items: [], insuranceProviders: [], insuranceClaims: [], journal: [], batches: [], serials: [], warehouses: [{ id: 1, nameAr: 'رئيسي', isMain: true }] })
 const s = useDataStore.getState()
 s.addItem({ nameAr: 'جهاز', sku: '', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 100, stockQty: 2, priceMinor: 1000, minQty: 0, trackExpiry: false, trackSerial: true, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
 const item = useDataStore.getState().items[0], provider = s.addInsuranceProvider({ nameAr: 'تأمين', coveragePercent: 70 })
 useRawDataStore.setState({ serials: ['S1', 'S2'].map((serial, i) => ({ id: i + 1, itemId: item.id, serial, status: 'in_stock' as const, purchaseId: null, saleId: null, soldAt: null, warrantyMonths: 0, receivedAt: '2026-01-01' })) })
 s.postInsuredSale({ lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 2, unitPriceMinor: 1000, unitCostMinor: 100, discountPercent: 0, soldByWeight: false, serials: ['S1', 'S2'] }], providerId: provider.id, taxPercent: 0, taxInclusive: false }); s.settleInsuranceClaims(provider.id)
 render(<InsuranceProvidersSection />)
 fireEvent.click(screen.getByRole('button', { name: 'رد كمية من البيع' }))
 fireEvent.change(screen.getByLabelText('كمية مرتجع البيع المؤمن'), { target: { value: '1' } })
 fireEvent.change(screen.getByLabelText('سبب رد كمية البيع المؤمن'), { target: { value: 'إيصال' } })
 fireEvent.click(screen.getByLabelText(/أؤكد استلام الكمية المحددة/))
 const submit = screen.getByRole('button', { name: /تأكيد رد الكمية/ }) as HTMLButtonElement
 expect(submit.disabled).toBe(true)
 fireEvent.click(screen.getByLabelText('S2'))
 expect(submit.disabled).toBe(true)
 fireEvent.click(screen.getByLabelText(/أؤكد استلام الكمية المحددة/)); fireEvent.click(submit)
 expect(useDataStore.getState().serials.find(row => row.serial === 'S2')?.status).toBe('in_stock')
 expect(useDataStore.getState().serials.find(row => row.serial === 'S1')?.status).toBe('sold')
 fireEvent.click(screen.getByRole('button', { name: 'رد المتبقي كاملاً' }))
 expect(screen.getByText(/الوحدات التي يجب استلامها/).textContent).toContain('S1')
 expect(screen.getByText(/الوحدات التي يجب استلامها/).textContent).not.toContain('S2')
})
