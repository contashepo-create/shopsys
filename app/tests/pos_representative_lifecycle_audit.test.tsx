import { afterEach, beforeEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PosPage } from '../src/ui/pages/PosPage.tsx'
import { useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const initial = useRawDataStore.getState(), app = useAppStore.getState()
beforeEach(() => {
 localStorage.clear(); useAppStore.setState({ ...app, activeBranchContext: null, setup: { ...app.setup, completed: true, countryCode: 'EG', activityId: 'grocery', modules: ['pos', 'inventory'], allowNegativeStock: true } })
 useRawDataStore.setState({ ...initial, branches: [], activeBranchId: null, currentUserId: null, items: [], employees: [], journal: [], sales: [] })
 const s = useDataStore.getState()
 s.addEmployee({ nameAr: 'المندوب', phone: '', roleId: 'cashier', salaryMinor: 0, active: true } as never)
 s.addItem({ nameAr: 'سلعة للتدقيق', sku: 'TEST-REP', barcodes: ['622100'], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 100, stockQty: 20, priceMinor: 200, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
})
afterEach(() => { cleanup(); useRawDataStore.setState(initial); useAppStore.setState(app); localStorage.clear() })
it('حذف آخر سطر لا يورّث المندوب للفاتورة التالية', () => {
 const view = render(<MemoryRouter><PosPage /></MemoryRouter>)
 const search = view.container.querySelector('input')!
 fireEvent.change(search, { target: { value: '622100' } })
 fireEvent.keyDown(search, { key: 'Enter', code: 'Enter' })
 const representative = screen.getByLabelText('مندوب البيع') as HTMLSelectElement
 fireEvent.change(representative, { target: { value: String(useDataStore.getState().employees[0].id) } })
 fireEvent.click(view.container.querySelector('[data-entry-row]')!)
 fireEvent.click(screen.getByTitle('اختر سطرًا ثم احذفه'))
 expect(screen.getByText('السلة فارغة')).toBeTruthy()
 expect(representative.value).toBe('')
})
it('تعليق السلة يحفظ المندوب واستعادتها تعيده دون نقله إلى السلة الفارغة', () => {
 const view = render(<MemoryRouter><PosPage /></MemoryRouter>)
 const search = view.container.querySelector('input')!
 fireEvent.change(search, { target: { value: '622100' } })
 fireEvent.keyDown(search, { key: 'Enter', code: 'Enter' })
 const representative = screen.getByLabelText('مندوب البيع') as HTMLSelectElement
 const id = useDataStore.getState().employees[0].id
 fireEvent.change(representative, { target: { value: String(id) } })
 fireEvent.click(screen.getByTitle('تعليق الفاتورة'))
 expect(representative.value).toBe('')
 expect(JSON.parse(localStorage.getItem('shopsys-held-carts')!)[0].salesRepEmployeeId).toBe(id)
 fireEvent.click(screen.getByRole('button', { name: /فاتورة معلقة 1/ }))
 expect(representative.value).toBe(String(id))
})
