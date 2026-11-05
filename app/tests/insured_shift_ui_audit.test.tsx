import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ShiftsPage } from '../src/ui/pages/ShiftsPage.tsx'
import { useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const initial = useRawDataStore.getState(), app = useAppStore.getState()
afterEach(() => { cleanup(); useRawDataStore.setState(initial); useAppStore.setState(app) })
it('يعرض تحصيل جهة التأمين ضمن المتوقّع في صندوق الوردية', () => {
 useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true } })
 useRawDataStore.setState({ ...initial, branches: [], activeBranchId: null, appUsers: [], currentUserId: null, items: [], insuranceProviders: [], insuranceClaims: [], journal: [], shifts: [], batches: [], warehouses: [{ id: 1, nameAr: 'رئيسي', isMain: true }] })
 const s = useDataStore.getState()
 s.addItem({ nameAr: 'دواء', sku: '', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 100, stockQty: 5, priceMinor: 1000, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
 const item = useDataStore.getState().items[0], provider = s.addInsuranceProvider({ nameAr: 'تأمين', coveragePercent: 70 })
 s.openShift('موظف', 100); s.postInsuredSale({ lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 2, unitPriceMinor: 1000, unitCostMinor: 100, discountPercent: 0, soldByWeight: false }], providerId: provider.id, taxPercent: 0, taxInclusive: false }); s.settleInsuranceClaims(provider.id)
 render(<ShiftsPage />)
 expect(screen.getByText(/تحصيل التأمين: نقداً/).textContent).toContain('14.00')
 expect(screen.getByText('المتوقع في الدرج').parentElement?.textContent).toContain('21.00')
})
