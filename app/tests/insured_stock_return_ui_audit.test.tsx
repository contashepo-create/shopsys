import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { InsuranceProvidersSection } from '../src/ui/components/InsuranceProvidersSection.tsx'
import { useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const initial = useRawDataStore.getState(), app = useAppStore.getState()
afterEach(() => { cleanup(); useRawDataStore.setState(initial); useAppStore.setState(app) })
it('يتطلب سبباً وإقرار الاستلام وصرف المريض قبل رد البيع المؤمن المحصل', () => {
  useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true } })
  useRawDataStore.setState({ ...initial, branches: [], activeBranchId: null, items: [], insuranceProviders: [], insuranceClaims: [], journal: [], warehouses: [{ id: 1, nameAr: 'رئيسي', isMain: true }] })
  const s = useDataStore.getState()
  s.addItem({ nameAr: 'دواء', sku: '', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 1000, stockQty: 5, priceMinor: 5000, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
  const item = useDataStore.getState().items[0], provider = s.addInsuranceProvider({ nameAr: 'تأمين', coveragePercent: 70 })
  s.postInsuredSale({ lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 2, unitPriceMinor: 5000, unitCostMinor: 1000, discountPercent: 0, soldByWeight: false }], providerId: provider.id, taxPercent: 0, taxInclusive: false })
  s.settleInsuranceClaims(provider.id)
  render(<InsuranceProvidersSection />)
  fireEvent.click(screen.getByRole('button', { name: 'رد البيع كاملاً' }))
  const confirm = screen.getByRole('button', { name: /تأكيد رد البيع كاملاً/ }) as HTMLButtonElement
  expect(confirm.disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('سبب رد البيع المؤمن'), { target: { value: 'مرجع رد المريض 123' } })
  expect(confirm.disabled).toBe(true)
  fireEvent.click(screen.getByLabelText(/أؤكد استلام كامل البضاعة/))
  expect(confirm.disabled).toBe(false)
  fireEvent.click(confirm)
  expect(s.getInsuranceRefundBalance(useDataStore.getState().insuranceClaims[0].id)).toBe(7000)
  expect(screen.getByText(/مستحق للجهة عن المطالبة/)).toBeTruthy()
})
