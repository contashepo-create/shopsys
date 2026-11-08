import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SerialsPage } from '../src/ui/pages/SerialsPage.tsx'
import { EMPTY_EXTENDED, useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const initial = useRawDataStore.getState(), app = useAppStore.getState()
afterEach(() => { cleanup(); useRawDataStore.setState(initial); useAppStore.setState(app) })
it('يربط دفعة شراء تاريخية من صفحة السيريالات بعد التأكيد ومرجع الإثبات', () => {
 useRawDataStore.setState({ ...initial, branches: [], activeBranchId: null, appUsers: [], currentUserId: null, items: [], sales: [], purchases: [], serials: [], batches: [], journal: [], tradeIns: [], warehouses: [{ id: 1, nameAr: 'الرئيسي', isMain: true }] as never })
 const s = useDataStore.getState()
 s.addSupplier({ ...EMPTY_EXTENDED, nameAr: 'مورد', phone: '', notes: '' })
 const supplier = useDataStore.getState().suppliers.find(row => row.nameAr === 'مورد')!
 s.addItem({ nameAr: 'صنف', priceMinor: 500, costMinor: 0, stockQty: 0, trackSerial: true, trackExpiry: true } as never)
 const id = useDataStore.getState().items[0].id
 s.postPurchase({ supplierId: supplier.id, date: '2026-01-01', lines: [{ itemId: id, qty: 1, unitPriceMinor: 100, warehouseId: 1, serialsRaw: 'SER-900', expiryDate: '2099-01-01', lotNumber: 'LOT-900' }], expenses: [], paidMinor: 0, treasury: '1101', notes: '' })
 useRawDataStore.setState(state => ({ serials: state.serials.map(unit => ({ ...unit, batchId: undefined, expiryBatch: undefined })) }))
 render(<SerialsPage />)
 fireEvent.click(screen.getByRole('button', { name: 'ربط دفعة مثبتة' }))
 fireEvent.change(screen.getByLabelText('الدفعة المثبتة في فاتورة شراء السيريال'), { target: { value: String(useDataStore.getState().batches[0].id) } })
 fireEvent.change(screen.getByLabelText('مرجع الإثبات والسبب'), { target: { value: 'فاتورة 123 وتغليف الصنف' } })
 fireEvent.click(screen.getByRole('checkbox'))
 fireEvent.click(screen.getByRole('button', { name: /حفظ الربط/ }))
 expect(useDataStore.getState().serials[0].expiryBatch?.lotNumber).toBe('LOT-900')
 expect(screen.getByText(/LOT-900/)).toBeTruthy()
})
