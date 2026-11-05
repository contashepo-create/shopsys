import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { InsuranceProvidersSection } from '../src/ui/components/InsuranceProvidersSection.tsx'
import { useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const initial = useRawDataStore.getState(), app = useAppStore.getState()
afterEach(() => { cleanup(); useRawDataStore.setState(initial); useAppStore.setState(app) })
it('يطلب تحديد الدفعة المستلمة ويطابق مجموعها قبل اعتماد المرتجع', () => {
 useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true } })
 useRawDataStore.setState({ ...initial, branches: [], activeBranchId: null, items: [], suppliers: [], insuranceProviders: [], insuranceClaims: [], journal: [], batches: [], warehouses: [{ id: 1, nameAr: 'رئيسي', isMain: true }] })
 const s = useDataStore.getState()
 s.addSupplier({ nameAr: 'مورد', phone: '', notes: '', taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' })
 s.addItem({ nameAr: 'دواء', sku: '', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 0, stockQty: 0, priceMinor: 1000, minQty: 0, trackExpiry: true, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
 const { items, suppliers } = useDataStore.getState(), item = items[0]
 s.postPurchase({ supplierId: suppliers[0].id, date: '2026-01-01', lines: [{ itemId: item.id, qty: 2, unitPriceMinor: 100, expiryDate: '2099-01-01', lotNumber: 'TEST', warehouseId: 1 }], expenses: [], paidMinor: 0, notes: '' })
 const provider = s.addInsuranceProvider({ nameAr: 'تأمين', coveragePercent: 70 })
 s.postInsuredSale({ lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 2, unitPriceMinor: 1000, unitCostMinor: 100, discountPercent: 0, soldByWeight: false }], providerId: provider.id, taxPercent: 0, taxInclusive: false })
 s.settleInsuranceClaims(provider.id); render(<InsuranceProvidersSection />)
 fireEvent.click(screen.getByRole('button', { name: 'رد كمية من البيع' }))
 fireEvent.change(screen.getByLabelText('كمية مرتجع البيع المؤمن'), { target: { value: '1' } })
 fireEvent.change(screen.getByLabelText('سبب رد كمية البيع المؤمن'), { target: { value: 'إيصال' } })
 fireEvent.click(screen.getByLabelText(/أؤكد استلام الكمية المحددة/))
 const submit = screen.getByRole('button', { name: /تأكيد رد الكمية/ }) as HTMLButtonElement
 expect(submit.disabled).toBe(true)
 fireEvent.change(screen.getByLabelText('كمية الدفعة TEST'), { target: { value: '1' } })
 expect(submit.disabled).toBe(true)
 fireEvent.click(screen.getByLabelText(/أؤكد استلام الكمية المحددة/))
 fireEvent.click(submit)
 expect(useDataStore.getState().batches.find(b => b.lotNumber === 'TEST')?.qty).toBe(1)
})
